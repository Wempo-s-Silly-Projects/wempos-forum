// Post feed, post detail, replies, reactions, and search routes.
import { REPLY_BUMP_SQL, SEARCH_USERS_SQL, STAGED_REPLY_BUMP_SQL, THREAD_REPLY_INSERT_SQL, THREAD_REPLY_INSERT_STAGED_SQL } from "../constants.mjs";
import {
  insertAttachments,
  MAX_ATTACHMENT_FILES,
  readComposedBody,
} from "./attachments.mjs";
import { applyWordFilter } from "./filter.mjs";
import { notificationBatchStatements } from "./notifications.mjs";
import { mentionFanOutStatements } from "./mentions.mjs";
import { runFanOutChunks, subscriptionReplyFanOut } from "./subscriptions.mjs";
import { scheduleVisionCheck } from "./vision.mjs";
import { scheduleTextCheck } from "./textmod.mjs";
// v4.0 plan 2: board vocabulary + whitelist gate and the Suggestions score
// expression moved to their split module (Task 2).
import {
  GENERAL_BOARD_DEFAULT,
  SUGGESTIONS_BOARD,
  UPDATES_BOARD,
  boardField,
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

// Vision first-pass (v3.1): every freshly PENDING direct upload is background-
// checked right after its batch commits. Dedup twins (preApproved) skip it —
// identical bytes already passed a human review. Library GIF references are
// approved rows by construction and never checked here.
function scheduleAttachmentVisionChecks(ctx, env, authorId, files, ids) {
  files.forEach((file, index) => {
    if (file.preApproved) return;
    scheduleVisionCheck(ctx, env, {
      kind: "attachment",
      entityId: ids[index],
      bytes: file.bytes,
      hash: file.hash,
      userId: authorId,
    });
  });
}
import {
  archivePostRowsStatement,
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
  sha256Hex,
  userByUsernameKey,
  VIEW_INCREMENT_SQL,
} from "./shared.mjs";

export { POST_SELECT };

// Composer body cap (owner-set, post-spam response): root post AND reply
// bodies accept at most 1,000 characters. Kept module-local because
// constants.mjs holds platform-only constants; the frontend mirrors the number
// in public/js/composer-limits.js (COMPOSER_MAX_CHARS feeds both the textarea
// maxLength and the live counter).
const MAX_COMPOSER_BODY_CHARS = 1000;

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

function getPostIdempotencyKey(request) {
  const key = request.headers.get("Idempotency-Key");
  if (key === null || key === "") return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new HttpError(400, "Invalid Idempotency-Key header.");
  }
  return key;
}

const STAGED_IDEMPOTENCY_TTL_SECONDS = 30 * 60;

async function existingIdempotentPost(db, authorId, key) {
  if (!key) return null;
  const live = await db.prepare(
    "SELECT id, visibility, created_at, staged_at, idempotency_key, idempotency_fingerprint, " +
    "parent_id, body, board FROM posts WHERE author_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(authorId, key).first();
  if (live) return { ...live, archived: false };
  const archived = await db.prepare(
    "SELECT original_post_id AS id, 'archived' AS visibility, deleted_at AS created_at, " +
    "idempotency_key, idempotency_fingerprint FROM post_archive " +
    "WHERE author_id = ? AND idempotency_key = ? ORDER BY id DESC LIMIT 1",
  ).bind(authorId, key).first();
  return archived ? { ...archived, archived: true } : null;
}

async function throwIfArchivedIdempotencyKey(db, authorId, key) {
  if (!key) return;
  const archived = await db.prepare(
    "SELECT 1 FROM post_archive WHERE author_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(authorId, key).first();
  if (archived) {
    throw new HttpError(410, "This creation request already completed, but that post has since been deleted.");
  }
}

async function storedPostFingerprint(db, existing, fingerprint) {
  if (existing.idempotency_fingerprint || !fingerprint || existing.archived) {
    return existing.idempotency_fingerprint || null;
  }
  // Legacy rows predate persisted fingerprints. The current body is mutable:
  // the earliest post_edits snapshot is the original body (the edit route
  // snapshots the replaced version atomically with its first update).
  const originalEdit = await db.prepare(
    "SELECT body FROM post_edits WHERE post_id = ? ORDER BY id ASC LIMIT 1",
  ).bind(Number(existing.id)).first();
  if (originalEdit) {
    // The earliest edit snapshot establishes the original text, but legacy
    // rows have no creation-time media snapshot. Moderation may have removed
    // one or more attachments since creation, so combining that body with the
    // current attachment rows could falsely accept a changed payload. Fail
    // closed rather than claim a reliable full fingerprint we cannot prove.
    throw new HttpError(409, "This older creation request cannot be safely verified after edits. Submit again with a new Idempotency-Key.");
  }
  const storedAttachments = await db.prepare(
    "SELECT hash, mime FROM attachments WHERE post_id = ? ORDER BY hash, mime",
  ).bind(Number(existing.id)).all();
  return postCreationFingerprint({
    kind: existing.parent_id === null || existing.parent_id === undefined ? "post" : "reply",
    targetId: existing.parent_id === null || existing.parent_id === undefined ? null : Number(existing.parent_id),
    message: String(existing.body ?? ""),
    board: existing.board ?? null,
    attachments: storedAttachments.results || [],
  });
}

function assertIdempotencyFingerprint(existingFingerprint, fingerprint) {
  if (existingFingerprint && fingerprint && existingFingerprint !== fingerprint) {
    throw new HttpError(409, "Idempotency-Key was already used for a different submission. Submit again to create the changed content.");
  }
}

async function replayIdempotentPost(db, authorId, key, fingerprint) {
  if (!key) return null;
  let existing = await existingIdempotentPost(db, authorId, key);
  if (!existing) return null;
  let storedFingerprint = await storedPostFingerprint(db, existing, fingerprint);
  assertIdempotencyFingerprint(storedFingerprint, fingerprint);
  if (existing.archived) {
    throw new HttpError(410, "This creation request already completed, but that post has since been deleted.");
  }

  // Only explicit staged submissions are eligible for expiry. mod-hidden
  // posts have staged_at=NULL and must never be deleted by retry cleanup.
  if (existing.visibility === "hidden" && existing.staged_at !== null &&
      existing.staged_at !== undefined &&
      Number(existing.staged_at) <= nowSeconds() - STAGED_IDEMPOTENCY_TTL_SECONDS) {
    await db.prepare(
      "DELETE FROM posts WHERE id = ? AND author_id = ? AND idempotency_key = ? " +
      "AND visibility = 'hidden' AND staged_at IS NOT NULL AND staged_at <= ?",
    ).bind(Number(existing.id), authorId, key, nowSeconds() - STAGED_IDEMPOTENCY_TTL_SECONDS).run();
    existing = await existingIdempotentPost(db, authorId, key);
    if (!existing) return null;
    storedFingerprint = await storedPostFingerprint(db, existing, fingerprint);
    assertIdempotencyFingerprint(storedFingerprint, fingerprint);
    if (existing.archived) {
      throw new HttpError(410, "This creation request already completed, but that post has since been deleted.");
    }
  }

  if (existing.visibility !== "public") {
    throw new HttpError(409, "Your post is still being processed. Retry shortly.");
  }
  return json({ id: Number(existing.id) }, 200);
}
async function postCreationFingerprint({
  kind, targetId = null, message, board = null, files = [], gifEntries = [], attachments = null,
}) {
  // Direct uploads and library GIFs have the same visible effect. A sorted
  // multiset of (hash, MIME) pairs lets older rows be verified even though
  // source_kind did not exist when those rows were written.
  const media = (attachments || [
    ...files.map((file) => ({ hash: file.hash, mime: file.mime })),
    ...gifEntries.map((gif) => ({ hash: gif.hash, mime: gif.mime })),
  ]).map((item) => ({ hash: String(item.hash || ""), mime: String(item.mime || "") }))
    .sort((a, b) => (a.hash + ":" + a.mime).localeCompare(b.hash + ":" + b.mime));
  return sha256Hex(JSON.stringify({
    kind,
    targetId,
    message,
    board: kind === "post" ? board : null,
    attachments: media,
  }));
}

// Attachment rows reference a post id, so they are written after the post INSERT.
// Keep attachment-bearing posts hidden during that interval. If storage fails,
// the D1 attachment batch is atomic and deleting the hidden post removes any
// dependent rows; the client receives an error without a live duplicate on retry.
async function persistStagedPostAttachments(db, postId, authorId, files, gifEntries, options = {}) {
  const { bumpTargetId = null } = options;
  try {
    // The inserted attachment ids ride back out for the Vision first-pass
    // (scheduleAttachmentVisionChecks) — but ONLY after the publish below
    // runs: an early return here would strand every staged post hidden.
    const attachmentIds = await insertAttachments(db, postId, authorId, files, gifEntries);
    const publish = db.prepare(
      "UPDATE posts SET visibility = 'public', staged_at = NULL WHERE id = ? AND author_id = ? AND visibility = 'hidden' " +
      "AND staged_at IS NOT NULL " +
      "AND (parent_id IS NULL OR EXISTS (" +
      "SELECT 1 FROM posts target WHERE target.id = posts.parent_id AND target.visibility = 'public' AND (" +
      "target.parent_id IS NULL OR EXISTS (SELECT 1 FROM posts root WHERE root.id = target.parent_id " +
      "AND root.parent_id IS NULL AND root.visibility = 'public')))) " +
      "AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.post_id = posts.id AND a.status = 'approved' " +
      "AND EXISTS (SELECT 1 FROM revoked_attachment_hashes r WHERE r.hash = a.hash))",
    ).bind(postId, authorId);
    if (bumpTargetId !== null) {
      // Publish and bump together so the root activity clock does not advance
      // for a reply whose attachments failed to commit.
      const results = await db.batch([
        publish,
        db.prepare(STAGED_REPLY_BUMP_SQL).bind(nowSeconds(), bumpTargetId, postId),
      ]);
      if (Number(results[0]?.meta?.changes) !== 1) {
        throw new HttpError(409, "The conversation changed while your reply was being published. Please try again.");
      }
    } else {
      const result = await publish.run();
      if (Number(result?.meta?.changes) !== 1) {
        throw new HttpError(409, "Your post could not be published. Please try again.");
      }
    }
    return attachmentIds;
  } catch (error) {
    try {
      const cleanup = await db.prepare(
        "DELETE FROM posts WHERE id = ? AND author_id = ? AND visibility = 'hidden' AND staged_at IS NOT NULL",
      ).bind(postId, authorId).run();
      if (Number(cleanup?.meta?.changes) !== 1) {
        console.error("Could not remove a staged post after attachment failure:", {
          postId, attachmentError: error, cleanupResult: cleanup,
        });
      }
    } catch (cleanupError) {
      console.error("Could not remove a staged post after attachment failure:", {
        postId, attachmentError: error, cleanupError,
      });
    }
    throw error;
  }
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

async function handlePostCreateRoute(request, env, url, path, method, ctx) {
  const db = env.FORUM_DB;
  if (path === "/api/posts" && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    const idempotencyKey = getPostIdempotencyKey(request);
    const priorIdempotent = await existingIdempotentPost(db, session.user.id, idempotencyKey);
    if (priorIdempotent?.archived) {
      throw new HttpError(410, "This creation request already completed, but that post has since been deleted.");
    }
    const isMultipart = (request.headers.get("Content-Type") || "").toLowerCase()
      .startsWith("multipart/form-data");
    const { fields, files, gifIds, gifEntries } = await readComposedBody(request, env, { replayPostId: priorIdempotent ? Number(priorIdempotent.id) : null });
    if (files.length + gifIds.length > MAX_ATTACHMENT_FILES) {
      throw new HttpError(400, "Attach up to " + MAX_ATTACHMENT_FILES + " images and GIFs.");
    }
    const message = applyWordFilter(requiredText(fields.body, "post", MAX_COMPOSER_BODY_CHARS), env.FILTERED_WORDS);
    // The board rides the same fields object in both wire formats (JSON field
    // or multipart text part); absent/empty defaults to 'general', unknown
    // values 400 before any insert.
    const board = boardField(fields.board);
    // Updates category (v3.1): staff-only topics — everyone can read and
    // reply, but only admins and the owner start them. The session's public
    // role is the gate (member → 403).
    if (board === UPDATES_BOARD &&
        session.user.role !== "owner" && session.user.role !== "admin") {
      throw new HttpError(403, "Only admins can post updates.");
    }
    const idempotencyFingerprint = idempotencyKey
      ? await postCreationFingerprint({ kind: "post", message, board, files, gifEntries })
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

    await requireTurnstile(request, env, fields, "post");
    const now = nowSeconds();
    // A fresh root starts its activity clock at creation time. When it carries
    // attachments it stays hidden until their batch is durable, so a failed
    // upload cannot leave a live post that the user unknowingly duplicates.
    const hasAttachments = files.length > 0 || gifEntries.length > 0;
    // Both values are fixed server-owned SQL literals; keeping visibility out of
    // the bind list preserves the established root-post bind order.
    const visibilitySql = hasAttachments ? "'hidden'" : "'public'";
    let result;
    try {
      result = await db.prepare(
        "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, idempotency_key, idempotency_fingerprint, staged_at) " +
          "SELECT ?, NULL, ?, " + visibilitySql + ", ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
          "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
          "AND (expires_at IS NULL OR expires_at > ?)) " +
          "AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM post_archive archived " +
          "WHERE archived.author_id = ? AND archived.idempotency_key = ?))",
      ).bind(session.user.id, message, now, now, board, idempotencyKey, idempotencyFingerprint, hasAttachments ? now : null, session.user.id, now, idempotencyKey, session.user.id, idempotencyKey).run();
    } catch (error) {
      await throwIfArchivedIdempotencyKey(db, session.user.id, idempotencyKey);
      const replay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
      if (replay) return replay;
      throw error;
    }
    if (Number(result?.meta?.changes) !== 1) {
      // A concurrent delete may archive the same author/key after the replay
      // lookup. The INSERT guard prevents resurrection; surface the archived
      // request as gone rather than a generic mutation failure.
      await throwIfArchivedIdempotencyKey(db, session.user.id, idempotencyKey);
      const archivedReplay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
      if (archivedReplay) return archivedReplay;
      requireMutationApplied(result);
    }
    const postId = Number(result.meta.last_row_id);
    if (hasAttachments) {
      const attachmentIds = await persistStagedPostAttachments(db, postId, session.user.id, files, gifEntries);
      scheduleAttachmentVisionChecks(ctx, env, session.user.id, files, attachmentIds);
    } else {
      await insertAttachments(db, postId, session.user.id, files, gifEntries);
    }
    try {
      // Mentions (C2): @username tokens in the FILTERED body notify their
      // members, best-effort — a failed mention never fails the post. There
      // is no reply id yet, and the fresh root's own id is the target.
      const mentionStatements = await mentionFanOutStatements(db, message, {
        actorId: session.user.id,
        actorUsername: session.user.username,
        targetPostId: postId,
        replyId: postId,
        now,
        excludeIds: [],
      });
      if (mentionStatements.length > 0) await db.batch(mentionStatements);
    } catch {
      // Ignore: mentions are a convenience, not a post precondition.
    }
    // Text auto-mod (v3.1): the fresh root scores in the background; a trip
    // auto-hides it (never deletes). Runs after the staged publish above, so
    // the hide guard always sees the final public visibility.
    scheduleTextCheck(ctx, env, {
      kind: "post", entityId: postId, userId: session.user.id,
      text: message, postId,
    });
    return json({ id: postId }, 201);
  }
  return null;
}

// Author post edits (v2.4): PATCH /api/posts/:id covers BOTH roots and replies
// (both are rows in posts). Access is author-only by session identity — no role
// path (a mod gets no edit power here), and the author may edit even a
// hidden own post. Content gates mirror create exactly: requiredText semantics
// with MAX_COMPOSER_BODY_CHARS and the word filter REAPPLIED, storing the
// masked body. last_activity_at is deliberately absent from the UPDATE — an
// edit must never bump the feed; edited_at (migration 0005) marks the edit
// instead. Turnstile is deliberately NOT required (owner-approved default):
// the editor is already session-verified (same-origin + CSRF + session via
// requireUser) and the content path reuses create's filter/limit gates, so a
// token would add friction without any new trust decision. Edits are text-only
// in v1: attachments stay exactly as originally posted.
async function handlePostEditRoute(request, env, url, path, method, ctx) {
  const db = env.FORUM_DB;
  const editMatch = path.match(/^\/api\/posts\/([0-9]+)$/);
  if (editMatch && method === "PATCH") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const postId = Number(editMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!post) throw new HttpError(404, "Post not found.");
    if (Number(post.author_id) !== session.user.id) {
      throw new HttpError(403, "Only the author can edit this post.");
    }
    const body = await readJson(request);
    const message = applyWordFilter(
      requiredText(body.body, "post", MAX_COMPOSER_BODY_CHARS),
      env.FILTERED_WORDS,
    );
    const editedAt = nowSeconds();
    // Edit history (v2.4.1): the version being REPLACED is snapshotted into
    // post_edits inside the same atomic batch as the UPDATE, stamped with the
    // time it became current (COALESCE(edited_at, created_at) — a first edit
    // therefore snapshots the original at its creation). Past versions only:
    // the current body always lives on the posts row itself.
    const replacedBody = String(post.body ?? "");
    const becameCurrentAt = Number(post.edited_at || post.created_at);
    // The author_id clause re-checks ownership at write time (TOCTOU guard) and
    // doubles as the no-race 404: a row deleted between the read and the write
    // changes nothing (the batch rolls back, history included).
    const results = await db.batch([
      db.prepare(
        "INSERT INTO post_edits (post_id, editor_id, body, edited_at) VALUES (?, ?, ?, ?)",
      ).bind(postId, session.user.id, replacedBody, becameCurrentAt),
      db.prepare(
        "UPDATE posts SET body = ?, edited_at = ? WHERE id = ? AND author_id = ?",
      ).bind(message, editedAt, postId, session.user.id),
    ]);
    if (Number(results[1]?.meta?.changes) !== 1) throw new HttpError(404, "Post not found.");
    // Text auto-mod (v3.1): edits re-score — edits must never quietly
    // rewrite past a trip. If an unreversed auto_text action already exists
    // for this post the task no-ops (the post is already hidden; the appeal
    // path owns unhiding).
    scheduleTextCheck(ctx, env, {
      kind: "post", entityId: postId, userId: session.user.id,
      text: message, postId: Number(post.parent_id || postId),
    });
    return json({ id: postId, editedAt: new Date(editedAt * 1000).toISOString() });
  }
  return null;
}

// Public edit history: anyone who can view the post can view every past
// version — the anti-abuse property trouserpants called for (edits can't
// quietly rewrite context). Guests included; visibility of a hidden post
// still applies via canViewPost. Past versions only, newest first.
async function handlePostEditHistoryRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const historyMatch = path.match(/^\/api\/posts\/([0-9]+)\/edits$/);
  if (historyMatch && method === "GET") {
    const postId = Number(historyMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const row = await postById(env, postId, viewer && viewer.id ? viewer.id : null);
    if (!row || !(await canViewPost(env, row, viewer))) throw new HttpError(404, "Post not found.");
    const result = await db.prepare(
      "SELECT body, edited_at FROM post_edits WHERE post_id = ? ORDER BY edited_at DESC, id DESC",
    ).bind(postId).all();
    return json({
      edits: (result.results || []).map((edit) => ({
        body: edit.body,
        editedAt: new Date(Number(edit.edited_at) * 1000).toISOString(),
      })),
    });
  }
  return null;
}

// Author post deletion (v2.4.1 feature, shipped without a version bump): DELETE /api/posts/:id. Access is author-only
// by session identity — no role path (a mod gets no delete power here),
// exactly the same gates as the edit route (requireUser + assertNotBanned +
// the write and post-write rate limit scopes). The TOCTOU guard mirrors the
// edit route: the author_id clause runs at write time, so a non-author racing
// the ownership read cannot delete, and an already-gone post reports 404.
//
// FK analysis (migrations 0001/0002/0003/0004, D1 keeps enforcement ON, all
// actions fire immediately, no post-deletion statements may be orphaned):
//   posts.parent_id    → posts(id) ON DELETE CASCADE — replies cascade
//   reactions.post_id  → posts(id) ON DELETE CASCADE
//   reports.post_id    → posts(id) ON DELETE CASCADE
//   notifications.target_post_id / reply_id → posts(id) ON DELETE CASCADE
//   attachments.post_id → posts(id) ON DELETE CASCADE; attachment_chunks →
//     attachments(id) ON DELETE CASCADE (chunk bytes die with the attachment)
// So deleting a ROOT post takes the whole thread (including other users'
// replies and every child row above) with ONE guarded DELETE — no explicit
// child cleanup is needed or performed. Deleting a REPLY must preserve the
// conversation: its sub-replies are REPARENTED to the thread root first (one
// UPDATE, in the same atomic batch as the delete), so nobody else's content
// is lost; the reply's own reactions/reports/notifications/attachments
// cascade away with the reply row. The reparent is also why the batch order
// is fixed: parent_id must leave the deleted id before the CASCADE runs, or
// SQLite would cascade the sub-replies away instead.
export const POST_DELETE_SQL =
  "DELETE FROM posts WHERE id = ? AND author_id = ?";
export const REPLY_REPARENT_SQL = "UPDATE posts SET parent_id = ? WHERE parent_id = ?";

// Statement builder shared with the real-SQLite FK tests (tests/deletions.test.mjs
// runs these exact SQL strings against migrations 0001–0006 to pin the cascade
// and reparent semantics). parentId null means the target is a thread root.
export function postDeletionStatements(db, authorId, postId, parentId, { archiveReason, deletedAt, deletedByUserId = authorId, deletedByName = null } = {}) {
  // Accountability archive (v2.4.1): the doomed rows are copied into
  // post_archive FIRST, in the same atomic batch. A root delete archives the
  // whole thread — including other members' replies, which cascade away with
  // it. A reply delete archives just that row (its sub-replies are reparented,
  // so their content stays live). Omit {archiveReason, deletedAt} to delete
  // without archiving (legacy callers / tests).
  const archiveStatements = [];
  if (archiveReason) {
    const isRoot = parentId === null || parentId === undefined;
    archiveStatements.push(archivePostRowsStatement(
      db,
      isRoot
        ? "p.id = ? OR p.parent_id = ? OR p.parent_id IN (SELECT id FROM posts WHERE parent_id = ?)"
        : "p.id = ?",
      isRoot ? [postId, postId, postId] : [postId],
      archiveReason,
      deletedAt,
      deletedByUserId,
      deletedByName,
    ));
  }
  const deletePost = db.prepare(POST_DELETE_SQL).bind(postId, authorId);
  if (parentId === null || parentId === undefined) {
    return [...archiveStatements, deletePost];
  }
  return [...archiveStatements, db.prepare(REPLY_REPARENT_SQL).bind(parentId, postId), deletePost];
}

async function handlePostDeleteRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const deleteMatch = path.match(/^\/api\/posts\/([0-9]+)$/);
  if (deleteMatch && method === "DELETE") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const postId = Number(deleteMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!post) throw new HttpError(404, "Post not found.");
    if (Number(post.author_id) !== session.user.id) {
      throw new HttpError(403, "Only the author can delete this post.");
    }
    const parentId = post.parent_id === null || post.parent_id === undefined
      ? null
      : Number(post.parent_id);
    const results = await db.batch(postDeletionStatements(
      db, session.user.id, postId, parentId,
      { archiveReason: "post-delete", deletedAt: nowSeconds(), deletedByUserId: session.user.id, deletedByName: session.user.username },
    ));
    // The author-guarded DELETE must be the statement that changed exactly one
    // row; a 0-change delete means the post vanished between the read and the
    // write (or ownership shifted) — report 404, never a false success. A
    // 0-change reparent only means the reply had no sub-replies.
    if (Number(results[results.length - 1]?.meta?.changes) !== 1) {
      throw new HttpError(404, "Post not found.");
    }
    return json({ deleted: true });
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
