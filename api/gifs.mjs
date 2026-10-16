// GIF marketplace (v2.5): a shared library of GIFs members upload once and
// everyone can use. Moderation mirrors the attachments desk: uploads land
// pending (the uploader and moderators see them), approve → approved (and,
// via the per-hash UNIQUE index, a duplicate of already-approved bytes
// returns the EXISTING gif instead of new storage). Posts attach approved
// gifs by reference — no byte copies; use_count tracks popularity.
import {
  HttpError,
  assertNotBanned,
  blobToUint8Array,
  createAvatarVersion,
  json,
  nowSeconds,
  rateLimit,
  readLimitedBody,
  readSession,
  requireModerator,
  requireUser,
  securityHeaders,
  sniffImageMime,
} from "./shared.mjs";

export const GIF_FIELD = "gifIds";

export const MAX_GIF_BYTES = 10 * 1024 * 1024;
const GIFS_LIST_LIMIT = 100;
export const GIF_ID_ROUTE = /^\/api\/gifs\/([0-9a-f-]{36})$/;
const GIF_ADMIN_ROUTE = /^\/api\/admin\/gifs\/([0-9a-f-]{36})\/(approve|reject)$/;
const GIF_CHUNK_BYTES = 2_000_000 - 100_000;

export async function handleGifRoutes(request, env, url, path, method) {
  const serving = await handleGifServingRoute(request, env, path, method);
  if (serving) return serving;
  const upload = await handleGifUploadRoute(request, env, path, method);
  if (upload) return upload;
  const list = await handleGifListRoute(request, env, path, method);
  if (list) return list;
  const admin = await handleGifAdminRoutes(request, env, url, path, method);
  if (admin) return admin;
  return null;
}

// Serve: approved gifs are public with immutable versioned caching, exactly
// like approved attachments; pending ones serve to their uploader and the
// moderators; rejected/unknown are the shared 404.
export async function handleGifServingRoute(request, env, path, method) {
  const gifMatch = path.match(GIF_ID_ROUTE);
  if (!gifMatch) return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  const row = await env.FORUM_DB.prepare(
    "SELECT id, status, uploader_id, mime, version FROM gifs WHERE id = ? LIMIT 1",
  ).bind(gifMatch[1]).first();
  if (!row) throw new HttpError(404, "GIF not found.");

  if (row.status === "approved") {
    const bytes = await assembledGifBytes(env.FORUM_DB, row.id);
    if (!bytes) throw new HttpError(404, "GIF not found.");
    const headers = securityHeaders();
    headers.set("Content-Type", row.mime);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Content-Length", String(bytes.length));
    return new Response(bytes, { status: 200, headers });
  }
  if (row.status === "pending") {
    const session = await readSession(request, env);
    const viewer = session && session.user;
    const isModerator = viewer && (viewer.role === "admin" || viewer.role === "moderator");
    if (viewer && (viewer.id === Number(row.uploader_id) || isModerator)) {
      const bytes = await assembledGifBytes(env.FORUM_DB, row.id);
      if (bytes) {
        const headers = securityHeaders();
        headers.set("Content-Type", row.mime);
        headers.set("Cache-Control", "private, max-age=300");
        headers.set("Content-Length", String(bytes.length));
        return new Response(bytes, { status: 200, headers });
      }
    }
  }
  throw new HttpError(404, "GIF not found.");
}

// Upload: members only, GIF magic bytes only (sniffImageMime decides —
// non-gif results 400 here), 10 MiB cap, the image-upload limiter, and
// hash-dedup: uploading bytes whose hash already has an APPROVED gif returns
// that gif (reuse: true) instead of storing anything; anything else lands a
// pending row with its chunks.
export async function handleGifUploadRoute(request, env, path, method) {
  const db = env.FORUM_DB;
  if (path !== "/api/gifs" || method !== "POST") return null;
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  await rateLimit(request, env, "image-upload", String(session.user.id));
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  const raw = await readLimitedBody(request, MAX_GIF_BYTES + 512 * 1024);
  let bytes;
  if (contentType.startsWith("multipart/form-data")) {
    let form;
    try {
      const headers = new Headers(request.headers);
      headers.delete("Content-Length");
      form = await new Request(request.url, { method: "POST", headers, body: raw }).formData();
    } catch {
      throw new HttpError(400, "The upload could not be read.");
    }
    const file = form.get("gif");
    if (!file || typeof file === "string") {
      throw new HttpError(400, "Attach a GIF file in the gif field.");
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    bytes = raw;
  }
  if (bytes.length > MAX_GIF_BYTES) {
    throw new HttpError(413, "GIFs must be 10 MiB or smaller.");
  }
  const mime = sniffImageMime(bytes);
  if (mime !== "image/gif") {
    throw new HttpError(400, "The marketplace takes animated GIFs only.");
  }
  const hash = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
  const existing = await db.prepare(
    "SELECT id FROM gifs WHERE hash = ? AND status = 'approved' LIMIT 1",
  ).bind(hash).first();
  if (existing) {
    return json({ id: existing.id, reuse: true });
  }
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const statements = [
    db.prepare(
      "INSERT INTO gifs (id, hash, uploader_id, mime, status, version, created_at) " +
      "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
    ).bind(id, hash, session.user.id, mime, createAvatarVersion(), now),
  ];
  for (let seq = 0, offset = 0; offset < bytes.length; seq += 1, offset += GIF_CHUNK_BYTES) {
    statements.push(
      db.prepare("INSERT INTO gif_chunks (gif_id, seq, data) VALUES (?, ?, ?)")
        .bind(id, seq, bytes.subarray(offset, offset + GIF_CHUNK_BYTES)),
    );
  }
  await db.batch(statements);
  // Close the race where an approved twin appears between the first lookup
  // and the pending insert. Approval itself also handles the remaining race.
  const approvedAfterInsert = await db.prepare(
    "SELECT id FROM gifs WHERE hash = ? AND status = 'approved' LIMIT 1",
  ).bind(hash).first();
  if (approvedAfterInsert) {
    await db.batch([
      db.prepare("DELETE FROM gif_chunks WHERE gif_id = ?").bind(id),
      db.prepare("DELETE FROM gifs WHERE id = ? AND status = 'pending'").bind(id),
    ]);
    return json({ id: approvedAfterInsert.id, reuse: true });
  }
  return json({ id, reuse: false }, 201);
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Approved library list (newest first): the picker renders this.
export async function handleGifListRoute(request, env, path, method) {
  if (path !== "/api/gifs" || method !== "GET") return null;
  const result = await env.FORUM_DB.prepare(
    "SELECT id, version, use_count FROM gifs WHERE status = 'approved' " +
    "ORDER BY created_at DESC LIMIT " + GIFS_LIST_LIMIT,
  ).all();
  return json({
    gifs: (result.results || []).map((row) => ({
      id: row.id,
      url: "/api/gifs/" + row.id + "?v=" + row.version,
      useCount: Number(row.use_count),
    })),
  });
}

// Concatenates a GIF's chunks in seq order — null when the set is empty
// (callers turn that into the shared 404, fail-safe). Used by the serve route
// AND by attachments.mjs's content-addressed resolve (marketplace canonical).
export async function assembledGifBytes(db, gifId) {
  const result = await db.prepare(
    "SELECT data FROM gif_chunks WHERE gif_id = ? ORDER BY seq",
  ).bind(gifId).all();
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

// Moderator desk for the library: mirrors the attachments queue.
async function handleGifAdminRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/gifs" && method === "GET") {
    await requireModerator(request, env, false);
    const result = await db.prepare(
      "SELECT g.id, g.hash, g.mime, g.created_at, u.username AS uploader " +
      "FROM gifs g LEFT JOIN users u ON u.id = g.uploader_id " +
      "WHERE g.status = 'pending' ORDER BY g.created_at ASC LIMIT 100",
    ).all();
    return json({
      gifs: (result.results || []).map((row) => ({
        id: row.id,
        uploader: row.uploader || "removed",
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
        previewUrl: "/api/gifs/" + row.id,
      })),
    });
  }
  const adminMatch = path.match(GIF_ADMIN_ROUTE);
  if (adminMatch) {
    const session = await requireModerator(request, env);
    await assertNotBanned(env, session.user.id);
    const gifId = adminMatch[1];
    const decision = adminMatch[2];
    if (decision === "approve") {
      // The UNIQUE(hash) index enforces one approved row per hash: a racing
      // approval shows 0 changes, then converges on the approved twin.
      let approved;
      try {
        approved = await db.batch([
          db.prepare("UPDATE gifs SET status = 'approved' WHERE id = ? AND status = 'pending'").bind(gifId),
        ]);
      } catch (error) {
        // Concurrent uploads can create pending rows after the upload-side
        // dedupe check. A competing approval may win the UNIQUE approved-hash
        // index; converge on that winner instead of leaving a stuck queue item.
        const twin = await db.prepare(
          "SELECT id FROM gifs WHERE status = 'approved' " +
          "AND hash = (SELECT hash FROM gifs WHERE id = ?) LIMIT 1",
        ).bind(gifId).first();
        if (!twin) throw error;
        await db.batch([
          db.prepare("DELETE FROM gifs WHERE id = ? AND status = 'pending'").bind(gifId),
        ]);
        return json({ approved: true, id: twin.id, merged: true });
      }
      if (Number(approved[0]?.meta?.changes) !== 1) {
        const twin = await db.prepare(
          "SELECT id FROM gifs WHERE status = 'approved' " +
          "AND hash = (SELECT hash FROM gifs WHERE id = ?) LIMIT 1",
        ).bind(gifId).first();
        if (twin) {
          await db.batch([
            db.prepare("DELETE FROM gifs WHERE id = ? AND status = 'pending'").bind(gifId),
          ]);
          return json({ approved: true, id: twin.id, merged: true });
        }
        throw new HttpError(404, "GIF not found.");
      }
      return json({ approved: true, id: gifId });
    }
    if (decision === "reject") {
      const rejected = await db.batch([
        db.prepare("DELETE FROM gifs WHERE id = ? AND status = 'pending'").bind(gifId),
      ]);
      if (Number(rejected[0]?.meta?.changes) !== 1) throw new HttpError(404, "GIF not found.");
      return json({ rejected: true, id: gifId });
    }
  }
  return null;
}