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
import { assembledGifBytes, GIF_FIELD } from "./gifs.mjs";

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
// - multipart/form-data: `images` file parts validated per file (per-file size
//   cap, then a magic-byte sniff — the client's declared filename/type is
//   never trusted), all remaining text parts returned as string fields.
//
// Peak-buffering policy: a declared Content-Length above the request ceiling is
// rejected 413 BEFORE any body buffering. When a Content-Length is declared
// (every real browser/fetch client sends one, and the runtime's HTTP framing
// delivers exactly that many bytes, so the ceiling holds), formData() runs
// DIRECTLY on the request stream — no full-body copy first, cutting the old
// worst case from ~3x the upload (buffer + form + per-file bytes) to ~2x. When
// NO Content-Length is declared (chunked transfer, hostile or exotic), the
// ceiling cannot be asserted from framing, request.formData() would buffer the
// stream unbounded, and a 128 MiB isolate is not a safe place for that — so
// that branch keeps readLimitedBody's counted buffering as the cap. The JSON
// branch is unchanged.
export async function readComposedBody(request, env) {
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) {
    // JSON bodies carry library-gif references as an array; the multipart
    // path carries repeatable gifIds text fields — both resolve the same.
    const parsed = await readJson(request);
    const gifIds = Array.isArray(parsed.gifIds) ? parsed.gifIds.map(String) : [];
    const gifEntries = await gifReferenceEntries(env.FORUM_DB, gifIds);
    return { fields: parsed, files: [], gifIds, gifEntries };
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_ATTACHMENT_REQUEST_BYTES) {
    throw new HttpError(413, "That upload is too large.");
  }

  let form;
  if (declaredLength > 0) {
    // The common, framing-backed path: parse straight off the request stream.
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "The upload could not be read.");
    }
  } else {
    // No declared length (chunked body): only the counted reader enforces the
    // ceiling, so buffer under it before parsing.
    const bufferedBody = await readLimitedBody(request, MAX_ATTACHMENT_REQUEST_BYTES);
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: bufferedBody,
      }).formData();
    } catch {
      throw new HttpError(400, "The upload could not be read.");
    }
  }

  const fields = {};
  const files = [];
  const gifIds = [];
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
      // v2.5 dedup + auto-approve: identical bytes to previously approved content
      // skip moderation, but direct file uploads still get their own chunks.
      const hash = await sha256Hex(bytes);
      const canonical = await lookupCanonicalByHash(env.FORUM_DB, hash);
      files.push({ mime, bytes, hash, preApproved: Boolean(canonical) });
    } else if (name === GIF_FIELD) {
      // Library GIFs attach BY REFERENCE (v2.5): repeatable gifIds text
      // fields; only ids resolving to an APPROVED gif pass — anything else
      // is a 400 (a pending/rejected gif cannot be attached).
      gifIds.push(String(value));
    } else if (typeof value === "string") {
      fields[name] = value;
    }
  }
  const gifEntries = await gifReferenceEntries(env.FORUM_DB, gifIds);
  return { fields, files, gifIds, gifEntries };
}

// Resolves library-gif ids to their approved rows ({ id, hash, mime } each):
// duplicates collapse, unknown/not-approved ids 400, and the count cap lives
// with the files' cap at the call site.
async function gifReferenceEntries(db, gifIds) {
  const entries = [];
  const seen = new Set();
  for (const raw of gifIds) {
    const id = String(raw);
    if (!/^([0-9a-f-]{36})$/.test(id)) throw new HttpError(400, "One of the selected GIFs is not available.");
    if (seen.has(id)) continue;
    seen.add(id);
    const gif = await db.prepare(
      "SELECT id, hash, mime FROM gifs WHERE id = ? AND status = 'approved' " +
      "AND NOT EXISTS (SELECT 1 FROM revoked_attachment_hashes r WHERE r.hash = gifs.hash) LIMIT 1",
    ).bind(id).first();
    if (!gif) throw new HttpError(400, "One of the selected GIFs is not available.");
    entries.push({ id: gif.id, hash: gif.hash, mime: gif.mime, file: false });
  }
  return entries;
}

// One metadata INSERT plus one attachment_chunks INSERT per chunk of each
// validated file, all riding in the same batch. New, unrecognized content is
// stored as kind='pending'; byte-identical direct uploads approved previously
// are stored as kind='approved' and own their chunks. Library GIF selections
// remain by-reference rows to the persistent approved GIF library. `db` is env.FORUM_DB.
// SHA-256 hex of the validated bytes (v2.5): dedup + auto-approve identity.
// WebCrypto has no blake3; SHA-256 has no practical collision attack at any
// scale that matters — the owner picked the algorithm by constraint.
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Content-addressed lookup (v2.5): finds existing approved content by hash.
// Direct file uploads now store their own chunks; the serving fallback remains
// for library-GIF reference rows and legacy duplicates created before migration
// 0020. Returns { mime, id } or null.
export async function lookupCanonicalByHash(db, hash) {
  if (!hash) return null;
  const revoked = await db.prepare(
    "SELECT 1 FROM revoked_attachment_hashes WHERE hash = ? LIMIT 1",
  ).bind(hash).first();
  if (revoked) return null;
  const row = await db.prepare(
    "SELECT a.id, a.mime FROM attachments a WHERE a.hash = ? AND a.status = 'approved' " +
    "AND EXISTS (SELECT 1 FROM attachment_chunks c WHERE c.attachment_id = a.id AND c.kind = 'approved') " +
    "ORDER BY a.created_at ASC LIMIT 1",
  ).bind(hash).first();
  if (row) return { mime: row.mime, id: row.id, table: "attachments" };
  const gif = await db.prepare(
    "SELECT g.id, g.mime FROM gifs g WHERE g.hash = ? AND g.status = 'approved' LIMIT 1",
  ).bind(hash).first();
  if (gif) return { mime: gif.mime, id: gif.id, table: "gifs" };
  return null;
}

export async function insertAttachments(db, postId, createdBy, files, gifEntries = []) {
  if (files.length === 0 && gifEntries.length === 0) return [];
  const ids = [];
  const useStats = [];
  const referenceInsertIndexes = [];
  const now = nowSeconds();
  const statements = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    ids.push(id);
    // Content-addressed dedup (v2.5): byte-identical content approved before
    // bypasses re-moderation, but never storage. files carry { mime, bytes,
    // preApproved } from readComposedBody after checking the approved hash.
    const preApproved = Boolean(file.preApproved);
    statements.push(
      db.prepare(
        "INSERT INTO attachments (id, post_id, created_by, created_at, status, version, mime, hash, source_kind) " +
          "SELECT ?, ?, ?, ?, CASE WHEN ? = 1 AND NOT EXISTS (" +
          "SELECT 1 FROM revoked_attachment_hashes WHERE hash = ?) THEN 'approved' ELSE 'pending' END, ?, ?, ?, 'upload'",
      ).bind(id, postId, createdBy, now, preApproved ? 1 : 0, file.hash,
        createAvatarVersion(), file.mime, file.hash),
    );
    // Keep an independent byte set for every attachment, even when identical
    // bytes were approved before. The hash grants approval, not shared storage
    // lifetime: the original post or GIF may later be removed.
    for (let seq = 0, offset = 0; offset < file.bytes.length; seq += 1, offset += MAX_ATTACHMENT_CHUNK_BYTES) {
      statements.push(
        db.prepare(
          "INSERT INTO attachment_chunks (attachment_id, kind, seq, data) " +
          "SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM attachments WHERE id = ? AND status = 'approved') " +
          "THEN 'approved' ELSE 'pending' END, ?, ?",
        ).bind(id, id, seq, file.bytes.subarray(offset, offset + MAX_ATTACHMENT_CHUNK_BYTES)),
      );
    }
  }
  for (const gif of gifEntries) {
    const id = crypto.randomUUID();
    ids.push(id);
    useStats.push(gif.id);
    referenceInsertIndexes.push(statements.length);
    statements.push(
      db.prepare(
        "INSERT INTO attachments (id, post_id, created_by, created_at, status, version, mime, hash, source_kind) " +
          "SELECT ?, ?, ?, ?, 'approved', ?, ?, ?, 'gif' WHERE EXISTS (" +
          "SELECT 1 FROM gifs g WHERE g.id = ? AND g.hash = ? AND g.mime = ? AND g.status = 'approved' " +
          "AND NOT EXISTS (SELECT 1 FROM revoked_attachment_hashes r WHERE r.hash = g.hash))",
      ).bind(id, postId, createdBy, now, createAvatarVersion(), gif.mime, gif.hash,
        gif.id, gif.hash, gif.mime),
    );
  }
  // One all-or-nothing batch: a failure partway through intake can never leave
  // a partial set of attachment metadata or orphaned chunk rows behind.
  const results = await db.batch(statements);
  for (const index of referenceInsertIndexes) {
    if (Number(results[index]?.meta?.changes) !== 1) {
      throw new HttpError(409, "One of the selected GIFs is no longer available.");
    }
  }
  for (const gifId of useStats) {
    // Best-effort popularity counter; never a post precondition.
    try {
      await db.batch([
        db.prepare("UPDATE gifs SET use_count = use_count + 1 WHERE id = ?").bind(gifId),
      ]);
    } catch {
      /* popularity is display-only */
    }
  }
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
    "SELECT id, status, created_by, mime, hash FROM attachments WHERE id = ? " +
    "AND (status <> 'approved' OR NOT EXISTS (SELECT 1 FROM revoked_attachment_hashes r WHERE r.hash = attachments.hash)) LIMIT 1",
  ).bind(attachmentMatch[1]).first();
  if (!row) throw new HttpError(404, "Attachment not found.");

  if (row.status === "approved" && row.mime) {
    let bytes = await assembledChunkBytes(env.FORUM_DB, row.id, "approved");
    let mime = row.mime;
    if (!bytes) {
      // Content-addressed dedup (v2.5): a deduplicated approved row stores no
      // bytes — its hash resolves the canonical byte-set (an older approved
      // attachment's chunks or an approved marketplace GIF). A vanished
      // canonical (its source was deleted later) is a 404 below — fail-safe.
      const canonical = row.hash
        ? await lookupCanonicalByHash(env.FORUM_DB, row.hash)
        : null;
      if (canonical) {
        bytes = canonical.table === "gifs"
          ? await assembledGifBytes(env.FORUM_DB, canonical.id)
          : await assembledChunkBytes(env.FORUM_DB, canonical.id, "approved");
        mime = canonical.mime;
      }
    }
    if (bytes) {
      const headers = securityHeaders();
      headers.set("Content-Type", mime);
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
    const pending = await db.prepare(
      "SELECT id FROM attachments WHERE id = ? AND status = 'pending'",
    ).bind(attachmentId).first();
    if (!pending) throw new HttpError(404, "Attachment not found.");
    const results = await db.batch([
      db.prepare(
        "UPDATE attachments SET status = 'approved', version = ? WHERE id = ? AND status = 'pending'",
      ).bind(createAvatarVersion(), attachmentId),
      db.prepare(
        "UPDATE attachment_chunks SET kind = 'approved' WHERE attachment_id = ? AND kind = 'pending'",
      ).bind(attachmentId),
      db.prepare(
        "DELETE FROM revoked_attachment_hashes WHERE hash = " +
        "(SELECT hash FROM attachments WHERE id = ? AND status = 'approved')",
      ).bind(attachmentId),
    ]);
    if (Number(results[0]?.meta?.changes) !== 1) {
      throw new HttpError(404, "Attachment not found.");
    }
    return json({ approved: true, id: attachmentId });
  }

  // Reject: 'rejected' is terminal with no bytes left behind — the row is
  // DELETEd and the FK cascade removes its chunks. The guard admits BOTH
  // pending AND approved statuses: an approved row also needs a removal path
  // when a moderator reconsiders an approval (rejected ids are terminal and
  // unknown ids never existed → both are the same 404). Browser/CDN caches
  // that already hold the previously served bytes keep them until they expire;
  // that is a documented out of scope here.
  const target = await db.prepare(
    "SELECT hash, status FROM attachments WHERE id = ? AND status IN ('pending', 'approved')",
  ).bind(attachmentId).first();
  if (!target) throw new HttpError(404, "Attachment not found.");
  if (target.status === "approved" && target.hash) {
    await db.batch([
      db.prepare(
        "INSERT INTO revoked_attachment_hashes (hash, revoked_at, revoked_by) VALUES (?, ?, ?) " +
        "ON CONFLICT(hash) DO UPDATE SET revoked_at = excluded.revoked_at, revoked_by = excluded.revoked_by",
      ).bind(target.hash, nowSeconds(), session.user.id),
      db.prepare("DELETE FROM attachments WHERE hash = ? AND status = 'approved'").bind(target.hash),
      db.prepare("DELETE FROM gifs WHERE hash = ? AND status = 'approved'").bind(target.hash),
    ]);
  } else {
    await db.prepare(
      "DELETE FROM attachments WHERE id = ? AND status IN ('pending', 'approved')",
    ).bind(attachmentId).run();
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
      "FROM attachments WHERE post_id IN (" + placeholders + ") " +
      "AND (status <> 'approved' OR NOT EXISTS (SELECT 1 FROM revoked_attachment_hashes r WHERE r.hash = attachments.hash)) " +
      // Deterministic strip order: attachments carry created_at (intake sets
      // it; several uploads in one post share the same intake second, so id
      // UUID breaks ties — stable even as row ordering never matters to
      // correctness but must not shuffle between reads).
      "ORDER BY created_at ASC, id ASC",
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
