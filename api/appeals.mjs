// Member appeals (v3.1, auto-mod appeals removed v4.2): the only appeal is a
// BAN appeal, decided on the desk. It comes from the ban screen, where there
// IS no session (banned accounts cannot sign in), so POST /api/appeals
// identifies the member by username + password instead. This leaks nothing
// the sign-in flow doesn't already reveal: failed sign-ins already surface
// the ban and its reason.
//
// Approving a ban appeal revokes the ban outright — the same statement as
// revoking by hand, so the read-time unhide semantics for the member's posts
// come for free. Appeal bodies run the word filter like every other stored
// member-written text.
import { assertNotBanned, assertSameOrigin, readSession, requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requiredText } from "./core/http.mjs";
import { verifyPassword } from "./core/passwords.mjs";
import { userByUsernameKey } from "./core/shapers.mjs";
// Timing-equalizer dummies for the username-or-password mismatch case,
// mirroring session.mjs's login flow (a missing account still pays the full
// PBKDF2 cost so response timing never reveals whether the name exists).
const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
// Appeal outcomes are label-only notifications (no post to point at) — the
// shared builder in notifications.mjs (migration 0036 made the targets
// nullable; the local NULL-binding copy here 500'd every decision batch on
// the old NOT NULL target column, which was the reported "appeals no worky").
import { notifyStatement } from "./notifications.mjs";

export const MAX_APPEAL_BODY_CHARS = 1000;
const APPEAL_QUEUE_LIMIT = 100;

async function decideAppeal(db, appeal, decision, moderatorId) {
  const now = nowSeconds();
  if (decision === "deny") {
    const results = await db.batch([
      db.prepare(
        "UPDATE appeals SET status = 'denied', decided_at = ?, decided_by = ? " +
          "WHERE id = ? AND status = 'pending'",
      ).bind(now, moderatorId, appeal.id),
      notifyStatement(db, Number(appeal.user_id), "Your appeal was reviewed and denied."),
    ]);
    if (Number(results[0]?.meta?.changes) !== 1) {
      throw new HttpError(409, "That appeal was already decided.");
    }
    return json({ denied: true, id: appeal.id });
  }

  // Ban appeal: revoking the ban reuses the exact hand-unban semantics, so
  // un-banning auto-restores the member's hidden posts with no extra writes —
  // and clears the ban's IP rows, like a hand unban (v3.1).
  const results = await db.batch([
    db.prepare(
      "UPDATE appeals SET status = 'approved', decided_at = ?, decided_by = ? " +
        "WHERE id = ? AND status = 'pending'",
    ).bind(now, moderatorId, appeal.id),
    db.prepare(
      "UPDATE bans SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL",
    ).bind(now, moderatorId, Number(appeal.ban_id)),
    db.prepare("DELETE FROM banned_ips WHERE ban_id = ?").bind(Number(appeal.ban_id)),
    notifyStatement(db, Number(appeal.user_id),
      "Your ban appeal was approved. You can sign in again."),
  ]);
  if (Number(results[0]?.meta?.changes) !== 1) {
    throw new HttpError(409, "That appeal was already decided.");
  }
  return json({ approved: true, id: appeal.id });
}

async function handleAppealAdminRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/appeals" && method === "GET") {
    await requireStaff(request, env, false);
    const result = await db.prepare(
      "SELECT a.id, a.user_id, a.kind, a.body, a.status, a.created_at, a.decided_at, " +
        "a.ban_id, u.username, " +
        "b.reason AS ban_reason, b.expires_at AS ban_expires_at " +
        "FROM appeals a " +
        "LEFT JOIN users u ON u.id = a.user_id " +
        "LEFT JOIN bans b ON b.id = a.ban_id " +
        "ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at ASC LIMIT " + APPEAL_QUEUE_LIMIT,
    ).all();
    return json({
      appeals: (result.results || []).map((row) => ({
        id: Number(row.id),
        kind: row.kind,
        status: row.status,
        username: row.username || "removed",
        body: row.body,
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
        decidedAt: row.decided_at ? new Date(Number(row.decided_at) * 1000).toISOString() : null,
        // Appeals are ban appeals since the auto-mod removal (v4.2); legacy
        // auto-mod appeal rows were pruned by migration 0039.
        banReason: row.ban_reason,
        banExpiresAt: row.ban_expires_at === null || row.ban_expires_at === undefined
          ? null
          : Number(row.ban_expires_at),
      })),
    });
  }

  const decisionMatch = path.match(/^\/api\/admin\/appeals\/([0-9]+)\/(approve|deny)$/);
  if (decisionMatch && method === "POST") {
    const session = await requireStaff(request, env);
    await assertNotBanned(env, session.user.id);
    const appealId = Number(decisionMatch[1]);
    if (!Number.isSafeInteger(appealId) || appealId < 1) {
      throw new HttpError(404, "Appeal not found.");
    }
    const appeal = await db.prepare(
      "SELECT a.id, a.user_id, a.kind, a.status, a.ban_id " +
        "FROM appeals a WHERE a.id = ? LIMIT 1",
    ).bind(appealId).first();
    if (!appeal) throw new HttpError(404, "Appeal not found.");
    return decideAppeal(db, appeal, decisionMatch[2], session.user.id);
  }
  return null;
}

// The ban-screen route: NO session (banned members cannot sign in). The
// username identifies the member, and the active-ban predicate is the same
// one every read path uses (revoked_at IS NULL and not yet expired).
async function handleBanAppealRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path !== "/api/appeals" || method !== "POST") return null;
  // No session exists for a banned member, so the CSRF token cannot ride one
  // — but the same-origin rule for state-changing requests still applies.
  assertSameOrigin(request);
  await rateLimit(request, env, "write");
  const body = await readJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) throw new HttpError(400, "Enter the username of the banned account.");
  // Identity proof (review finding): username alone would let anyone file —
  // and via the one-appeal-per-ban rule LOCK OUT — an appeal in any banned
  // member's name. The password rides the same PBKDF2 path as login; the ban
  // screen already holds it from the failed sign-in, so the real member
  // types nothing extra. Verified BEFORE any ban lookup so an attacker never
  // learns whether an account is banned.
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 1 || password.length > 128) {
    throw new HttpError(400, "Enter the account's password to appeal.");
  }
  const appealText = applyWordFilter(
    requiredText(body.body, "appeal", MAX_APPEAL_BODY_CHARS),
    filterWords(env),
  );
  const user = await userByUsernameKey(env, username.toLowerCase());
  const valid = await verifyPassword(
    password,
    user ? user.password_salt : DUMMY_SALT,
    user ? user.password_hash : DUMMY_HASH,
    env.PASSWORD_PEPPER,
  );
  if (!user || !valid) throw new HttpError(401, "The username or password is incorrect.");
  const now = nowSeconds();
  const ban = await db.prepare(
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC LIMIT 1",
  ).bind(user.id, now).first();
  if (!ban) throw new HttpError(400, "That account has no active ban to appeal.");
  const existing = await db.prepare(
    "SELECT id, status FROM appeals WHERE user_id = ? AND ban_id = ? LIMIT 1",
  ).bind(user.id, ban.id).first();
  if (existing) {
    throw new HttpError(409, existing.status === "pending"
      ? "An appeal for this ban is already waiting for review."
      : "This ban was already appealed and reviewed.");
  }
  const result = await db.prepare(
    "INSERT INTO appeals (user_id, action_id, ban_id, kind, body, status, created_at) " +
      "VALUES (?, NULL, ?, 'ban', ?, 'pending', ?)",
  ).bind(user.id, ban.id, appealText, now).run();
  return json({ appeal: { id: Number(result.meta?.last_row_id), status: "pending" } }, 201);
}

export async function handleAppealRoutes(request, env, url, path, method) {
  const banAppeal = await handleBanAppealRoute(request, env, url, path, method);
  if (banAppeal) return banAppeal;
  const admin = await handleAppealAdminRoutes(request, env, url, path, method);
  if (admin) return admin;
  return null;
}
