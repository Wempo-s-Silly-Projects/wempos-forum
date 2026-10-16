// Bookmarks (C4): PUT/DELETE /api/posts/:id/bookmark (member gates mirroring
// the reaction/subscribe routes; idempotent in both directions — a missing row
// is the state the caller wanted) and the PRIVATE list at /api/me/bookmarks —
// the session's OWN rows only, newest first, guests 401. The list rides
// POST_SELECT with the feed's visibility semantics (public, unbanned rows), so
// a post that later became hidden doesn't leak through somebody's saved list.
import {
  assertNotBanned,
  canViewPost,
  HttpError,
  json,
  nowSeconds,
  postById,
  POST_SELECT,
  publicPost,
  rateLimit,
  requireSignedInRead,
  requireUser,
} from "./shared.mjs";
import { attachmentRowsForView } from "./attachments.mjs";
import { banFilterSql } from "./posts.mjs";

// The detail/feed flag read: one query for the (member, post) pair.
export const BOOKMARK_EXISTS_SQL =
  "SELECT 1 AS bookmarked FROM bookmarks WHERE user_id = ? AND post_id = ?";

// One batched lookup per page (like the attachments decorator): the viewer's
// saved state for every post id on the page. Guests skip the query entirely —
// call sites must treat an undefined flag as "not for me".
export async function withBookmarkFlags(db, viewer, posts) {
  if (!posts.length || !viewer) return posts;
  const ids = [...new Set(posts.map((post) => Number(post.id)))];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(
    "SELECT post_id FROM bookmarks WHERE user_id = ? AND post_id IN (" + placeholders + ")",
  ).bind(viewer.id, ...ids).all();
  const saved = new Set((result.results || []).map((row) => Number(row.post_id)));
  return posts.map((post) => ({ ...post, viewerBookmarked: saved.has(Number(post.id)) }));
}

export async function bookmarkFlagForViewer(db, viewerId, postId) {
  const existing = await db.prepare(BOOKMARK_EXISTS_SQL).bind(viewerId, postId).first();
  return Boolean(existing);
}

// The private list: POST_SELECT payloads (reply metadata + attachments
// decorated, exactly like a feed page), newest bookmark first. Hidden/banned
// rows are skipped — mirroring the feed instead of leaking. Capped at 100.
async function handleBookmarkListRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me/bookmarks" && method === "GET") {
    const user = (await requireSignedInRead(request, env)).user;
    // Pagination (fix round 1): a `before` cursor walks the list's OWN sort key
    // — (bookmarked_at, post id) — in the composite seconds_id format the
    // activity feed established (both keys DESC, strictly exclusive). The
    // cursor's seconds half is the BOOKMARK stamp, so the response's nextBefore
    // resolves it from the boundary bookmark's row (POST_SELECT projections
    // don't carry b.created_at; one tiny follow-up read, only when a next page
    // exists).
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      const cursorMatch = /^([0-9]{1,10})_([0-9]{1,10})$/.exec(beforeRaw);
      if (!cursorMatch) throw new HttpError(400, "That page cursor is invalid.");
      before = { seconds: Number(cursorMatch[1]), id: Number(cursorMatch[2]) };
    }
    let sql = POST_SELECT + "JOIN bookmarks b ON b.post_id = p.id " +
      "WHERE b.user_id = ? AND p.visibility = 'public' AND " + banFilterSql("p") + " ";
    const values = [user.id, user.id];
    if (before) {
      sql += "AND (b.created_at < ? OR (b.created_at = ? AND p.id < ?)) ";
      values.push(before.seconds, before.seconds, before.id);
    }
    sql += "ORDER BY b.created_at DESC, p.id DESC LIMIT 21";
    const result = await db.prepare(sql).bind(...values).all();
    const rows = result.results || [];
    const hasMore = rows.length > 20;
    const shown = rows.slice(0, 20);
    let nextBefore = null;
    if (hasMore && shown.length) {
      const boundaryId = Number(shown[shown.length - 1].id);
      const stamp = await db.prepare(
        "SELECT created_at FROM bookmarks WHERE user_id = ? AND post_id = ? LIMIT 1",
      ).bind(user.id, boundaryId).first();
      nextBefore = stamp ? Number(stamp.created_at) + "_" + boundaryId : null;
    }
    const posts = shown.map((row) => ({
      ...publicPost(row, undefined),
      viewerBookmarked: true,
    }));
    const attachments = await attachmentRowsForView(
      db, posts.map((post) => post.id), user,
    );
    return json({
      bookmarks: posts.map((post) => ({ ...post, attachments: attachments.get(post.id) || [] })),
      nextBefore,
    });
  }
  return null;
}

async function handleBookmarkToggleRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(/^\/api\/posts\/([0-9]+)\/bookmark$/);
  if (!match) return null;
  // The method gate runs before any session work so a stray PATCH is a 405
  // with zero database reads (mirrors the reaction DELETE route's gate).
  if (method !== "PUT" && method !== "DELETE") {
    throw new HttpError(405, "That method is not supported.");
  }
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  const postId = Number(match[1]);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
  const post = await postById(env, postId, session.user.id);
  if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
  const now = nowSeconds();
  if (method === "PUT") {
    // Idempotent by construction: an existing (member, post) row changes 0 rows
    // and still answers the wanted state.
    await db.prepare(
      "INSERT INTO bookmarks (user_id, post_id, created_at) " +
        "SELECT ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ? LIMIT 1)",
    ).bind(session.user.id, postId, now, session.user.id, postId).run();
    return json({ ok: true, bookmarked: true });
  }
  await db.prepare(
    "DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?",
  ).bind(session.user.id, postId).run();
  return json({ ok: true, bookmarked: false });
}

export async function handleBookmarkRoutes(request, env, url, path, method) {
  const listed = await handleBookmarkListRoute(request, env, url, path, method);
  if (listed) return listed;
  const toggled = await handleBookmarkToggleRoute(request, env, url, path, method);
  if (toggled) return toggled;
  return null;
}