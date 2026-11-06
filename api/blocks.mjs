// Member blocks (v4.4): POST/DELETE /api/users/:id/block — the signed-in
// member records (or removes) their OWN direction of a pair. One row from
// either direction hides content between the pair everywhere; DELETE always
// removes only the caller's own row, so you can never unblock yourself out
// of someone else's block on you. GET /api/me/blocks lists the session's
// block pairs (both directions, named) with the unblock control for the rows
// they own — the profile itself is refused to pairs, so this list is the
// only Unblock surface.
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { blockPairExists, viewerBlockFilterSql } from "./core/blocks.mjs";
import { HttpError, json, rateLimit } from "./core/http.mjs";

export async function handleBlockRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(/^\/api\/users\/([0-9]{1,15})\/block$/);
  if (match && (method === "POST" || method === "DELETE")) {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write", String(session.user.id));
    const targetId = Number(match[1]);
    if (!Number.isSafeInteger(targetId) || targetId < 1) {
      throw new HttpError(404, "Member not found.");
    }
    const target = await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1")
      .bind(targetId).first();
    if (!target) throw new HttpError(404, "Member not found.");
    if (targetId === Number(session.user.id)) {
      throw new HttpError(400, "You cannot block yourself.");
    }
    if (method === "DELETE") {
      // Only the caller's own row lifts: the other direction's block stays
      // (unblocking someone else's block on you is not a thing you can do).
      await db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
        .bind(session.user.id, targetId).run();
      return json({ blocked: await blockPairExists(env, session.user.id, targetId) });
    }
    // Idempotent: a repeated block resolves to the same state. The pair then
    // hides both ways — the target can't see the blocker either.
    await db.prepare(
      "INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?) " +
      "ON CONFLICT DO NOTHING",
    ).bind(session.user.id, targetId, nowSeconds()).run();
    return json({ blocked: true });
  }
  if (path === "/api/me/blocks" && method === "GET") {
    const user = (await requireSignedInRead(request, env)).user;
    // Both directions, named, oldest pair first. The direction label tells
    // the member which rows carry their own unblock control; a pair they
    // DIDN'T create is closed only by the other member (no unblock here).
    const rows = (await db.prepare(
      "SELECT u.id, u.username, b.created_at, " +
      "(b.blocker_id = ?) AS own_direction " +
      "FROM blocks b JOIN users u ON u.id = CASE WHEN b.blocker_id = ? " +
      "THEN b.blocked_id ELSE b.blocker_id END " +
      "WHERE b.blocker_id = ? OR b.blocked_id = ? ORDER BY b.created_at ASC, u.id ASC",
    ).bind(user.id, user.id, user.id, user.id).all()).results || [];
    return json({
      blocks: rows.map((row) => ({
        id: Number(row.id),
        username: row.username,
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
        ownDirection: Boolean(Number(row.own_direction)),
      })),
    });
  }
  return null;
}
