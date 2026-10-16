// Attachment intake helpers shared by the post and reply creation routes.
// Files arrive inside multipart/form-data bodies alongside the JSON-era text
// fields; bytes are D1 BLOBs (see migrations/0003_attachments.sql — R2 is not
// enabled on this account).
import {
  HttpError,
  blobToUint8Array,
  createAvatarVersion,
  nowSeconds,
  readLimitedBody,
  readJson,
  readSession,
  securityHeaders,
  sniffImageMime,
} from "./shared.mjs";

export const MAX_ATTACHMENT_FILES = 3;
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
// Raw request ceiling covering all files plus multipart envelope overhead.
export const MAX_ATTACHMENT_REQUEST_BYTES = 3 * MAX_ATTACHMENT_BYTES + 512 * 1024;
const ATTACHMENT_FIELD = "images";

// Reads a post/reply creation body in either wire format, always returning the
// uniform { fields, files } shape the routes consume:
// - application/json: the pre-attachment behavior — the parsed object becomes
//   `fields`, `files` is empty.
// - multipart/form-data: buffered under the request ceiling, repeatable
//   `images` file parts validated per file (per-file size cap, then a magic-
//   byte sniff — the client's declared filename/type is never trusted), all
//   remaining text parts returned as string fields.
export async function readComposedBody(request, env) {
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) {
    return { fields: await readJson(request), files: [] };
  }

  const bufferedBody = await readLimitedBody(request, MAX_ATTACHMENT_REQUEST_BYTES);
  let form;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: bufferedBody,
    }).formData();
  } catch {
    throw new HttpError(400, "The upload could not be read.");
  }

  const fields = {};
  const files = [];
  for (const entry of form.entries()) {
    const [name, value] = entry;
    if (name === ATTACHMENT_FIELD) {
      if (typeof value === "string") continue;
      if (value.size > MAX_ATTACHMENT_BYTES) {
        throw new HttpError(413, "Each image must be 1 MiB or smaller.");
      }
      const bytes = new Uint8Array(await value.arrayBuffer());
      const mime = sniffImageMime(bytes);
      if (!mime) {
        throw new HttpError(400, "Only JPEG, PNG, WebP, and GIF images can be attached.");
      }
      files.push({ mime, bytes });
    } else if (typeof value === "string") {
      fields[name] = value;
    }
  }
  return { fields, files };
}

// One INSERT per validated file, all in the terminal-before-review 'pending'
// state; the approved pair stays empty until a moderator approves. `db` is
// env.FORUM_DB; postId is the freshly inserted post/reply row id.
export async function insertAttachments(db, postId, createdBy, files) {
  const ids = [];
  const now = nowSeconds();
  for (const file of files) {
    const id = crypto.randomUUID();
    await db.prepare(
      "INSERT INTO attachments (id, post_id, created_by, created_at, status, version, " +
        "pending_mime, pending_data, pending_updated_at) " +
        "VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
    ).bind(id, postId, createdBy, now, createAvatarVersion(), file.mime, file.bytes, now).run();
    ids.push(id);
  }
  return ids;
}

// Serving — GET /api/attachments/:id?v=. Mirrors the avatar reader in
// api/shared.mjs for response construction. Approved attachments serve their
// approved pair to anyone (no auth) with year-long immutable public caching —
// safe because every URL carries its `?v=` version, which is a cache buster
// only: mismatches or absence are never rejected or used as an authorization
// gate. Pending attachments serve the pending pair only to the author or to a
// moderator/admin, with a private five-minute cache. Rejected and unknown ids
// are a plain 404 — the endpoint never confirms an attachment's existence.
const ATTACHMENT_ID_ROUTE = /^\/api\/attachments\/([A-Za-z0-9-]{10,64})$/;

export async function handleAttachmentRoutes(request, env, url, path, method) {
  const attachmentMatch = path.match(ATTACHMENT_ID_ROUTE);
  if (!attachmentMatch) return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");

  const row = await env.FORUM_DB.prepare(
    "SELECT id, status, created_by, mime, data, pending_mime, pending_data " +
      "FROM attachments WHERE id = ? LIMIT 1",
  ).bind(attachmentMatch[1]).first();
  if (!row) throw new HttpError(404, "Attachment not found.");

  if (row.status === "approved" && row.mime && row.data) {
    const headers = securityHeaders();
    headers.set("Content-Type", row.mime);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(blobToUint8Array(row.data), { status: 200, headers });
  }
  if (row.status === "pending" && row.pending_mime && row.pending_data) {
    const session = await readSession(request, env);
    const viewer = session && session.user;
    const isModerator = viewer && (viewer.role === "admin" || viewer.role === "moderator");
    if (viewer && (viewer.id === Number(row.created_by) || isModerator)) {
      const headers = securityHeaders();
      headers.set("Content-Type", row.pending_mime);
      headers.set("Cache-Control", "private, max-age=300");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(blobToUint8Array(row.pending_data), { status: 200, headers });
    }
  }
  throw new HttpError(404, "Attachment not found.");
}