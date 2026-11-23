
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
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// v4.0 plan 3, Task 2: the avatar topic module — one lifecycle, one file.
// Intake lives here (upload + limits, from profiles.mjs), serving lives here
// (handleAvatarReadRoute), and the moderation queue lives
// here (queue + resolve + approve/reject routes, from moderation.mjs). All
// bodies moved verbatim; sources re-import through this module.
import { assertNotBanned, readSession, requireStaff, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, isMultipartRequest, json, rateLimit, readJson, readLimitedBody, requireMutationApplied } from "./core/http.mjs";
import { blobToUint8Array, createAvatarVersion, imageResponse, inspectImageUpload, sniffImageMime } from "./core/images.mjs";

export const MAX_AVATAR_BYTES = 1024 * 1024;
export const MAX_AVATAR_REQUEST_BYTES = MAX_AVATAR_BYTES + 64 * 1024;

// createAvatarVersion() encodes 12 random bytes as unpadded base64url.
const AVATAR_VERSION_PATTERN = /^[A-Za-z0-9_-]{16}$/;

function isAvatarVersion(value) {
  return typeof value === "string" &&
    AVATAR_VERSION_PATTERN.test(value) &&
    value.length === 16;
}

// Avatar serving (moved here from the session group — registered on the
// profiles route group, since avatars belong to profiles). Approved avatars
// serve to anyone with public cache headers. Whenever a pending upload exists
// (first-ever upload or a re-upload over an approved avatar), its bytes are
// visible to the account owner and to staff — reviewers must see
// the candidate even when an approved avatar is still serving publicly —
// uncacheable; everyone else sees the approved avatar or 404. The session is
// only consulted when a pending set exists, so guest 404s never read sessions.
async function handleAvatarReadRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const avatarMatch = path.match(/^\/api\/avatars\/([0-9]+)$/);
  if (avatarMatch) {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    const userId = Number(avatarMatch[1]);
    if (!Number.isSafeInteger(userId) || userId < 1) throw new HttpError(404, "Picture not found.");
    const row = await db.prepare(
      "SELECT avatar_status, avatar_mime, avatar_data, pending_avatar_mime, pending_avatar_data FROM users WHERE id = ? LIMIT 1",
    ).bind(userId).first();
    if (!row) throw new HttpError(404, "Picture not found.");

    if (row.pending_avatar_mime && row.pending_avatar_data) {
      const session = await readSession(request, env);
      const viewer = session && session.user;
      const isStaff = viewer && (viewer.role === "owner" || viewer.role === "admin");
      if (viewer && (Number(viewer.id) === userId || isStaff)) {
        const response = imageResponse(blobToUint8Array(row.pending_avatar_data), row.pending_avatar_mime, "no-store");
        if (response) return response;
      }
    }

    if (row.avatar_mime && row.avatar_data) {
      const response = imageResponse(blobToUint8Array(row.avatar_data), row.avatar_mime, "public, max-age=3600");
      if (response) return response;
    }

    throw new HttpError(404, "Picture not found.");
  }
  return null;
}

async function handleAvatarUploadRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me/avatar" && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "avatar-upload", String(session.user.id));
    if (!isMultipartRequest(request)) {
      throw new HttpError(415, "Upload a JPEG, PNG, or WebP image.");
    }
    const bufferedBody = await readLimitedBody(request, MAX_AVATAR_REQUEST_BYTES);
    let form;
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: bufferedBody,
      }).formData();
    } catch {
      throw new HttpError(400, "The image upload could not be read.");
    }
    const file = form.get("avatar");
    if (!(file instanceof File) || file.size < 1) throw new HttpError(400, "Choose an image to upload.");
    if (file.size > MAX_AVATAR_BYTES) throw new HttpError(413, "Profile pictures must be 1 MiB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);
    if (!mime) throw new HttpError(415, "Only JPEG, PNG, and WebP images are supported.");
    // Polyglot/metadata defense (mirrors attachment + gallery intake): strip
    // text-carrying segments and appended payloads before anything is stored.
    const inspected = await inspectImageUpload(bytes);
    if (!inspected) {
      throw new HttpError(400, "That image could not be read. Try re-saving it and uploading again.");
    }
    const clean = inspected.bytes;
    const updatedAt = nowSeconds();
    const avatarVersion = createAvatarVersion();
    // Uploads always land in the pending mirror set: any previously approved
    // avatar keeps serving publicly until a mod approves this upload.
    // Re-uploading while pending replaces the pending bytes in place. The
    // schema CHECKs keep avatar_status='pending' and the pending set all-or-
    // nothing within this single statement's write.
    const result = await db.prepare(
      "UPDATE users SET pending_avatar_mime = ?, pending_avatar_data = ?, " +
        "pending_avatar_updated_at = ?, pending_avatar_version = ?, avatar_status = 'pending' " +
        "WHERE id = ? AND NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?)",
    ).bind(mime, clean, updatedAt, avatarVersion, session.user.id, session.user.id, nowSeconds()).run();
    requireMutationApplied(result);
    return json({
      avatarUrl: "/api/avatars/" + session.user.id + "?v=" + avatarVersion,
      avatarStatus: "pending",
    });
  }
  return null;
}

// Pending avatar moderation queue: oldest uploads first, capped at 100.
async function handleAvatarQueueRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/avatars" && method === "GET") {
    await requireStaff(request, env, false);
    const result = await db.prepare(
      "SELECT id, username, pending_avatar_updated_at, pending_avatar_version " +
        "FROM users WHERE avatar_status = 'pending' " +
        "ORDER BY pending_avatar_updated_at ASC LIMIT 100",
    ).all();
    return json({
      avatars: (result.results || []).map((row) => ({
        userId: Number(row.id),
        username: row.username,
        avatarUrl: "/api/avatars/" + row.id + "?v=" + row.pending_avatar_version,
        // Both approval and rejection must match this exact upload version.
        // A replacement upload while the desk page is open invalidates the
        // old queue action instead of applying it to the replacement.
        pendingVersion: row.pending_avatar_version,
        uploadedAt: new Date(Number(row.pending_avatar_updated_at) * 1000).toISOString(),
      })),
    });
  }
  return null;
}

export async function resolveAvatarPending(db, userId, approve, pendingVersion) {
  if (!isAvatarVersion(pendingVersion)) {
    throw new HttpError(400, "A valid reviewed avatar version is required.");
  }

  if (approve) {
    // Copy the pending set into the approved set and clear pending in one
    // statement — SQLite evaluates every RHS against the pre-update row, so
    // the mirror-set CHECKs hold. Both the status and version guards ensure
    // this action applies only to the exact upload the moderator reviewed.
    const result = await db.prepare(
      "UPDATE users SET " +
        "avatar_mime = pending_avatar_mime, avatar_data = pending_avatar_data, " +
        "avatar_updated_at = pending_avatar_updated_at, avatar_version = pending_avatar_version, " +
        "pending_avatar_mime = NULL, pending_avatar_data = NULL, " +
        "pending_avatar_updated_at = NULL, pending_avatar_version = NULL, " +
        "avatar_status = 'approved' " +
        "WHERE id = ? AND avatar_status = 'pending' AND pending_avatar_version = ?",
    ).bind(userId, pendingVersion).run();

    if (Number(result.meta?.changes) !== 1) {
      throw new HttpError(409,
        "That avatar changed since it was reviewed — reload the desk and review the current upload.");
    }
    return;
  }

  // Reject: clear only the exact pending upload that was reviewed. If the
  // member replaced it after the queue was loaded, the version guard leaves
  // the replacement untouched and the moderator must reload the queue.
  // An already-approved avatar reappears publicly; a first-upload has
  // nothing left, so status returns to the never-uploaded NULL.
  const result = await db.prepare(
    "UPDATE users SET " +
      "pending_avatar_mime = NULL, pending_avatar_data = NULL, " +
      "pending_avatar_updated_at = NULL, pending_avatar_version = NULL, " +
      "avatar_status = CASE WHEN avatar_mime IS NOT NULL THEN 'approved' ELSE NULL END " +
      "WHERE id = ? AND avatar_status = 'pending' AND pending_avatar_version = ?",
  ).bind(userId, pendingVersion).run();

  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409,
      "That avatar changed since it was reviewed — reload the desk and review the current upload.");
  }
}

async function handleAvatarModerationRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/avatars\/([0-9]+)\/(approve|reject)$/);
  if (!match || method !== "POST") return null;

  const session = await requireStaff(request, env);
  await assertNotBanned(env, session.user.id);
  const userId = Number(match[1]);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new HttpError(404, "Member not found.");
  }

  const body = await readJson(request);
  if (!isAvatarVersion(body?.pendingVersion)) {
    throw new HttpError(400, "A valid reviewed avatar version is required.");
  }

  const db = env.FORUM_DB;
  const target = await db.prepare(
    "SELECT id FROM users WHERE id = ? LIMIT 1",
  ).bind(userId).first();
  if (!target) throw new HttpError(404, "Member not found.");

  await resolveAvatarPending(
    db,
    userId,
    match[2] === "approve",
    body.pendingVersion,
  );
  return json({ ok: true });
}

export {
  handleAvatarModerationRoute,
  handleAvatarQueueRoute,
  handleAvatarReadRoute,
  handleAvatarUploadRoute,
};
