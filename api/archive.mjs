// Accountability archive (v2.4.1): public serving of post_archive — the
// content that vanished through author post-deletes and account wipes. The
// point is that deletion is never a way to scrub words (rooman98's ask), so
// this read is unauthenticated: anyone who can visit the forum can view what
// was destroyed, marked with who wrote it and why it's gone.
import { HttpError, json } from "./shared.mjs";

const ARCHIVE_PAGE_SIZE = 51;

async function handleArchiveRoute(request, env, url, path, method) {
  if (path !== "/api/archive" || method !== "GET") return null;
  // An optional id cursor paginates newest-deleted-first; ids are monotonic
  // (AUTOINCREMENT) so insert order ≈ deletion order and the cursor never
  // skips or repeats a row, even inside a single account-wipe batch.
  let before = null;
  const beforeRaw = url.searchParams.get("before");
  if (beforeRaw !== null) {
    before = Number(beforeRaw);
    if (!Number.isSafeInteger(before) || before < 1) {
      throw new HttpError(400, "A before cursor must be a positive id.");
    }
  }
  const sql = "SELECT id, original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because, deleted_by_user_id, deleted_by_name " +
    "FROM post_archive WHERE id < ? ORDER BY id DESC LIMIT " + ARCHIVE_PAGE_SIZE;
  const result = await env.FORUM_DB.prepare(sql).bind(before ?? Number.MAX_SAFE_INTEGER).all();
  const rows = result.results || [];
  const hasMore = rows.length === ARCHIVE_PAGE_SIZE;
  const last = rows[rows.length - 1] || null;
  return json({
    archive: rows.map((row) => ({
      originalPostId: row.original_post_id,
      authorId: row.author_id === null ? null : Number(row.author_id),
      authorName: row.author_name,
      body: row.body,
      board: row.board,
      createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
      deletedAt: new Date(Number(row.deleted_at) * 1000).toISOString(),
      deletedBecause: row.deleted_because,
      deletedByUserId: row.deleted_by_user_id === null || row.deleted_by_user_id === undefined ? null : Number(row.deleted_by_user_id),
      deletedByName: row.deleted_by_name || null,
    })),
    nextBefore: hasMore && last ? Number(last.id) : null,
  });
}

export async function handleArchiveRoutes(request, env, url, path, method) {
  return handleArchiveRoute(request, env, url, path, method);
}

export { ARCHIVE_PAGE_SIZE };