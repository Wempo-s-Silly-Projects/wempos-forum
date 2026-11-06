// v4.0 plan 3, Task 3: the "who bans" module — active ban list, ban
// create/revoke (timed-ban durations, opt-in IP bans), and the ban mutation
// route. Moved verbatim from api/moderation.mjs (see the plan-3 rulings: the
// moderation seam is "who bans vs who reviews vs who manages roles"). The
// composer re-exports createUserBan — worker.mjs imports it from moderation
// .mjs and that surface does not change.
import { UNBAN_ACTIVE_UPDATE_SQL } from "../constants.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, readJson, requiredText } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";

async function handleBanListRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/bans" && method === "GET") {
    await requireStaff(request, env, false);
    const result = await db.prepare(
      "SELECT b.id, b.user_id, b.reason, b.expires_at, u.username " +
        "FROM bans b JOIN users u ON u.id = b.user_id " +
        "WHERE b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?) " +
        "ORDER BY b.created_at DESC LIMIT 200",
    ).bind(nowSeconds()).all();
    return json({
      bans: (result.results || []).map((row) => ({
        id: Number(row.id),
        user: { id: Number(row.user_id), username: row.username },
        reason: row.reason,
        expiresAt: row.expires_at ? new Date(Number(row.expires_at) * 1000).toISOString() : null,
      })),
    });
  }
  return null;
}

export async function createUserBan(db, targetId, modId, request, env) {
  const body = await readJson(request);
  const reason = applyWordFilter(requiredText(body.reason, "ban reason", 500), filterWords(env));
  const now = nowSeconds();
  // Timed bans (v3.0.2): every read path (the ban screen's reactivation
  // countdown, the visibility filters, the auto-expire sweep above) already
  // honored expires_at — but the write path never accepted one, so all bans
  // were permanent regardless of intent. An optional expiresAt (epoch
  // seconds) now rides the body: absent/null = permanent; anything else
  // must be a safe integer more than a minute and less than a year out
  // (the 60-second floor absorbs client clock skew).
  let expiresAt = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    const candidate = Number(body.expiresAt);
    if (!Number.isSafeInteger(candidate) || candidate <= now + 60 ||
        candidate > now + 366 * 86400) {
      throw new HttpError(400, "The ban duration must be between a minute and a year from now.");
    }
    expiresAt = candidate;
  }
  const results = await db.batch([
    db.prepare(
      "UPDATE bans SET revoked_at = ?, revoked_by = ?, revocation_reason = 'Expired automatically' " +
        "WHERE user_id = ? AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?",
    ).bind(now, modId, targetId, now),
    db.prepare(
      "INSERT INTO bans (user_id, reason, created_at, created_by, expires_at) " +
        "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(targetId, reason, now, modId, expiresAt, targetId, now),
    db.prepare(
      "DELETE FROM sessions WHERE user_id = ? AND EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(targetId, targetId, now),
  ]);
  if (Number(results[1]?.meta?.changes) !== 1) {
    throw new HttpError(409, "This member is already banned.");
  }
  // IP bans (v3.1, opt-in per ban form): copy the member's KNOWN network
  // hashes to banned_ips so sign-in and registration from them is refused.
  // Best-effort and additive — an unbanning mod removes the ban's rows.
  if (body.ipBan === true || body.ipBan === "true") {
    const banId = Number(results[1]?.meta?.last_row_id);
    if (Number.isSafeInteger(banId) && banId > 0) {
      await db.batch([
        db.prepare(
          "INSERT OR IGNORE INTO banned_ips (ip_hash, ban_id, created_at) " +
            "SELECT ip_hash, ?, ? FROM known_ips WHERE user_id = ?",
        ).bind(banId, now, targetId),
      ]);
    }
  }
  return json({ ok: true, expiresAt }, 201);
}

async function revokeUserBan(db, targetId, modId, request, env) {
  const body = await readJson(request);
  const reason = applyWordFilter(requiredText(body.reason, "unban reason", 500), filterWords(env));
  const active = await db.prepare(
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1",
  ).bind(targetId, nowSeconds()).first();
  if (!active) throw new HttpError(404, "No active ban was found for this member.");
  const now = nowSeconds();
  const result = await db.prepare(UNBAN_ACTIVE_UPDATE_SQL)
    .bind(now, modId, reason, Number(active.id), targetId, now).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409, "This ban was already revoked by another mod.");
  }
  // IP bans (v3.1): unban restores network access too — but only the rows THIS
  // ban added (another active ban's rows keep their teeth).
  await db.batch([
    db.prepare("DELETE FROM banned_ips WHERE ban_id = ?").bind(Number(active.id)),
  ]);
  return json({ ok: true });
}

async function handleBanMutationRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/users\/([0-9]+)\/bans$/);
  if (!match || (method !== "POST" && method !== "DELETE")) return null;

  const session = await requireStaff(request, env);
  const targetId = Number(match[1]);
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(404, "Member not found.");
  const db = env.FORUM_DB;
  const target = await db.prepare(
    "SELECT id, role FROM users WHERE id = ? LIMIT 1",
  ).bind(targetId).first();
  if (!target) throw new HttpError(404, "Member not found.");
  // Raw row → public vocabulary via publicRole (v3.1 rename).
  if (publicRole(target.role) === "owner" || targetId === session.user.id) {
    throw new HttpError(403, "Owner accounts cannot be banned here.");
  }
  if (method === "POST") return createUserBan(db, targetId, session.user.id, request, env);
  return revokeUserBan(db, targetId, session.user.id, request, env);
}

export {
  handleBanListRoute,
  handleBanMutationRoute,
  revokeUserBan,
};
