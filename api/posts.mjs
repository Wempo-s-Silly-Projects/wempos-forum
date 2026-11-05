// v4.0 plan 2 composer: the posts surface's dispatcher. The read routes,
// board vocabulary, write routes, and reply routes have split into
// posts-feed.mjs, boards.mjs, posts-write.mjs, and replies.mjs; this module
// keeps suggestion-status and search until their own tasks, and composes the
// pinned POST_ROUTE_HANDLERS chain from the split modules' handlers.
import { SEARCH_USERS_SQL } from "../constants.mjs";
// v4.0 plan 2: board vocabulary + whitelist gate and the Suggestions score
// expression moved to their split module (Task 2).
import {
  GENERAL_BOARD_DEFAULT,
  SUGGESTIONS_BOARD,
} from "./boards.mjs";
// v4.0 plan 2, Task 3: feed/detail reads (listRootPosts, listReplies, the
// decorators, banFilterSql) moved to api/posts-feed.mjs — the composer keeps
// the historical re-exports (bookmarks.mjs imports banFilterSql; profiles
// .mjs imports listRootPosts).
import {
  banFilterSql,
  handlePostDetailRoute,
  handlePostFeedRoute,
  listReplies,
  listRootPosts,
} from "./posts-feed.mjs";
// v4.0 plan 2, Task 5: the write routes + idempotency family + staged
// attachment persistence moved to api/posts-write.mjs (its surface is pinned
// by tests/posts-write-module.test.mjs; the composer re-exports several
// until the final sweep re-points importers).
// v4.0 plan 2, Task 5: the write routes + idempotency family + staged
// attachment persistence moved to api/posts-write.mjs (its surface is pinned
// by tests/posts-write-module.test.mjs; the composer re-exports several
// until the final sweep re-points importers).
import {
  handlePostCreateRoute,
  handlePostDeleteRoute,
  handlePostEditHistoryRoute,
  handlePostEditRoute,
  handleReactionDeleteRoute,
  handleReactionRoute,
  postDeletionStatements,
} from "./posts-write.mjs";
// v4.0 plan 2, Task 4: the reply routes moved to api/replies.mjs.
import {
  handleRepliesReadRoute,
  handleReplyCreateRoute,
} from "./replies.mjs";
import {
  assertNotBanned,
  canViewPost,
  HttpError,
  json,
  nowSeconds,
  POST_SELECT,
  postById,
  publicPost,
  publicUser,
  rateLimit,
  readJson,
  readSession,
  requiremod,
  requireMutationApplied,
  userByUsernameKey,
} from "./shared.mjs";

export { POST_SELECT };

// Suggestion status (v3.1): staff mark a suggestion thread resolved or
// declined, or reopen it. Suggestions-board ROOTS only — replies never carry
// a status. Reopening is idempotent (an already-open thread stays open);
// setting a status must apply (a vanished post 404s above).
async function handleSuggestionStatusRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(/^\/api\/posts\/([0-9]+)\/suggestion-status$/);
  if (!match) return null;
  if (method !== "POST") throw new HttpError(405, "That method is not supported.");
  const session = await requiremod(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const postId = Number(match[1]);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
  const post = await postById(env, postId, session.user.id);
  if (!post || post.parent_id !== null) throw new HttpError(404, "Post not found.");
  if ((post.board || GENERAL_BOARD_DEFAULT) !== SUGGESTIONS_BOARD) {
    throw new HttpError(400, "Only suggestions can be marked resolved or declined.");
  }
  const body = await readJson(request);
  if (body.status === undefined) throw new HttpError(400, "Choose a suggestion status.");
  if (body.status === "open") {
    await db.prepare(
      "UPDATE posts SET suggestion_status = NULL, suggestion_decided_by = NULL, suggestion_decided_at = NULL WHERE id = ?",
    ).bind(postId).run();
    return json({ ok: true, suggestionStatus: null });
  }
  if (body.status !== "resolved" && body.status !== "declined") {
    throw new HttpError(400, "Choose resolved, declined, or open.");
  }
  const result = await db.prepare(
    "UPDATE posts SET suggestion_status = ?, suggestion_decided_by = ?, suggestion_decided_at = ? WHERE id = ?",
  ).bind(body.status, session.user.id, nowSeconds(), postId).run();
  requireMutationApplied(result);
  return json({ ok: true, suggestionStatus: body.status });
}

async function handleSearchRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/search" && method === "GET") {
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (!query || query.length > 100) {
      if (!query) return json({ users: [], posts: [] });
      throw new HttpError(400, "Search must be 1–100 characters long.");
    }
    // Search upgrades (v2.5): `by=<username>` filters to a member's roots;
    // `in=replies` deep-searches reply text. The classic shape (users+posts)
    // stays byte-identical when both are absent.
    const byRaw = url.searchParams.get("by");
    const inRaw = (url.searchParams.get("in") || "").trim().toLowerCase();
    if (inRaw && inRaw !== "replies") {
      throw new HttpError(400, "The in param must be 'replies'.");
    }
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    let authorId = null;
    if (byRaw !== null) {
      const author = await userByUsernameKey(env, byRaw.trim().toLowerCase());
      // An unknown name answers an EMPTY result — search treats it as no
      // matches, never an error (it also feeds the People panel).
      authorId = author ? Number(author.id) : -1;
    }
    const users = await db.prepare(SEARCH_USERS_SQL).bind(query, query).all();
    const posts = await listRootPosts(env, viewer,
      authorId !== null ? { searchTerm: query, authorId } : { searchTerm: query });
    const payload = {
      users: (users.results || []).map(publicUser),
      posts: posts.posts,
    };
    if (inRaw === "replies") {
      payload.replies = await searchReplies(env, viewer, query, authorId);
    }
    return json(payload);
  }
  return null;
}

// Deep reply search (v2.5): flat matching-reply rows, each gated through
// canViewPost in JS after the fetch (one gate per candidate — ≤21 small
// queries — reusing the EXACT hide/ban/ancestor semantics every other read
// uses; nothing can leak through search's chain checks).
async function searchReplies(env, viewer, query, authorId) {
  const viewerId = viewer ? viewer.id : null;
  const sql =
    "SELECT r.id, r.author_id, r.parent_id, r.body, r.visibility, r.created_at, r.board, r.view_count, r.pinned_at, r.edited_at, " +
    "(SELECT COUNT(*) FROM reactions rx WHERE rx.post_id = r.id AND rx.value = 'like') AS like_count, " +
    "(SELECT COUNT(*) FROM reactions rx WHERE rx.post_id = r.id AND rx.value = 'dislike') AS dislike_count, " +
    "(SELECT rx.value FROM reactions rx WHERE rx.post_id = r.id AND rx.user_id = ?) AS viewer_reaction, " +
    "(SELECT parent.body FROM posts parent WHERE parent.id = r.parent_id) AS parent_body, " +
    "r.last_activity_at, " +
    "u.username AS author_username, u.avatar_mime AS author_avatar_mime, " +
    "u.avatar_version AS author_avatar_version " +
    "FROM posts r JOIN users u ON u.id = r.author_id " +
    "WHERE r.parent_id IS NOT NULL AND instr(lower(r.body), ?) > 0 " +
    (authorId !== null ? "AND r.author_id = ? " : "") +
    "AND ((r.visibility = 'public' AND " + banFilterSql("r") + ") OR r.author_id = ?) " +
    "ORDER BY r.id DESC LIMIT 21";
  const values = [];
  values.push(viewerId || -1); // viewer_reaction's subselect first
  values.push(query);
  if (authorId !== null) values.push(authorId);
  // Nuke rule: the bypass never matches (public + unbanned only).
  values.push(-1);
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  const rows = [];
  for (const row of (result.results || [])) {
    if (!(await canViewPost(env, row, viewer))) continue;
    rows.push({ ...publicPost(row, 1), threadId: await threadRootId(env, row) });
  }
  return rows;
}

// A searched reply's link target: the THREAD root (its parent, or the
// parent's parent for a level-2 reply) — the detail page the member can open.
async function threadRootId(env, row) {
  const firstParent = await env.FORUM_DB.prepare(
    "SELECT id, parent_id FROM posts WHERE id = ? LIMIT 1",
  ).bind(Number(row.parent_id)).first();
  if (!firstParent || firstParent.parent_id === null || firstParent.parent_id === undefined) {
    return Number(row.parent_id);
  }
  return Number(firstParent.parent_id);
}

// The dispatch order IS the API contract (first handler claiming a route
// wins), so the chain lives here as an exported constant — tests/post-route-
// order.test.mjs pins the exact sequence, and the plan-2 split composer must
// assemble these same twelve from the split modules in this same order.
const POST_ROUTE_HANDLERS = [handlePostFeedRoute, handleRepliesReadRoute, handlePostDetailRoute, handleReplyCreateRoute, handlePostCreateRoute, handlePostEditRoute, handlePostEditHistoryRoute, handlePostDeleteRoute, handleReactionRoute, handleReactionDeleteRoute, handleSuggestionStatusRoute, handleSearchRoute];

async function handlePostRoutes(request, env, url, path, method, ctx) {
  const handlers = POST_ROUTE_HANDLERS;
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}

export { POST_ROUTE_HANDLERS, banFilterSql, handlePostRoutes, listRootPosts, listReplies };
