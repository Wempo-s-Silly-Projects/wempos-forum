// v4.0 plan 2, Task 5: the write side of the posts surface — post/reply
// creation plumbing (idempotency family, staged attachments), the edit,
// history, delete, and reaction routes. Moved verbatim from api/posts.mjs.
// replies.mjs (Task 4) imports the shared create-side plumbing through here;
// the plan's "resolve at implementation" ruling places it here because both
// create routes (post + reply) consume it. Vision scheduling went away with
// the auto-mod removal (v4.2); the staged-attachment plumbing stayed.
import { STAGED_REPLY_BUMP_SQL } from "../constants.mjs";
import {
  insertAttachments,
  MAX_ATTACHMENT_FILES,
  readComposedBody,
} from "./attachments.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { UPDATES_BOARD, boardField } from "./boards.mjs";
import { mentionFanOutStatements } from "./mentions.mjs";
import { archivePostRowsStatement } from "./core/archive.mjs";
import { assertNotBanned, readSession, requireUser } from "./core/auth.mjs";
import { nowSeconds, sha256Hex } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requireMutationApplied, requireTurnstile, requiredText } from "./core/http.mjs";
import { postById } from "./core/shapers.mjs";
import { canViewPost } from "./core/visibility.mjs";

// Vision first-pass (v3.1): every freshly PENDING direct upload is background-
// Composer body cap (owner-set): root post AND reply bodies accept at most
// 4,750 characters (bumped from 1,000 on main, 2026-11-05). Kept module-local
// because constants.mjs holds platform-only constants; the frontend mirrors the
// number in public/js/composer-limits.js (COMPOSER_MAX_CHARS feeds both the
// textarea maxLength and the live counter — already at 4,750 there).
export const MAX_COMPOSER_BODY_CHARS = 4750;

export function getPostIdempotencyKey(request) {
  const key = request.headers.get("Idempotency-Key");
  if (key === null || key === "") return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new HttpError(400, "Invalid Idempotency-Key header.");
  }
  return key;
}

export const STAGED_IDEMPOTENCY_TTL_SECONDS = 30 * 60;

export async function existingIdempotentPost(db, authorId, key) {
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

export async function throwIfArchivedIdempotencyKey(db, authorId, key) {
  if (!key) return;
  const archived = await db.prepare(
    "SELECT 1 FROM post_archive WHERE author_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(authorId, key).first();
  if (archived) {
    throw new HttpError(410, "This creation request already completed, but that post has since been deleted.");
  }
}

export async function storedPostFingerprint(db, existing, fingerprint) {
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

export function assertIdempotencyFingerprint(existingFingerprint, fingerprint) {
  if (existingFingerprint && fingerprint && existingFingerprint !== fingerprint) {
    throw new HttpError(409, "Idempotency-Key was already used for a different submission. Submit again to create the changed content.");
  }
}

export async function replayIdempotentPost(db, authorId, key, fingerprint) {
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
export async function postCreationFingerprint({
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
export async function persistStagedPostAttachments(db, postId, authorId, files, gifEntries, options = {}) {
  const { bumpTargetId = null } = options;
  try {
    // The inserted attachment ids ride back out for the Vision first-pass
    // — but ONLY after the publish below
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

export async function handlePostCreateRoute(request, env, url, path, method, ctx) {
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
    const message = applyWordFilter(requiredText(fields.body, "post", MAX_COMPOSER_BODY_CHARS), filterWords(env));
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
export async function handlePostEditRoute(request, env, url, path, method, ctx) {
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
      filterWords(env),
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
    return json({ id: postId, editedAt: new Date(editedAt * 1000).toISOString() });
  }
  return null;
}

// Public edit history: anyone who can view the post can view every past
// version — the anti-abuse property trouserpants called for (edits can't
// quietly rewrite context). Guests included; visibility of a hidden post
// still applies via canViewPost. Past versions only, newest first.
export async function handlePostEditHistoryRoute(request, env, url, path, method) {
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

// Statement builder pinning the exact FK-safe SQL strings (POST_DELETE_SQL's
// cascade and REPLY_REPARENT_SQL's reparent semantics; tests/posts-write-
// module.test.mjs asserts the exact strings). parentId null means the target
// is a thread root.
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

export async function handlePostDeleteRoute(request, env, url, path, method) {
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

export async function handleReactionRoute(request, env, url, path, method) {
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
export async function handleReactionDeleteRoute(request, env, url, path, method) {
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
