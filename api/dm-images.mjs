// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Pictures in DMs (v4.7, migration 0044). Intake is the attachment
// pipeline's: the 10 MiB per-image cap, the magic-byte sniff (the client's
// declared type is never trusted), sanitizeImage's metadata/appended-payload
// strip, the SHA-256 identity checked against revoked_attachment_hashes, and
// the image-upload rate limiter. Bytes are D1 BLOB chunks (R2 is not
// configured). An upload stores the image AND its message — the body is the
// `[img:<uuid>]` token — in one batch, with the same gates as a text send.
// DM images are private: no moderation queue, no public cache. Serving
// answers only signed-in members of the image's own conversation; every
// other case (outsider, removed member, block pair with the uploader, banned
// uploader, revoked hash, unknown id) is the same 404.
import { assertNotBanned, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { blockPairExists } from "./core/blocks.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readLimitedBody } from "./core/http.mjs";
import { blobToUint8Array, imageResponse, sanitizeImage, sniffImageMime } from "./core/images.mjs";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_CHUNK_BYTES, sha256Hex } from "./attachments.mjs";
import { activeBanSql, groupMessageStatements, loadGroupForMember } from "./dm-groups.mjs";
import { isoTime } from "./chat.mjs";

const IMAGE_FIELD = "image";
// One image plus the multipart envelope.
const MAX_DM_IMAGE_REQUEST_BYTES = MAX_ATTACHMENT_BYTES + 64 * 1024;
const PRIVATE_CACHE = "private, max-age=300";
const THREAD_IMAGES_ROUTE = /^\/api\/dm\/threads\/([0-9]{1,15})\/images$/;
const GROUP_IMAGES_ROUTE = /^\/api\/dm\/groups\/([0-9]{1,15})\/images$/;
const IMAGE_ROUTE = /^\/api\/dm\/images\/([0-9a-f-]{36})$/;
const NOT_FOUND = "Image not found.";

async function readUploadForm(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_DM_IMAGE_REQUEST_BYTES) throw new HttpError(413, "That upload is too large.");
  try {
    if (declaredLength > 0) return await request.formData();
    // No declared length (chunked body): buffer under the ceiling first, the
    // attachment intake's own rule.
    const buffered = await readLimitedBody(request, MAX_DM_IMAGE_REQUEST_BYTES);
    return await new Request(request.url, { method: "POST", headers: request.headers, body: buffered }).formData();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "The upload could not be read.");
  }
}

// The validated image: { mime, bytes, hash } or a 400/413.
async function readDmImage(request, env) {
  const form = await readUploadForm(request);
  const file = form.get(IMAGE_FIELD);
  if (!file || typeof file === "string") throw new HttpError(400, "Choose an image first.");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "Each image must be 10 MiB or smaller.");
  const raw = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(raw);
  if (!mime) throw new HttpError(400, "Only JPEG, PNG, WebP, and GIF images can be sent.");
  const sanitized = sanitizeImage(raw);
  if (!sanitized) throw new HttpError(400, "That image could not be read. Try re-saving it and sending again.");
  const hash = await sha256Hex(sanitized.bytes);
  const revoked = await env.FORUM_DB.prepare(
    "SELECT 1 FROM revoked_attachment_hashes WHERE hash = ? LIMIT 1",
  ).bind(hash).first();
  if (revoked) throw new HttpError(400, "That image cannot be sent.");
  return { mime, bytes: sanitized.bytes, hash };
}

// The image row + its chunk rows, bound to exactly one conversation.
function imageStatements(db, imageId, uploaderId, conversation, image, now) {
  const statements = [db.prepare(
    "INSERT INTO dm_images (id, uploader_id, thread_id, group_id, mime, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(imageId, uploaderId, conversation.threadId ?? null, conversation.groupId ?? null, image.mime, image.hash, now)];
  for (let seq = 0, offset = 0; offset < image.bytes.length; seq += 1, offset += MAX_ATTACHMENT_CHUNK_BYTES) {
    statements.push(db.prepare("INSERT INTO dm_image_chunks (image_id, seq, data) VALUES (?, ?, ?)")
      .bind(imageId, seq, image.bytes.subarray(offset, offset + MAX_ATTACHMENT_CHUNK_BYTES)));
  }
  return statements;
}

function createdMessage(session, messageId, body, now) {
  return json({
    message: {
      id: messageId,
      body,
      authorId: session.user.id,
      authorUsername: session.user.username,
      mine: true,
      createdAt: isoTime(now),
    },
  }, 201);
}

// POST /api/dm/threads/:id/images — the 1:1 send's gates (participant, ban,
// rate, block pair), then image + message + the other side's unread bump.
async function handleThreadImageRoute(request, env, url, path, method) {
  const match = path.match(THREAD_IMAGES_ROUTE);
  if (!match || method !== "POST") return null;
  const session = await requireUser(request, env);
  const viewerId = Number(session.user.id);
  const thread = await env.FORUM_DB.prepare("SELECT id, user_a, user_b FROM dm_threads WHERE id = ? LIMIT 1")
    .bind(Number(match[1])).first();
  if (!thread) throw new HttpError(404, "That conversation does not exist.");
  const viewerIsA = Number(thread.user_a) === viewerId;
  if (!viewerIsA && Number(thread.user_b) !== viewerId) {
    throw new HttpError(403, "That conversation is not available.");
  }
  await assertNotBanned(env, viewerId);
  await rateLimit(request, env, "image-upload");
  if (await blockPairExists(env, viewerId, viewerIsA ? Number(thread.user_b) : Number(thread.user_a))) {
    throw new HttpError(403, "That conversation is not available.");
  }
  const image = await readDmImage(request, env);
  const db = env.FORUM_DB;
  const imageId = crypto.randomUUID();
  const body = "[img:" + imageId + "]";
  const now = nowSeconds();
  const bumpColumn = viewerIsA ? "unread_b" : "unread_a";
  const statements = imageStatements(db, imageId, viewerId, { threadId: Number(thread.id) }, image, now);
  const messageIndex = statements.length;
  statements.push(
    db.prepare("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
      .bind(Number(thread.id), viewerId, body, now),
    db.prepare("UPDATE dm_threads SET " + bumpColumn + " = " + bumpColumn + " + 1 WHERE id = ?")
      .bind(Number(thread.id)),
  );
  const results = await db.batch(statements);
  return createdMessage(session, Number(results[messageIndex].meta?.last_row_id), body, now);
}

// POST /api/dm/groups/:id/images — the group send's gates, then image +
// message + every other member's unread bump.
async function handleGroupImageRoute(request, env, url, path, method) {
  const match = path.match(GROUP_IMAGES_ROUTE);
  if (!match || method !== "POST") return null;
  const session = await requireUser(request, env);
  const viewerId = Number(session.user.id);
  const group = await loadGroupForMember(env, Number(match[1]), viewerId);
  await assertNotBanned(env, viewerId);
  await rateLimit(request, env, "image-upload");
  const image = await readDmImage(request, env);
  const db = env.FORUM_DB;
  const imageId = crypto.randomUUID();
  const body = "[img:" + imageId + "]";
  const now = nowSeconds();
  const statements = imageStatements(db, imageId, viewerId, { groupId: Number(group.id) }, image, now);
  const messageIndex = statements.length;
  statements.push(...groupMessageStatements(db, Number(group.id), viewerId, body, now));
  const results = await db.batch(statements);
  return createdMessage(session, Number(results[messageIndex].meta?.last_row_id), body, now);
}

// GET /api/dm/images/:id — membership, ban, block and revocation all live in
// the one SELECT; a miss on any of them is the same 404.
async function handleImageServeRoute(request, env, url, path, method) {
  const match = path.match(IMAGE_ROUTE);
  if (!match) return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  const session = await requireSignedInRead(request, env);
  const viewerId = Number(session.user.id);
  const row = await env.FORUM_DB.prepare(
    "SELECT i.id, i.mime FROM dm_images i WHERE i.id = ? AND (" +
    "(i.thread_id IS NOT NULL AND EXISTS (SELECT 1 FROM dm_threads t WHERE t.id = i.thread_id " +
    "AND (t.user_a = ? OR t.user_b = ?))) OR " +
    "(i.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM dm_group_members gm WHERE gm.group_id = i.group_id " +
    "AND gm.user_id = ?))) " +
    "AND NOT " + activeBanSql("i.uploader_id") + " " +
    "AND NOT EXISTS (SELECT 1 FROM revoked_attachment_hashes r WHERE r.hash = i.hash) " +
    "AND (i.uploader_id = ? OR NOT EXISTS (SELECT 1 FROM blocks bk WHERE " +
    "(bk.blocker_id = ? AND bk.blocked_id = i.uploader_id) OR (bk.blocked_id = ? AND bk.blocker_id = i.uploader_id))) " +
    "LIMIT 1",
  ).bind(match[1], viewerId, viewerId, viewerId, viewerId, viewerId, viewerId).first();
  if (!row) throw new HttpError(404, NOT_FOUND);
  const chunks = ((await env.FORUM_DB.prepare("SELECT data FROM dm_image_chunks WHERE image_id = ? ORDER BY seq")
    .bind(row.id).all()).results || []).map((chunk) => blobToUint8Array(chunk.data));
  if (chunks.length === 0) throw new HttpError(404, NOT_FOUND);
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.length;
  }, 0);
  // Egress re-verification: a stored MIME that no longer matches the bytes
  // fails safe as the same 404.
  const response = imageResponse(bytes, row.mime, PRIVATE_CACHE);
  if (!response) throw new HttpError(404, NOT_FOUND);
  return response;
}

export async function handleDmImageRoutes(request, env, url, path, method, ctx) {
  if (!path.startsWith("/api/dm/")) return null;
  const handlers = [handleThreadImageRoute, handleGroupImageRoute, handleImageServeRoute];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}
