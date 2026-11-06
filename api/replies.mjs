// v4.0 plan 2, Task 4: the reply routes — the replies page read and reply
// creation. Moved verbatim from api/posts.mjs.
//
// Seams (both one-directional): decorations come from posts-feed.mjs
// (listReplies, attachSubReplyCounts — the Task-3 ruling keeps listReplies in
// the read module); shared creation plumbing comes from posts-write.mjs
// (idempotency family, staged persistence, attachment staging —
// the Task-5 ruling places it there since both create routes consume it).
import { REPLY_BUMP_SQL, THREAD_REPLY_INSERT_SQL, THREAD_REPLY_INSERT_STAGED_SQL } from "../constants.mjs";
import { insertAttachments, MAX_ATTACHMENT_FILES, readComposedBody } from "./attachments.mjs";
import { applyWordFilter } from "./filter.mjs";
import { GENERAL_BOARD_DEFAULT } from "./boards.mjs";
import { notificationBatchStatements } from "./notifications.mjs";
import { mentionFanOutStatements } from "./mentions.mjs";
import { runFanOutChunks, subscriptionReplyFanOut } from "./subscriptions.mjs";
import { attachSubReplyCounts, listReplies } from "./posts-feed.mjs";
import {
  MAX_COMPOSER_BODY_CHARS,
  existingIdempotentPost,
  getPostIdempotencyKey,
  persistStagedPostAttachments,
  postCreationFingerprint,
  replayIdempotentPost,
  throwIfArchivedIdempotencyKey,
} from "./posts-write.mjs";
import { assertNotBanned, readSession, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, requireTurnstile, requiredText } from "./core/http.mjs";
import { postById } from "./core/shapers.mjs";
import { canViewPost } from "./core/visibility.mjs";

export async function handleRepliesReadRoute(request, env, url, path, method) {
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

export async function handleReplyCreateRoute(request, env, url, path, method, ctx) {
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
    return json({ id: replyId }, 201);
  }
  return null;
}
