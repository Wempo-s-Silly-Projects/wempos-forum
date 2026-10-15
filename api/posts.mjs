// Post feed, post detail, replies, reactions, and search routes.
import { REPLY_BUMP_SQL, SEARCH_USERS_SQL, THREAD_REPLY_INSERT_SQL } from "../constants.mjs";
import { insertAttachments, MAX_ATTACHMENT_FILES, readComposedBody } from "./attachments.mjs";
import { applyWordFilter } from "./filter.mjs";
import { notificationBatchStatements } from "./notifications.mjs";
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
  requireMutationApplied,
  requireTurnstile,
  requireUser,
  requiredText,
} from "./shared.mjs";

export { POST_SELECT };

async function listRootPosts(env, viewerId, options = {}) {
  let sql = POST_SELECT + "WHERE p.parent_id IS NULL AND p.visibility = 'public' ";
  const values = [viewerId || -1];
  if (options.byActivity) {
    // Feed order: most recently bumped conversation first, id as the tiebreaker.
    // Pagination walks the composite key (last_activity_at, id) so a shared
    // timestamp cannot skip or duplicate rows.
    const cursor = options.before;
    if (cursor) {
      sql += "AND (p.last_activity_at < ? OR (p.last_activity_at = ? AND p.id < ?)) ";
      values.push(cursor.seconds, cursor.seconds, cursor.id);
    }
    sql += "ORDER BY p.last_activity_at DESC, p.id DESC LIMIT 21";
    const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
    const rows = result.results || [];
    const hasMore = rows.length > 20;
    const shown = rows.slice(0, 20);
    const last = shown.length ? shown[shown.length - 1] : null;
    return {
      // Root queries only (parent_id IS NULL): every shown row is a level-0 root.
      posts: shown.map((row) => publicPost(row, 0)),
      nextBefore: hasMore && last
        ? Number(last.last_activity_at) + "_" + Number(last.id)
        : null,
    };
  }
  if (options.before !== null && options.before !== undefined) {
    sql += "AND p.id < ? ";
    values.push(options.before);
  }
  if (options.authorId) {
    sql += "AND p.author_id = ? ";
    values.push(options.authorId);
  }
  if (options.searchTerm) {
    sql += "AND instr(lower(p.body), ?) > 0 ";
    values.push(options.searchTerm);
  }
  sql += "ORDER BY p.id DESC LIMIT 21";
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  const rows = result.results || [];
  const hasMore = rows.length > 20;
  const shown = rows.slice(0, 20).map((row) => publicPost(row, 0));
  return { posts: shown, nextBefore: hasMore && shown.length ? shown[shown.length - 1].id : null };
}

async function listReplies(env, postId, viewerId, showAll = false, before = null,
  childPublicLevel) {
  const visibilityFilter = showAll ? "" : "AND (p.visibility = 'public' OR p.author_id = ?) ";
  const cursorFilter = before === null ? "" : "AND p.id < ? ";
  const sql = POST_SELECT + "WHERE p.parent_id = ? " + cursorFilter +
    visibilityFilter + "ORDER BY p.id DESC LIMIT 101";
  const values = [viewerId || -1, postId];
  if (before !== null) values.push(before);
  if (!showAll) values.push(viewerId || -1);
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  const rows = result.results || [];
  const hasMore = rows.length > 100;
  const shown = rows.slice(0, 100);
  const nextBefore = hasMore && shown.length ? Number(shown[shown.length - 1].id) : null;
  // Children of a known-depth target are target depth + 1 (root children are
  // level-1 replies, level-1 children are level-2 replies). When the caller
  // does not pass a level the field is omitted, keeping clients conservative.
  return { replies: shown.map((row) => publicPost(row, childPublicLevel)).reverse(), nextBefore };
}

async function handlePostFeedRoute(request, env, url, path, method) {
  if (path === "/api/posts" && method === "GET") {
    const session = await readSession(request, env);
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      const cursorMatch = /^([0-9]{1,10})_([0-9]{1,10})$/.exec(beforeRaw);
      if (!cursorMatch) throw new HttpError(400, "That page cursor is invalid.");
      before = { seconds: Number(cursorMatch[1]), id: Number(cursorMatch[2]) };
    }
    const feed = await listRootPosts(env, session && session.user ? session.user.id : null, {
      before,
      byActivity: true,
    });
    return json(feed);
  }
  return null;
}

// Per-reply sub-reply counts go out as ONE D1 batch (one subrequest) — a
// per-reply query loop can exceed the Workers subrequest cap on busy roots.
// Viewer visibility mirrors listReplies: admins see every child, everyone else
// counts only public or their own. Results map back by statement order.
async function attachSubReplyCounts(env, replies, { showAll, viewerId }) {
  if (!replies.length) return replies;
  const countSql = "SELECT COUNT(*) AS sub_reply_count FROM posts WHERE parent_id = ?" +
    (showAll ? "" : " AND (visibility = 'public' OR author_id = ?)");
  const countResults = await env.FORUM_DB.batch(
    replies.map((reply) => env.FORUM_DB.prepare(countSql)
      .bind(...(showAll ? [reply.id] : [reply.id, viewerId || -1]))),
  );
  return replies.map((reply, index) => {
    const countRow = countResults[index] && countResults[index].results
      ? countResults[index].results[0]
      : null;
    return {
      ...reply,
      subReplyCount: countRow ? Number(countRow.sub_reply_count || 0) : 0,
    };
  });
}

async function handleRepliesReadRoute(request, env, url, path, method) {
  const repliesReadMatch = path.match(/^\/api\/posts\/([0-9]+)\/replies$/);
  if (repliesReadMatch && method === "GET") {
    const postId = Number(repliesReadMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const parent = await postById(env, postId, viewer ? viewer.id : null);
    if (!(await canViewPost(env, parent, viewer))) {
      throw new HttpError(404, "Post not found.");
    }
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      if (!/^[1-9][0-9]{0,14}$/.test(beforeRaw)) throw new HttpError(400, "That reply cursor is invalid.");
      before = Number(beforeRaw);
    }
    // Each returned child is one level below the target: target is a root when
    // its parent_id is null (children are level-1), else a level-1 reply
    // (children are level-2).
    const targetDepth = parent.parent_id ? 1 : 0;
    const showAll = Boolean(viewer && viewer.role === "admin");
    const page = await listReplies(env, postId, viewer ? viewer.id : null,
      showAll, before, targetDepth + 1);
    // Level-1 rows can be replied to, so they need expand-counts; level-2 rows
    // never do (replying to them is server-forbidden), so no batch runs.
    const replies = targetDepth === 0
      ? await attachSubReplyCounts(env, page.replies, {
        showAll,
        viewerId: viewer ? viewer.id : null,
      })
      : page.replies;
    return json({ replies, nextBefore: page.nextBefore });
  }
  return null;
}

async function handlePostDetailRoute(request, env, url, path, method) {
  const postMatch = path.match(/^\/api\/posts\/([0-9]+)$/);
  if (postMatch && method === "GET") {
    const postId = Number(postMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const viewerId = viewer ? viewer.id : null;
    const showAll = Boolean(viewer && viewer.role === "admin");
    const row = await postById(env, postId, viewerId);
    if (!(await canViewPost(env, row, viewer))) throw new HttpError(404, "Post not found.");
    // Depth annotation: this post is a root when parent_id is null, else a
    // level-1 reply; its direct replies are one level deeper.
    const detailDepth = row.parent_id ? 1 : 0;
    const post = publicPost(row, detailDepth);
    const replyPage = await listReplies(env, postId, viewerId, showAll, null,
      detailDepth + 1);
    // Same batched count pattern as the replies page (attachSubReplyCounts).
    post.replies = await attachSubReplyCounts(env, replyPage.replies, {
      showAll,
      viewerId,
    });
    post.repliesNextBefore = replyPage.nextBefore;
    return json(post);
  }
  return null;
}

async function handleReplyCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const replyMatch = path.match(/^\/api\/posts\/([0-9]+)\/replies$/);
  if (replyMatch && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const targetId = Number(replyMatch[1]);
    if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(404, "Post not found.");
    const target = await postById(env, targetId, session.user.id);
    if (!target || target.visibility !== "public") {
      throw new HttpError(400, "Replies must be attached to a public conversation, not another reply.");
    }
    // The bump lands on the conversation root: the target itself, or the
    // target's parent (a public root) when replying to a level-1 reply.
    let bumpTargetId = Number(target.id);
    if (target.parent_id !== null && target.parent_id !== undefined) {
      const parent = await postById(env, Number(target.parent_id), session.user.id);
      if (!parent || parent.visibility !== "public") {
        throw new HttpError(400, "Replies must be attached to a public conversation, not another reply.");
      }
      if (parent.parent_id !== null && parent.parent_id !== undefined) {
        throw new HttpError(400, "Replies only go one level deep.");
      }
      bumpTargetId = Number(parent.id);
    }
    const { fields, files } = await readComposedBody(request, env);
    // Image-heavy posts pay a per-account image-upload limit before any
    // validation or insert work happens (ordering constraint).
    if (files.length > 0) {
      await rateLimit(request, env, "image-upload", String(session.user.id));
    }
    if (files.length > MAX_ATTACHMENT_FILES) {
      throw new HttpError(400, "Attach up to " + MAX_ATTACHMENT_FILES + " images.");
    }
    await requireTurnstile(request, env, fields, "reply");
    const message = applyWordFilter(requiredText(fields.body, "reply", 2000), env.FILTERED_WORDS);
    const now = nowSeconds();
    const recipientId = target.author_id === null || target.author_id === undefined
      ? null
      : Number(target.author_id);
    const results = await db.batch([
      db.prepare(THREAD_REPLY_INSERT_SQL)
        .bind(session.user.id, targetId, message, now, now, targetId, session.user.id, now),
      db.prepare(REPLY_BUMP_SQL).bind(now, bumpTargetId),
    ]);
    if (Number(results[0]?.meta?.changes) !== 1) {
      throw new HttpError(409, "The conversation is no longer public or your account cannot post.");
    }
    const replyId = Number(results[0].meta.last_row_id);
    // Attachments bind the reply's own row id, never the bump target's.
    await insertAttachments(db, replyId, session.user.id, files);
    try {
      // Best-effort fan-out in a second batch: the reply id only exists after
      // the insert above, and a failed notification must never fail the reply.
      const statements = notificationBatchStatements(
        db, recipientId, session.user.id, targetId, replyId, now,
      );
      if (statements.length > 0) await db.batch(statements);
    } catch {
      // Ignore: notifications are a convenience, not a reply precondition.
    }
    return json({ id: replyId }, 201);
  }
  return null;
}

async function handlePostCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/posts" && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const { fields, files } = await readComposedBody(request, env);
    // Image-heavy posts pay a per-account image-upload limit before any
    // validation or insert work happens (ordering constraint).
    if (files.length > 0) {
      await rateLimit(request, env, "image-upload", String(session.user.id));
    }
    if (files.length > MAX_ATTACHMENT_FILES) {
      throw new HttpError(400, "Attach up to " + MAX_ATTACHMENT_FILES + " images.");
    }
    await requireTurnstile(request, env, fields, "post");
    const message = applyWordFilter(requiredText(fields.body, "post", 2000), env.FILTERED_WORDS);
    const now = nowSeconds();
    // A fresh root starts its activity clock at creation time.
    const result = await db.prepare(
      "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at) " +
        "SELECT ?, NULL, ?, 'public', ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(session.user.id, message, now, now, session.user.id, now).run();
    requireMutationApplied(result);
    const postId = Number(result.meta.last_row_id);
    await insertAttachments(db, postId, session.user.id, files);
    return json({ id: postId }, 201);
  }
  return null;
}

async function handleReactionRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const reactionMatch = path.match(/^\/api\/posts\/([0-9]+)\/reaction$/);
  if (reactionMatch && method === "PUT") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "reaction", String(session.user.id));
    const postId = Number(reactionMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
    const body = await readJson(request);
    if (body.value !== "like" && body.value !== "dislike") {
      throw new HttpError(400, "Choose like or dislike.");
    }
    const result = await db.prepare(
      "INSERT INTO reactions (post_id, user_id, value, created_at) " +
        "SELECT ?, ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?)) " +
        "ON CONFLICT(post_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at",
    ).bind(postId, session.user.id, body.value, nowSeconds(), session.user.id, nowSeconds()).run();
    requireMutationApplied(result);
    return json({ ok: true });
  }
  return null;
}

// Reaction removal mirror of the PUT toggle. Registered after handleReactionRoute
// so PUT keeps its behavior; anything else hitting this path is a 405 method gate.
// Idempotent by design: 0 changed rows is still { ok: true } — a missing reaction
// is exactly the state the caller wanted. The request body is never read.
async function handleReactionDeleteRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const reactionMatch = path.match(/^\/api\/posts\/([0-9]+)\/reaction$/);
  if (reactionMatch) {
    if (method !== "DELETE") throw new HttpError(405, "That method is not supported.");
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "reaction", String(session.user.id));
    const postId = Number(reactionMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
    await db.prepare("DELETE FROM reactions WHERE post_id = ? AND user_id = ?")
      .bind(postId, session.user.id).run();
    return json({ ok: true });
  }
  return null;
}

async function handleSearchRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/search" && method === "GET") {
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (!query || query.length > 100) {
      if (!query) return json({ users: [], posts: [] });
      throw new HttpError(400, "Search must be 1–100 characters long.");
    }
    const session = await readSession(request, env);
    const viewerId = session && session.user ? session.user.id : null;
    const users = await db.prepare(SEARCH_USERS_SQL).bind(query, query).all();
    const posts = await listRootPosts(env, viewerId, { searchTerm: query });
    return json({
      users: (users.results || []).map(publicUser),
      posts: posts.posts,
    });
  }
  return null;
}

async function handlePostRoutes(request, env, url, path, method) {
  const handlers = [handlePostFeedRoute, handleRepliesReadRoute, handlePostDetailRoute, handleReplyCreateRoute, handlePostCreateRoute, handleReactionRoute, handleReactionDeleteRoute, handleSearchRoute];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }
  return null;
}

export { handlePostRoutes, listRootPosts, listReplies };