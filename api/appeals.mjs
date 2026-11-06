// Member appeals (v3.1): a second look at the two automated/authoritative
// outcomes a member can receive — auto-mod image removals and bans.
//
// - Auto-mod appeals need a session (the member was never locked out): they
//   target a moderation_actions row and attach one appeal per action.
// - BAN appeals come from the ban screen, where there IS no session (banned
//   accounts cannot sign in), so POST /api/appeals identifies the member by
//   username instead. This leaks nothing the sign-in flow doesn't already
//   reveal: failed sign-ins already surface the ban and its reason.
//
// Approving an auto-mod appeal never resurrects bytes (they were removed); it
// clears the action (reversed_at) and allowlists the content hash so a
// re-upload cannot be auto-removed again. Approving a ban appeal revokes the
// ban outright — the same statement unpinning/revoking by hand, so the
// auto-unhide semantics for the member's posts come for free. All appeal
// bodies run the word filter like every other stored member-written text.
import { assertNotBanned, assertSameOrigin, readSession, requireSignedInRead, requireStaff, requireUser } from "./core/auth.mjs";
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
// Appeal outcomes are label-only notifications (no post to point at) — the
// shared builder in notifications.mjs (migration 0036 made the targets
// nullable; the local NULL-binding copy here 500'd every decision batch on
// the old NOT NULL target column, which was the reported "appeals no worky").
import { notifyStatement } from "./notifications.mjs";

export const MAX_APPEAL_BODY_CHARS = 1000;
const APPEAL_QUEUE_LIMIT = 100;
// Un-reversed auto-mod actions stay appealable for a rolling window so the
// list cannot grow unbounded.
const ACTION_APPEAL_WINDOW_SECONDS = 30 * 86400;

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

  if (appeal.kind === "auto_image") {
    // Reverse the action for accountability and allowlist the hash so the
    // member can re-upload the same image without a second auto-removal.
    // A hashless action (avatars predate the intake hash) simply reverses.
    const statements = [
      db.prepare(
        "UPDATE appeals SET status = 'approved', decided_at = ?, decided_by = ? " +
          "WHERE id = ? AND status = 'pending'",
      ).bind(now, moderatorId, appeal.id),
      db.prepare(
        "UPDATE moderation_actions SET reversed_at = ?, reversed_by = ? WHERE id = ? AND reversed_at IS NULL",
      ).bind(now, moderatorId, Number(appeal.action_id)),
      notifyStatement(db, Number(appeal.user_id),
        "Your appeal was approved. You can upload that image again — auto-mod will leave it alone."),
    ];
    if (appeal.hash) {
      statements.push(
        db.prepare(
          "INSERT INTO auto_mod_overrides (hash, user_id, created_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(hash) DO NOTHING",
        ).bind(appeal.hash, Number(appeal.user_id), now),
      );
    }
    const results = await db.batch(statements);
    if (Number(results[0]?.meta?.changes) !== 1) {
      throw new HttpError(409, "That appeal was already decided.");
    }
    return json({ approved: true, id: appeal.id });
  }

  if (appeal.kind === "auto_text") {
    // Reverse the action; for POST actions also unhide — the auto-hide was
    // the only thing quarantine-grade about it, so an approval restores the
    // content intact (unlike images, the bytes were never touched). Chat/DM
    // actions have nothing to restore (deletion is permanent); the reversal
    // clears the member's record. The unhide is guarded to still-hidden
    // posts; if a mod ALSO hid the post for another reason afterwards, the
    // approving admin is making the human call to publish it.
    const statements = [
      db.prepare(
        "UPDATE appeals SET status = 'approved', decided_at = ?, decided_by = ? " +
          "WHERE id = ? AND status = 'pending'",
      ).bind(now, moderatorId, appeal.id),
      db.prepare(
        "UPDATE moderation_actions SET reversed_at = ?, reversed_by = ? WHERE id = ? AND reversed_at IS NULL",
      ).bind(now, moderatorId, Number(appeal.action_id)),
    ];
    if (appeal.entity_kind === "post") {
      statements.push(
        db.prepare(
          "UPDATE posts SET visibility = 'public' WHERE id = ? AND visibility = 'hidden'",
        ).bind(Number(appeal.entity_id)),
      );
    }
    statements.push(notifyStatement(db, Number(appeal.user_id),
      appeal.entity_kind === "post"
        ? "Your appeal was approved. Your post is visible again."
        : "Your appeal was approved."));
    const results = await db.batch(statements);
    if (Number(results[0]?.meta?.changes) !== 1) {
      throw new HttpError(409, "That appeal was already decided.");
    }
    return json({ approved: true, id: appeal.id });
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
        "a.action_id, a.ban_id, u.username, " +
        "m.reason AS action_reason, m.entity_kind AS entity_kind, m.hash AS action_hash, " +
        "m.verdicts AS action_verdicts, m.content_preview AS content_preview, " +
        "p.body AS post_body, " +
        "b.reason AS ban_reason, b.expires_at AS ban_expires_at " +
        "FROM appeals a " +
        "LEFT JOIN users u ON u.id = a.user_id " +
        "LEFT JOIN moderation_actions m ON m.id = a.action_id " +
        "LEFT JOIN posts p ON p.id = m.entity_id AND m.entity_kind = 'post' " +
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
        ...(row.kind === "auto_image" || row.kind === "auto_text" ? {
          actionReason: row.action_reason,
          // entity_id is the post id for post appeals (the desk opens it —
          // hidden posts remain admin-readable through canViewPost).
          entityId: row.entity_kind === "post" ? Number(row.entity_id) : null,
          // The flagged-content snapshot (v4.2): what tripped the auto-mod,
          // always visible — even after the chat/DM message was deleted or
          // the post hidden. postBody is the post's CURRENT body (the appeal
          // text may predate a newer edit); the snapshot is what the
          // classifier saw.
          contentPreview: row.content_preview && typeof row.content_preview === "string"
            ? row.content_preview
            : null,
          postBody: row.post_body && typeof row.post_body === "string" ? row.post_body : null,
          verdicts: safeParseVerdicts(row.action_verdicts),
        } : {
          banReason: row.ban_reason,
          banExpiresAt: row.ban_expires_at === null || row.ban_expires_at === undefined
            ? null
            : Number(row.ban_expires_at),
        }),
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
      "SELECT a.id, a.user_id, a.kind, a.status, a.action_id, a.ban_id, " +
        "m.hash AS hash, m.entity_kind AS entity_kind, m.entity_id AS entity_id " +
        "FROM appeals a LEFT JOIN moderation_actions m ON m.id = a.action_id " +
        "WHERE a.id = ? LIMIT 1",
    ).bind(appealId).first();
    if (!appeal) throw new HttpError(404, "Appeal not found.");
    return decideAppeal(db, appeal, decisionMatch[2], session.user.id);
  }
  return null;
}

function safeParseVerdicts(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
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
    env.FILTERED_WORDS,
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

// Signed-in surfaces: the member's own appeal history plus the auto-mod
// actions they can still appeal (un-reversed, undecided, inside the window).
async function handleMyAppealRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me/appeals" && method === "GET") {
    // GETs carry no CSRF header (the frontend only attaches one to mutating
    // methods), so the read authenticates session-only.
    const session = await requireSignedInRead(request, env);
    const [history, actions] = await Promise.all([
      db.prepare(
        "SELECT a.id, a.kind, a.status, a.body, a.created_at, a.decided_at, " +
          "m.reason AS action_reason, b.reason AS ban_reason " +
          "FROM appeals a " +
          "LEFT JOIN moderation_actions m ON m.id = a.action_id " +
          "LEFT JOIN bans b ON b.id = a.ban_id " +
          "WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 50",
      ).bind(session.user.id).all(),
      db.prepare(
        "SELECT m.id, m.reason, m.entity_kind, m.verdicts, m.created_at " +
          "FROM moderation_actions m " +
          "WHERE m.user_id = ? AND m.reversed_at IS NULL AND m.created_at > ? " +
          "AND NOT EXISTS (SELECT 1 FROM appeals a WHERE a.action_id = m.id) " +
          "ORDER BY m.id DESC LIMIT 50",
      ).bind(session.user.id, nowSeconds() - ACTION_APPEAL_WINDOW_SECONDS).all(),
    ]);
    return json({
      appeals: (history.results || []).map((row) => ({
        id: Number(row.id),
        kind: row.kind,
        status: row.status,
        body: row.body,
        reason: row.action_reason || row.ban_reason || null,
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
        decidedAt: row.decided_at ? new Date(Number(row.decided_at) * 1000).toISOString() : null,
      })),
      appealableActions: (actions.results || []).map((row) => ({
        id: Number(row.id),
        reason: row.reason,
        entityKind: row.entity_kind,
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
      })),
    });
  }
  if (path === "/api/me/appeals" && method === "POST") {
    const session = await requireUser(request, env);
    await rateLimit(request, env, "write");
    const body = await readJson(request);
    const appealText = applyWordFilter(
      requiredText(body.body, "appeal", MAX_APPEAL_BODY_CHARS),
      env.FILTERED_WORDS,
    );
    const actionId = Number(body.actionId);
    if (!Number.isSafeInteger(actionId) || actionId < 1) {
      throw new HttpError(400, "Choose the auto-mod action to appeal.");
    }
    const action = await db.prepare(
      "SELECT id, kind, reversed_at FROM moderation_actions WHERE id = ? AND user_id = ? LIMIT 1",
    ).bind(actionId, session.user.id).first();
    if (!action) throw new HttpError(404, "That auto-mod action doesn't exist.");
    if (action.reversed_at !== null && action.reversed_at !== undefined) {
      throw new HttpError(409, "That action was already reversed.");
    }
    if (action.kind !== "auto_image" && action.kind !== "auto_text") {
      throw new HttpError(404, "That auto-mod action doesn't exist.");
    }
    try {
      const result = await db.prepare(
        "INSERT INTO appeals (user_id, action_id, ban_id, kind, body, status, created_at) " +
          "VALUES (?, ?, NULL, ?, ?, 'pending', ?)",
      ).bind(session.user.id, actionId, action.kind, appealText, nowSeconds()).run();
      return json({ appeal: { id: Number(result.meta?.last_row_id), status: "pending" } }, 201);
    } catch (error) {
      // The UNIQUE(user_id, action_id) guard is the one-at-a-time rule.
      if (/UNIQUE constraint failed/i.test(String(error && error.message || error))) {
        throw new HttpError(409, "You already appealed that action.");
      }
      throw error;
    }
  }
  return null;
}

export async function handleAppealRoutes(request, env, url, path, method) {
  const banAppeal = await handleBanAppealRoute(request, env, url, path, method);
  if (banAppeal) return banAppeal;
  const mine = await handleMyAppealRoutes(request, env, url, path, method);
  if (mine) return mine;
  const admin = await handleAppealAdminRoutes(request, env, url, path, method);
  if (admin) return admin;
  return null;
}
