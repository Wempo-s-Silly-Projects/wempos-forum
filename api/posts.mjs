// v4.0 plan 2 composer: the posts surface's dispatcher. The read routes,
// board vocabulary, and write routes have split into posts-feed.mjs,
// boards.mjs, and posts-write.mjs; this module keeps the reply routes,
// search, and suggestion-status until their own tasks, and composes the
// pinned POST_ROUTE_HANDLERS chain from the split modules' handlers.
import { REPLY_BUMP_SQL, SEARCH_USERS_SQL, THREAD_REPLY_INSERT_SQL, THREAD_REPLY_INSERT_STAGED_SQL } from "../constants.mjs";
import {
  insertAttachments,
  MAX_ATTACHMENT_FILES,
  readComposedBody,
} from "./attachments.mjs";
import { applyWordFilter } from "./filter.mjs";
import { notificationBatchStatements } from "./notifications.mjs";
import { mentionFanOutStatements } from "./mentions.mjs";
import { runFanOutChunks, subscriptionReplyFanOut } from "./subscriptions.mjs";
import { scheduleTextCheck } from "./textmod.mjs";
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
  attachSubReplyCounts,
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
import {
  MAX_COMPOSER_BODY_CHARS,
  existingIdempotentPost,
  getPostIdempotencyKey,
  handlePostCreateRoute,
  handlePostDeleteRoute,
  handlePostEditHistoryRoute,
  handlePostEditRoute,
  handleReactionDeleteRoute,
  handleReactionRoute,
  postCreationFingerprint,
  persistStagedPostAttachments,
  postDeletionStatements,
  replayIdempotentPost,
  scheduleAttachmentVisionChecks,
  throwIfArchivedIdempotencyKey,
} from "./posts-write.mjs";
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
  requireTurnstile,
  requireUser,
  requiredText,
  userByUsernameKey,
} from "./shared.mjs";

export { POST_SELECT };

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
    // Nuke rule (v3.0.1): replies never carry hidden/banned content inline —
    // showAll is gone; the desk's hidden-posts page is the only mod door.
    const page = await listReplies(env, postId,
      viewer, false, before, targetDepth + 1);
    // Level-1 rows can be replied to, so they need expand-counts; level-2 rows
    // never do (replying to them is server-forbidden), so no batch runs.
    const replies = targetDepth === 0
      ? await attachSubReplyCounts(env, page.replies, {
        showAll: false,
        viewerId: viewer ? viewer.id : null,
      })
      : page.replies;
    return json({ replies, nextBefore: page.nextBefore });
  }
  return null;
}

async function handleReplyCreateRoute(request, env, url, path, method, ctx) {
  const db = env.FORUM_DB;
  const replyMatch = path.match(/^\/api\/posts\/([0-9]+)\/replies$/);
  if (replyMatch && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    const idempotencyKey = getPostIdempotencyKey(request);
    const priorIdempotent = await existingIdempotentPost(db, session.user.id, idempotencyKey);
    if (priorIdempotent?.archived) {
      throw new HttpError(410, "This creation request already completed, but that post has since been deleted.");
    }
    const targetId = Number(replyMatch[1]);
    if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(404, "Post not found.");
    const isMultipart = (request.headers.get("Content-Type") || "").toLowerCase()
      .startsWith("multipart/form-data");
    const { fields, files, gifIds, gifEntries } = await readComposedBody(request, env, { replayPostId: priorIdempotent ? Number(priorIdempotent.id) : null });
    if (files.length + gifIds.length > MAX_ATTACHMENT_FILES) {
      throw new HttpError(400, "Attach up to " + MAX_ATTACHMENT_FILES + " images and GIFs.");
    }
    const message = applyWordFilter(requiredText(fields.body, "reply", MAX_COMPOSER_BODY_CHARS), env.FILTERED_WORDS);
    const idempotencyFingerprint = idempotencyKey
      ? await postCreationFingerprint({ kind: "reply", targetId, message, files, gifEntries })
      : null;
    const replay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
    if (replay) return replay;
    // Idempotent replays are checked before quota-consuming limits. Body parsing
    // is bounded; only a genuinely new submission consumes write/upload quota.
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    if (isMultipart || files.length > 0 || gifIds.length > 0) {
      await rateLimit(request, env, "image-upload", String(session.user.id));
    }

    const target = await postById(env, targetId, session.user.id);
    if (!target || target.visibility !== "public") {
      throw new HttpError(400, "Replies must be attached to a public conversation, not another reply.");
    }
    // The bump lands on the conversation root: the target itself, or the
    // target's parent (a public root) when replying to a level-1 reply.
    let bumpTargetId = Number(target.id);
    // Boards (v2.4.1): replies carry their thread ROOT's board, resolved from
    // the same rows the bump logic already fetched (the target when it is a
    // root, else its parent). The || normalization keeps rows from pre-board
    // projections at 'general'.
    let threadBoard = target.board || GENERAL_BOARD_DEFAULT;
    if (target.parent_id !== null && target.parent_id !== undefined) {
      const parent = await postById(env, Number(target.parent_id), session.user.id);
      if (!parent || parent.visibility !== "public") {
        throw new HttpError(400, "Replies must be attached to a public conversation, not another reply.");
      }
      if (parent.parent_id !== null && parent.parent_id !== undefined) {
        throw new HttpError(400, "Replies only go one level deep.");
      }
      bumpTargetId = Number(parent.id);
      threadBoard = parent.board || GENERAL_BOARD_DEFAULT;
    }
    // Banning auto-hides posts (v2.4.1): a reply into a banned author's thread
    // would create content nobody can see while the ban holds (hidden-post
    // parity — hidden roots already refuse replies via the visibility check
    // above). The viewer's exemptions mirror canViewPost: their own threads
    // and admins still pass. The depth refusal above stays authoritative; this
    // check runs after it so its own message is not shadowed.
    if (!(await canViewPost(env, target, session.user))) {
      throw new HttpError(400, "Replies are closed while this conversation's author is banned.");
    }
    await requireTurnstile(request, env, fields, "reply");
    const now = nowSeconds();
    const recipientId = target.author_id === null || target.author_id === undefined
      ? null
      : Number(target.author_id);
    const hasAttachments = files.length > 0 || gifEntries.length > 0;
    const insertSql = hasAttachments ? THREAD_REPLY_INSERT_STAGED_SQL : THREAD_REPLY_INSERT_SQL;
    const insertValues = hasAttachments
      ? [session.user.id, targetId, message, "hidden", now, now, threadBoard, idempotencyKey, idempotencyFingerprint, hasAttachments ? now : null, targetId, session.user.id, now, idempotencyKey, session.user.id, idempotencyKey]
      : [session.user.id, targetId, message, now, now, threadBoard, idempotencyKey, idempotencyFingerprint, null, targetId, session.user.id, now, idempotencyKey, session.user.id, idempotencyKey];
    const insertStatements = [db.prepare(insertSql).bind(...insertValues)];
    if (!hasAttachments) insertStatements.push(db.prepare(REPLY_BUMP_SQL).bind(now, bumpTargetId));
    let results;
    try {
      results = await db.batch(insertStatements);
    } catch (error) {
      await throwIfArchivedIdempotencyKey(db, session.user.id, idempotencyKey);
      const replay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
      if (replay) return replay;
      throw error;
    }
    if (Number(results[0]?.meta?.changes) !== 1) {
      // The atomic archive guard can reject a retry whose original post was
      // deleted after the earlier lookup. Re-read the archive to return 410.
      await throwIfArchivedIdempotencyKey(db, session.user.id, idempotencyKey);
      const archivedReplay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
      if (archivedReplay) return archivedReplay;
      throw new HttpError(409, "The conversation is no longer public or your account cannot post.");
    }
    const replyId = Number(results[0].meta.last_row_id);
    // Attachment-bearing replies stay hidden until the entire attachment batch
    // succeeds. The row id is always the new reply, not its bump target.
    if (hasAttachments) {
      const attachmentIds = await persistStagedPostAttachments(db, replyId, session.user.id, files, gifEntries, {
        bumpTargetId,
      });
      scheduleAttachmentVisionChecks(ctx, env, session.user.id, files, attachmentIds);
    } else {
      await insertAttachments(db, replyId, session.user.id, files, gifEntries);
    }
    try {
      // Best-effort fan-out in a second batch: the reply id only exists after
      // the insert above, and a failed notification must never fail the reply.
      // Thread subscriptions (C1) ride the same batch: every subscriber of the
      // ROOT is notified except the reply author and the reply's ordinary
      // target (both excluded in subscriptionReplyFanOut; the INSERT's own
      // NOT EXISTS guard dedupes both halves regardless).
      const statements = notificationBatchStatements(
        db, recipientId, session.user.id, targetId, replyId, now,
      );
      // Mentions (C2): @username tokens in the FILTERED body notify their
      // members unless that member is the ordinary target already notified
      // above (deduped; the INSERT's NOT EXISTS guard is the second net).
      statements.push(...await mentionFanOutStatements(db, message, {
        actorId: session.user.id,
        actorUsername: session.user.username,
        targetPostId: targetId,
        replyId,
        now,
        excludeIds: [recipientId],
      }));
      statements.push(...await subscriptionReplyFanOut(db, {
        rootPostId: bumpTargetId,
        replyAuthorId: session.user.id,
        replyTargetId: recipientId,
        targetPostId: targetId,
        replyId,
        now,
      }));
      // Chunked best-effort (fix round 1): ≤50-statement batches, one chunk
      // failing never killing the later chunks' notifications.
      await runFanOutChunks(db, statements);
    } catch {
      // Ignore: notifications are a convenience, not a reply precondition.
    }
    // Text auto-mod (v3.1): the fresh reply scores in the background; a trip
    // AUTO-HIDES it (never deletes — a mod or an approved appeal restores it
    // from the hidden-posts desk). The reply response never waits on Google.
    scheduleTextCheck(ctx, env, {
      kind: "post", entityId: replyId, userId: session.user.id,
      text: message, postId: bumpTargetId,
    });
    return json({ id: replyId }, 201);
  }
  return null;
}

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
