// v4.0 plan 3, Task 2: the avatar topic module — one lifecycle, one file.
// Intake lives here (upload + limits, from profiles.mjs), serving lives here
// (handleAvatarReadRoute, from shared.mjs), and the moderation queue lives
// here (queue + resolve + approve/reject routes, from moderation.mjs). All
// bodies moved verbatim; sources re-import through this module.
import { publicVisionVerdict, scheduleVisionCheck, visionVerdictsByEntity } from "./vision.mjs";
import {
  assertNotBanned,
  blobToUint8Array,
  createAvatarVersion,
  HttpError,
  imageResponse,
  json,
  nowSeconds,
  rateLimit,
  readLimitedBody,
  readSession,
  requireMutationApplied,
  requiremod,
  requireUser,
  sanitizeImage,
  sniffImageMime,
} from "./shared.mjs";

export const MAX_AVATAR_BYTES = 1024 * 1024;
export const MAX_AVATAR_REQUEST_BYTES = MAX_AVATAR_BYTES + 64 * 1024;

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
      const ismod = viewer && (viewer.role === "owner" || viewer.role === "admin");
      if (viewer && (viewer.id === userId || ismod)) {
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

async function handleAvatarUploadRoute(request, env, url, path, method, ctx) {
  const db = env.FORUM_DB;
  if (path === "/api/me/avatar" && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "avatar-upload", String(session.user.id));
    const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.startsWith("multipart/form-data;")) {
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
    const sanitized = sanitizeImage(bytes);
    if (!sanitized) {
      throw new HttpError(400, "That image could not be read. Try re-saving it and uploading again.");
    }
    const clean = sanitized.bytes;
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
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(mime, clean, updatedAt, avatarVersion, session.user.id, session.user.id, nowSeconds()).run();
    requireMutationApplied(result);
    // Vision first-pass (v3.1): the pending avatar gets its background check
    // too — an auto-mod trip clears the pending mirror exactly like a mod
    // rejection, so the previously approved avatar (if any) keeps serving.
    scheduleVisionCheck(ctx, env, {
      kind: "avatar",
      entityId: session.user.id,
      version: avatarVersion,
      bytes: clean,
      hash: null,
      userId: session.user.id,
    });
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
    await requiremod(request, env, false);
    const result = await db.prepare(
      "SELECT id, username, pending_avatar_updated_at, pending_avatar_version " +
        "FROM users WHERE avatar_status = 'pending' " +
        "ORDER BY pending_avatar_updated_at ASC LIMIT 100",
    ).bind().all();
    // Vision verdicts key on (kind 'avatar', user id), and carry the pending
    // version they describe: a re-upload while pending invalidates the old
    // report, so only a version match surfaces (stale rows read as absent).
    const verdicts = await visionVerdictsByEntity(db, "avatar",
      (result.results || []).map((row) => row.id));
    return json({
      avatars: (result.results || []).map((row) => {
        const verdict = verdicts.get(String(row.id));
        return {
          userId: Number(row.id),
          username: row.username,
          avatarUrl: "/api/avatars/" + row.id + "?v=" + row.pending_avatar_version,
          uploadedAt: new Date(Number(row.pending_avatar_updated_at) * 1000).toISOString(),
          vision: verdict && verdict.version === row.pending_avatar_version
            ? publicVisionVerdict(verdict)
            : null,
        };
      }),
    });
  }
  return null;
}

export async function resolveAvatarPending(db, userId, approve) {
  if (approve) {
    // Copy the pending set into the approved set and clear pending in one
    // statement — SQLite evaluates every RHS against the pre-update row, so
    // the mirror-set CHECKs hold. The avatar_status guard makes the update
    // idempotency-safe: 0 changes means nothing was awaiting review.
    const result = await db.prepare(
      "UPDATE users SET " +
        "avatar_mime = pending_avatar_mime, avatar_data = pending_avatar_data, " +
        "avatar_updated_at = pending_avatar_updated_at, avatar_version = pending_avatar_version, " +
        "pending_avatar_mime = NULL, pending_avatar_data = NULL, " +
        "pending_avatar_updated_at = NULL, pending_avatar_version = NULL, " +
        "avatar_status = 'approved' " +
        "WHERE id = ? AND avatar_status = 'pending'",
    ).bind(userId);
    const results = await db.batch([
      result,
      // The Vision report described the pending upload, now decided.
      db.prepare(
        "DELETE FROM vision_verdicts WHERE kind = 'avatar' AND entity_id = ?",
      ).bind(String(userId)),
    ]);
    if (Number(results[0].meta?.changes) !== 1) {
      throw new HttpError(409, "That avatar is not awaiting review.");
    }
    return;
  }
  // Reject: clear the pending set. An already-approved avatar reappears for
  // public serving; a first-upload has nothing left, so status returns to
  // the never-uploaded NULL. One statement with a CASE (documented choice
  // over a two-statement batch) keeps the guard and the transition atomic.
  const result = await db.prepare(
    "UPDATE users SET " +
      "pending_avatar_mime = NULL, pending_avatar_data = NULL, " +
      "pending_avatar_updated_at = NULL, pending_avatar_version = NULL, " +
      "avatar_status = CASE WHEN avatar_mime IS NOT NULL THEN 'approved' ELSE NULL END " +
      "WHERE id = ? AND avatar_status = 'pending'",
  ).bind(userId);
  const results = await db.batch([
    result,
    db.prepare(
      "DELETE FROM vision_verdicts WHERE kind = 'avatar' AND entity_id = ?",
    ).bind(String(userId)),
  ]);
  if (Number(results[0].meta?.changes) !== 1) {
    throw new HttpError(409, "That avatar is not awaiting review.");
  }
}

async function handleAvatarModerationRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/avatars\/([0-9]+)\/(approve|reject)$/);
  if (!match || method !== "POST") return null;

  const session = await requiremod(request, env);
  await assertNotBanned(env, session.user.id);
  const userId = Number(match[1]);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new HttpError(404, "Member not found.");
  }
  const db = env.FORUM_DB;
  const target = await db.prepare(
    "SELECT id FROM users WHERE id = ? LIMIT 1",
  ).bind(userId).first();
  if (!target) throw new HttpError(404, "Member not found.");

  await resolveAvatarPending(db, userId, match[2] === "approve");
  return json({ ok: true });
}

export {
  handleAvatarModerationRoute,
  handleAvatarQueueRoute,
  handleAvatarReadRoute,
  handleAvatarUploadRoute,
};
