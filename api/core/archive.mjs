
// v4.0 final sweep (spec step 8): the accountability-archive statement moves
// out of shared.mjs into its own core leaf — its only consumers are the
// posts-write and account-deletion batches in api/posts-write.mjs and
// api/profiles.mjs.

// Accountability archive (v2.4.1): builds the INSERT..SELECT that copies
// the doomed post rows into post_archive — run FIRST in the same atomic batch
// as the deletion, while the rows are still present. whereSql selects the
// doomed set (by original post column alias `p`); the NOT EXISTS guard keeps
// a row from being archived twice (e.g. an own reply that is also a child
// of an own root). COALESCE keeps the name even when the users row is about
// to vanish.
//
// SECURITY: whereSql must be a trusted, application-generated SQL fragment
// using the `p` alias. Never interpolate user-controlled SQL into this
// argument. Its placeholders must correspond exactly to the supplied binds.

export function archivePostRowsStatement(
  db,
  whereSql,
  binds,
  reason,
  deletedAt,
  deletedByUserId = null,
  deletedByName = null,
) {
  if (
    typeof whereSql !== "string" ||
    !whereSql.trim()
  ) {
    throw new TypeError(
      "Archive selection must be a non-empty trusted SQL fragment.",
    );
  }

  if (!Array.isArray(binds)) {
    throw new TypeError(
      "Archive selection bindings must be an array.",
    );
  }

  if (typeof reason !== "string" || !reason.trim()) {
    throw new TypeError(
      "An archive deletion reason is required.",
    );
  }

  // deleted_at is stored as INTEGER epoch seconds (post_archive.deleted_at)
  // and every caller passes nowSeconds() — a number. A refactor-era guard
  // here demanded a string, which 500s every author deletion before the
  // batch runs; the guard must match the column, not the other way around.
  if (
    typeof deletedAt !== "number" ||
    !Number.isInteger(deletedAt) ||
    deletedAt <= 0
  ) {
    throw new TypeError(
      "An archive deletion timestamp is required.",
    );
  }

  return db.prepare(
    "INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because, deleted_by_user_id, deleted_by_name, idempotency_key, idempotency_fingerprint, visibility) " +
    "SELECT p.id, p.author_id, COALESCE(u.username, 'removed'), p.body, p.board, p.created_at, ?, ?, ?, ?, p.idempotency_key, p.idempotency_fingerprint, p.visibility " +
    "FROM posts p LEFT JOIN users u ON u.id = p.author_id " +
    "WHERE (" + whereSql + ") AND NOT EXISTS (SELECT 1 FROM post_archive a WHERE a.original_post_id = p.id)",
  ).bind(
    deletedAt,
    reason,
    deletedByUserId,
    deletedByName,
    ...binds,
  );
}
