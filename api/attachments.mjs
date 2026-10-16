// Attachment intake, serving, and moderation helpers shared by the post and
// reply creation routes and the admin panel. Files arrive inside multipart/
// form-data bodies alongside the JSON-era text fields; bytes are D1 BLOBs
// stored CHUNKED in attachment_chunks (see migrations/0004_attachment_chunks.sql
// and migrations/0003_attachments.sql for the pre-chunk history) — D1 caps a
// single BLOB/row at 2,000,000 bytes, so any attachment above that size is
// split across rows. R2 is not enabled on this account.
import {
  HttpError,
  assertNotBanned,
  blobToUint8Array,
  createAvatarVersion,
  json,
  nowSeconds,
  readLimitedBody,
  readJson,
  readSession,
  requireModerator,
  securityHeaders,
  sniffImageMime,
} from "./shared.mjs";

export const MAX_ATTACHMENT_FILES = 3;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Per-chunk fill: a comfortable margin under D1's 2,000,000-byte BLOB/row cap.
export const MAX_ATTACHMENT_CHUNK_BYTES = 1_900_000;
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
        throw new HttpError(413, "Each image must be 10 MiB or smaller.");
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

// One metadata INSERT plus one attachment_chunks INSERT per chunk of each
// validated file, all riding in the same batch. Bytes are stored as
// kind='pending' (the terminal-before-review state); the approved set stays
// empty until a moderator approves. `db` is env.FORUM_DB; postId is the
// freshly inserted post/reply row id.
export async function insertAttachments(db, postId, createdBy, files) {
  if (files.length === 0) return [];
  const ids = [];
  const now = nowSeconds();
  const statements = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    ids.push(id);
    statements.push(
      db.prepare(
        "INSERT INTO attachments (id, post_id, created_by, created_at, status, version, mime) " +
          "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      ).bind(id, postId, createdBy, now, createAvatarVersion(), file.mime),
    );
    for (let seq = 0, offset = 0; offset < file.bytes.length; seq += 1, offset += MAX_ATTACHMENT_CHUNK_BYTES) {
      statements.push(
        db.prepare(
          "INSERT INTO attachment_chunks (attachment_id, kind, seq, data) VALUES (?, 'pending', ?, ?)",
        ).bind(id, seq, file.bytes.subarray(offset, offset + MAX_ATTACHMENT_CHUNK_BYTES)),
      );
    }
  }
  // One all-or-nothing batch: a failure partway through intake can never leave
  // a partial set of attachment metadata or orphaned chunk rows behind.
  await db.batch(statements);
  return ids;
}

// Concatenates an attachment's chunk set in seq order, or returns null when the
// set is empty ( callers turn that into the shared 404 — a status whose bytes
// are missing must never serve, fail-safe either way).
async function assembledChunkBytes(db, attachmentId, kind) {
  const result = await db.prepare(
    "SELECT data FROM attachment_chunks WHERE attachment_id = ? AND kind = ? ORDER BY seq",
  ).bind(attachmentId, kind).all();
  const chunks = (result.results || []).map((row) => blobToUint8Array(row.data));
  if (chunks.length === 0) return null;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// Serving — GET /api/attachments/:id?v=. Approved attachments serve their
// approved chunk set to anyone (no auth) with year-long immutable public
// caching — safe because every URL carries its `?v=` version, which is a cache
// buster only: mismatches or absence are never rejected or used as an
// authorization gate. Pending attachments serve the pending chunk set only to
// the author or to a moderator/admin, with a private five-minute cache.
// Rejected and unknown ids, and any non-rejected row whose required chunk set
// is empty, are a plain 404 — the endpoint never confirms an attachment's
// existence, much less serves half of one.
const ATTACHMENT_ID_ROUTE = /^\/api\/attachments\/([0-9a-f-]{36})$/;

async function handleAttachmentServingRoute(request, env, path, method) {
  const attachmentMatch = path.match(ATTACHMENT_ID_ROUTE);
  if (!attachmentMatch) return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");

  const row = await env.FORUM_DB.prepare(
    "SELECT id, status, created_by, mime FROM attachments WHERE id = ? LIMIT 1",
  ).bind(attachmentMatch[1]).first();
  if (!row) throw new HttpError(404, "Attachment not found.");

  if (row.status === "approved" && row.mime) {
    const bytes = await assembledChunkBytes(env.FORUM_DB, row.id, "approved");
    if (bytes) {
      const headers = securityHeaders();
      headers.set("Content-Type", row.mime);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("X-Content-Type-Options", "nosniff");
      // Stated explicitly: the chunk-concatenated length is known, and it tells
      // the client the total size regardless of how many chunks were joined.
      headers.set("Content-Length", String(bytes.length));
      return new Response(bytes, { status: 200, headers });
    }
    throw new HttpError(404, "Attachment not found.");
  }
  if (row.status === "pending") {
    const session = await readSession(request, env);
    const viewer = session && session.user;
    const isModerator = viewer && (viewer.role === "admin" || viewer.role === "moderator");
    if (viewer && (viewer.id === Number(row.created_by) || isModerator)) {
      const bytes = await assembledChunkBytes(env.FORUM_DB, row.id, "pending");
      if (bytes) {
        const headers = securityHeaders();
        headers.set("Content-Type", row.mime);
        headers.set("Cache-Control", "private, max-age=300");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Content-Length", String(bytes.length));
        return new Response(bytes, { status: 200, headers });
      }
    }
  }
  throw new HttpError(404, "Attachment not found.");
}

// Moderator desk for pending attachments: the oldest-first queue, then the
// approve/reject decisions. Role gates and the ban check mirror the avatar
// moderation routes in api/moderation.mjs. There is no size column; the queue
// computes sizeBytes in SQL from SUM(length(c.data)) over the pending chunks
// (and chunkCount alongside it for display). Unlike the avatar desk, a
// non-pending or unknown id is a 404 (the endpoint never confirms whether a
// rejected/unknown attachment exists), approval relabels the pending chunks
// kind='approved' in place alongside the status flip (two statements, one
// batch), rejection DELETEs the row entirely so its chunks cascade, and
// approval bumps to a NEW random version so the approved attachment's public
// URL cache-busts away from the pending version it had been serving under.
const ATTACHMENT_MODERATION_ROUTE =
  /^\/api\/admin\/attachments\/([0-9a-f-]{36})\/(approve|reject)$/;

async function handleAttachmentAdminRoutes(request, env, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/attachments" && method === "GET") {
    await requireModerator(request, env, false);
    const result = await db.prepare(
      "SELECT a.id, a.post_id, a.mime, a.created_at, u.username AS uploader, " +
        "SUM(length(c.data)) AS size_bytes, COUNT(c.seq) AS chunk_count " +
        "FROM attachments a JOIN users u ON u.id = a.created_by " +
        "LEFT JOIN attachment_chunks c ON c.attachment_id = a.id AND c.kind = 'pending' " +
        "WHERE a.status = 'pending' GROUP BY a.id ORDER BY a.created_at ASC LIMIT 100",
    ).bind().all();
    return json({
      attachments: (result.results || []).map((row) => ({
        id: row.id,
        postId: Number(row.post_id),
        uploader: row.uploader,
        mime: row.mime,
        sizeBytes: Number(row.size_bytes),
        chunkCount: Number(row.chunk_count),
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
      })),
    });
  }

  const moderationMatch = path.match(ATTACHMENT_MODERATION_ROUTE);
  if (!moderationMatch || method !== "POST") return null;

  const session = await requireModerator(request, env);
  await assertNotBanned(env, session.user.id);
  const attachmentId = moderationMatch[1];
  if (moderationMatch[2] === "approve") {
    // One all-or-nothing batch: the status flip (with a fresh random version so
    // the public URL cache-busts off the pending one) and the pending→approved
    // chunk relabel succeed or fail together. The changes guard reads back the
    // batch's first result, 404-ing a non-pending or unknown id.
    const results = await db.batch([
      db.prepare(
        "UPDATE attachments SET status = 'approved', version = ? WHERE id = ? AND status = 'pending'",
      ).bind(createAvatarVersion(), attachmentId),
      db.prepare(
        "UPDATE attachment_chunks SET kind = 'approved' WHERE attachment_id = ? AND kind = 'pending'",
      ).bind(attachmentId),
    ]);
    if (Number(results[0]?.meta?.changes) !== 1) {
      throw new HttpError(404, "Attachment not found.");
    }
    return json({ approved: true, id: attachmentId });
  }

  // Reject: 'rejected' is terminal with no bytes left behind — the row is
  // DELETEd and the FK cascade removes its chunks. Guarded by the pending
  // status; a non-pending or unknown id is a 404.
  const result = await db.prepare(
    "DELETE FROM attachments WHERE id = ? AND status = 'pending'",
  ).bind(attachmentId).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(404, "Attachment not found.");
  }
  return json({ rejected: true, id: attachmentId });
}

export async function handleAttachmentRoutes(request, env, url, path, method) {
  const serving = await handleAttachmentServingRoute(request, env, path, method);
  if (serving) return serving;
  const admin = await handleAttachmentAdminRoutes(request, env, path, method);
  if (admin) return admin;
  return null;
}

// Read-side metadata for serialized posts, shared by the feed, replies, and
// detail paths in api/posts.mjs. ONE batched lookup (post_id IN (…)) resolves
// a whole page — never a per-post query. Viewer semantics mirror
// handleAttachmentRoutes above: approved rows are visible to everyone
// (awaiting: false); pending rows are visible ONLY to the uploading account
// or a moderator/admin (awaiting: true) and are omitted ENTIRELY for everyone
// else, so a pending upload cannot leak even its existence through metadata;
// rejected rows (deleted since 0004, checked defensively anyway) are omitted
// for everyone. Returns a Map<postId, Array<
// { id, status, mime, version, awaiting }>>; ids without visible rows are
// simply absent — callers serialize an empty array, never null/undefined.
export async function attachmentRowsForView(db, postIds, viewer) {
  const byPost = new Map();
  if (!Array.isArray(postIds) || postIds.length === 0) return byPost;
  const ids = [...new Set(postIds.map(Number))];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(
    "SELECT id, post_id, status, created_by, version, mime " +
      "FROM attachments WHERE post_id IN (" + placeholders + ")",
  ).bind(...ids).all();
  const isModerator = Boolean(viewer) &&
    (viewer.role === "admin" || viewer.role === "moderator");
  const viewerId = viewer ? Number(viewer.id) : NaN;
  for (const row of result.results || []) {
    if (row.status === "rejected") continue;
    const visible = row.status === "approved" ||
      (Boolean(viewer) && (isModerator || Number(row.created_by) === viewerId));
    if (!visible) continue;
    const postId = Number(row.post_id);
    const rows = byPost.get(postId) || [];
    rows.push({
      id: row.id,
      status: row.status,
      mime: row.mime,
      version: row.version,
      awaiting: row.status === "pending",
    });
    byPost.set(postId, rows);
  }
  return byPost;
}