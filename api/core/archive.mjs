// v4.0 final sweep (spec step 8): the accountability-archive statement moves
// out of shared.mjs into its own core leaf — its only consumers are the
// posts-write and account-deletion batches in api/posts-write.mjs and
// api/profiles.mjs.

// Accountability archive (v2.4.1): builds the INSERT..SELECT that copies the
// doomed post rows into post_archive — run FIRST in the same atomic batch as
// the deletion, while the rows are still present. whereSql selects the doomed
// set (by original post column alias `p`); the NOT EXISTS guard keeps a row
// from being archived twice (e.g. an own reply that is also a child of an own
// root). COALESCE keeps the name even when the users row is about to vanish.
export function archivePostRowsStatement(
  db, whereSql, binds, reason, deletedAt, deletedByUserId = null, deletedByName = null,
) {
  return db.prepare(
    "INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because, deleted_by_user_id, deleted_by_name, idempotency_key, idempotency_fingerprint) " +
    "SELECT p.id, p.author_id, COALESCE(u.username, 'removed'), p.body, p.board, p.created_at, ?, ?, ?, ?, p.idempotency_key, p.idempotency_fingerprint " +
    "FROM posts p LEFT JOIN users u ON u.id = p.author_id " +
    "WHERE (" + whereSql + ") AND NOT EXISTS (SELECT 1 FROM post_archive a WHERE a.original_post_id = p.id)",
  ).bind(deletedAt, reason, deletedByUserId, deletedByName, ...binds);
}
