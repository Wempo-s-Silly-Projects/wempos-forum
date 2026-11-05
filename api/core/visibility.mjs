// v4.0 core leaf: read-time visibility — the single predicate every read
// path consults. No imports: it is pure SQL over env.FORUM_DB.
//
// Nuke rule (v3.0.1): hidden content (a hidden post, or ANY content by an
// actively-banned author) is invisible to everyone EXCEPT mods and
// admins — the author included. Normal surfaces (feeds, replies, detail,
// search, history) never carry it (the list SQL binds a no-match bypass
// sentinel); the only in-app door is the desk's hidden-posts page
// (GET /api/admin/hidden). An expired or revoked ban restores content
// without any write ("now" stays SQL-computed and bind-free).
export async function canViewPost(env, row, viewer) {
  if (!row) return false;
  const ismod = Boolean(viewer && (viewer.role === "owner" || viewer.role === "admin"));
  if (row.visibility !== "public" && !ismod) return false;
  const bannedAuthor = await env.FORUM_DB.prepare(
    "SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1",
  ).bind(Number(row.author_id)).first();
  if (bannedAuthor && !ismod) return false;
  // Every ancestor up to the root (parent, and the grandparent root for
  // level-2 replies) must be viewable: hidden ancestors never leak through a
  // public reply chain. The same mod-only rule applies per ancestor.
  let ancestorId = row.parent_id;
  for (let depth = 0; ancestorId !== null && ancestorId !== undefined && depth < 2; depth++) {
    const ancestor = await env.FORUM_DB.prepare(
      "SELECT id, author_id, visibility, parent_id FROM posts WHERE id = ? LIMIT 1",
    ).bind(Number(ancestorId)).first();
    if (!ancestor || (ancestor.visibility !== "public" && !ismod)) return false;
    const ancestorBanned = await env.FORUM_DB.prepare(
      "SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1",
    ).bind(Number(ancestor.author_id)).first();
    if (ancestorBanned && !ismod) return false;
    ancestorId = ancestor.parent_id;
  }
  return true;
}
