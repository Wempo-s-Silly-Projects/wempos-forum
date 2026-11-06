// v4.4 core leaf: member blocks — the both-direction predicate and the SQL
// fragments list surfaces use to hide blocked members' rows. No imports:
// pure SQL over env.FORUM_DB, like visibility.mjs.
//
// Enforcement shape (owner's ask: "you can't see the person's posts when you
// block that person, and they can't interact with your posts / or see your
// profile"): a single row from EITHER direction hides content between the
// pair everywhere. Reactions, replies, and detail reads already gate through
// canViewPost, which consults blockPairExists — list SQL uses the fragment
// helpers below instead, since feeds filter rows in the SELECT, not per row.
// Staff never lose desk visibility: every read-path check bypasses for
// owner/admin viewers (stored-vocabulary roles — publicRole is NOT fed here).
export async function blockPairExists(env, viewerId, otherId) {
  const row = await env.FORUM_DB.prepare(
    "SELECT 1 FROM blocks WHERE (blocker_id = ?1 AND blocked_id = ?2) " +
    "OR (blocker_id = ?2 AND blocked_id = ?1) LIMIT 1",
  ).bind(Number(viewerId), Number(otherId)).first();
  return Boolean(row);
}

// List-surface fragment: exclude every author (column) on either side of a
// block pair with the viewer. Bound twice with the same id — D1's positional
// binding makes the doubled bind the cheap, safe shape.
export function blockFilterSql(column) {
  return ` AND ${column} NOT IN (` +
    "SELECT blocked_id FROM blocks WHERE blocker_id = ? " +
    "UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)";
}

// The full both-direction block list for one member (GET /api/me/blocks).
export async function blockedIdList(env, viewerId) {
  const id = Number(viewerId);
  const result = await env.FORUM_DB.prepare(
    "SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?1 " +
    "UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?1",
  ).bind(id).all();
  return (result.results || []).map((row) => Number(row.id));
}

// Viewer-scoped list clause: empty for guests (nothing to filter) and for
// staff (their reads bypass, mirroring canViewPost). Every caller of
// blockFilterSql goes through here so desk review can never be blocked.
export function viewerBlockFilterSql(viewer, column) {
  if (!viewer || !viewer.id) return "";
  if (viewer.role === "owner" || viewer.role === "admin") return "";
  return blockFilterSql(column);
}
