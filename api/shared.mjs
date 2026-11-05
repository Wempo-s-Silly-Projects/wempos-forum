// Shared helpers used by every API route group. Handlers live in api/session.mjs,
// api/posts.mjs, api/profiles.mjs, and api/moderation.mjs; worker.mjs re-exports
// only the functions the test suite imports, because workerd validates every
// Worker export as a function or ExportedHandler (non-function values stay here
// as consts, mirroring constants.mjs).
import {
  PBKDF2_ITERATIONS,
  SESSION_INSERT_IF_UNBANNED_SQL,
} from "../constants.mjs";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
// v4.0: the crypto primitives moved to api/core/crypto.mjs (plan 1, Task 2),
// the http glue to api/core/http.mjs (plan 1, Task 3), and the password
// pipeline to api/core/passwords.mjs (plan 1, Task 4) — imported back so
// every existing consumer keeps working unchanged.
import {
  base64Url,
  equalConstantTime,
  fromHex,
  hex,
  nowSeconds,
  randomToken,
  sha256Hex,
} from "./core/crypto.mjs";
import {
  hashPassword,
  isValidPassword,
  isValidPasswordPepper,
  isValidSetupSecret,
  verifyPassword,
} from "./core/passwords.mjs";
import {
  HttpError,
  MAX_JSON_BYTES,
  json,
  rateLimit,
  readJson,
  readLimitedBody,
  requireMutationApplied,
  requireTurnstile,
  requiredText,
  securityHeaders,
} from "./core/http.mjs";

// v4.0: the role vocabulary moved to api/core/roles.mjs (plan 1, Task 5),
// imported back so every existing consumer keeps working unchanged.
import {
  ROLE_ADMIN_DB,
  ROLE_MEMBER_DB,
  ROLE_OWNER_DB,
  publicRole,
} from "./core/roles.mjs";

// IP bans (v3.1): the caller's network identity. CF-Connecting-IP is the
// visitor IP behind Cloudflare; it is NEVER stored raw — the hash is keyed
// with PASSWORD_PEPPER (HMAC-SHA-256) so the rows cannot be reversed against
// a plain IP list, and a missing pepper (tests, unconfigured local dev)
// falls back to a plain digest.
export async function requestIpHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const data = new TextEncoder().encode("wempo-forum-ip:" + ip);
  let digest;
  if (env.PASSWORD_PEPPER) {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.PASSWORD_PEPPER),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    digest = await crypto.subtle.sign("HMAC", key, data);
  } else {
    digest = await crypto.subtle.digest("SHA-256", data);
  }
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Session creation from a banned network is refused — the ban-evasion teeth.
// Checked BEFORE credential verification so the response carries no oracle.
export async function assertNetworkNotBanned(request, env) {
  const ipHash = await requestIpHash(request, env);
  const row = await env.FORUM_DB.prepare(
    "SELECT 1 FROM banned_ips WHERE ip_hash = ? LIMIT 1",
  ).bind(ipHash).first();
  if (row) throw new HttpError(403, "This network is banned from the forum.");
}

export const POST_SELECT =
  "SELECT p.id, p.author_id, p.parent_id, p.body, p.visibility, p.created_at, p.last_activity_at, p.edited_at, p.board, p.view_count, p.pinned_at, " +
  "u.username AS author_username, u.avatar_mime AS author_avatar_mime, " +
  "u.avatar_updated_at AS author_avatar_updated_at, u.avatar_version AS author_avatar_version, " +
  // Flairs and profile accents ride every post (v3.0.1): feed cards show the
  // author's flair chip next to the name and the accent colors it.
  "u.flair AS author_flair, u.profile_accent AS author_accent, " +
  // Suggestion status (v3.1): resolved/declined on suggestions-board roots;
  // NULL everywhere else (replies and every other category never carry one).
  "p.suggestion_status, " +
  // Role badges (v3.1): the author's mapped role rides every post so cards
  // can chip owners/admins next to the name.
  "u.role AS author_role, " +
  "(SELECT parent.body FROM posts parent WHERE parent.id = p.parent_id) AS parent_body, " +
  "(SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.value = 'like') AS like_count, " +
  "(SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.value = 'dislike') AS dislike_count, " +
  "(SELECT r.value FROM reactions r WHERE r.post_id = p.id AND r.user_id = ?) AS viewer_reaction " +
  "FROM posts p JOIN users u ON u.id = p.author_id ";

// View counting (v2.4.3, raw impressions): one view per detail read by a
// NON-author, applied server-side on the existing GET so no extra network
// request exists. RETURNING keeps the serialized payload's count fresh —
// the same request that counts a view also reports the new total.
export const VIEW_INCREMENT_SQL =
  "UPDATE posts SET view_count = view_count + 1 WHERE id = ? RETURNING view_count";

export function isValidUsername(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]{3,24}$/.test(value);
}

export function createAvatarVersion() {
  return randomToken(12);
}

export function blobToUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new HttpError(500, "Stored picture data is invalid.");
}

export function sniffImageMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) return "image/gif";
  return null;
}

// ---- Intake sanitization (polyglot / metadata payload defense) ----
//
// A magic-byte prefix says "this starts as an image", not "this is only an
// image". Classic smuggle vectors: a script payload appended AFTER the
// format's logical end (post-IEND/post-EOI bytes ride along because the
// header still sniffs clean), and payload text hidden in metadata segments
// (JPEG APPn/COM — EXIF, XMP, comments; PNG tEXt/zTXt/iTXt/eXIf; GIF
// comment extensions; WebP EXIF/XMP chunks). None of that executes inside a
// Worker (bytes are served, never interpreted) — but stored payloads are
// hygiene debt for anyone who later downloads or re-hosts the file, and they
// break content-addressed dedup (the same photo plus a hidden payload hashes
// differently). So intake now structurally PARSES each format: drop the
// metadata segments, truncate at the logical end, and REJECT anything that
// never reaches one (a truncated or malformed file fails even though its
// prefix sniffs fine). Kept bytes are copied verbatim — chunk CRCs, entropy
// data, animation extensions, and color profiles all survive untouched, so
// no re-encode (no WASM dependency) and no valid image is altered.
//
// Returns { bytes, mime } on success (bytes is the ORIGINAL object when
// nothing needed stripping) or null when the structure is invalid — callers
// translate that into their own 400.

// Rebuilds the byte set from the kept [start, end) slices. Returns the
// original object when nothing was dropped, so clean uploads cost no copy.
function assembleSanitized(bytes, keep) {
  let total = 0;
  for (const [start, end] of keep) total += end - start;
  if (total === bytes.length) return bytes;
  const output = new Uint8Array(total);
  let at = 0;
  for (const [start, end] of keep) {
    output.set(bytes.subarray(start, end), at);
    at += end - start;
  }
  return output;
}

// PNG: chunk walk. First chunk must be IHDR; text/EXIF-carrying ancillary
// chunks are dropped; everything else (IDAT, PLTE, tRNS, iCCP, gAMA, pHYs…)
// passes through with its CRC intact; the file must reach IEND, and any
// bytes after IEND (the classic append vector) are truncated away.
const PNG_DROP_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function sanitizePng(bytes) {
  const keep = [[0, 8]];
  let offset = 8;
  let seenIhdr = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes[offset] * 2 ** 24 + bytes[offset + 1] * 2 ** 16 +
      bytes[offset + 2] * 2 ** 8 + bytes[offset + 3];
    if (length > bytes.length - offset - 12) return null;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (type !== "IHDR" && !seenIhdr) return null;
    seenIhdr = true;
    const total = 12 + length;
    if (type === "IEND") {
      keep.push([offset, offset + total]);
      return assembleSanitized(bytes, keep);
    }
    if (!PNG_DROP_CHUNKS.has(type)) keep.push([offset, offset + total]);
    offset += total;
  }
  return null; // never reached IEND
}

// JPEG: marker walk. APPn (EXIF/XMP/...) and COM segments are dropped; SOF,
// DHT, DQT, DRI, SOS and entropy data pass through with byte stuffing (FF 00)
// and restart markers respected; the scan must reach EOI, and bytes after it
// are truncated. Handles progressive JPEGs (multiple SOS scans).
function jpegEntropyEnd(bytes, from) {
  let at = from;
  while (at + 1 < bytes.length) {
    if (bytes[at] === 0xff) {
      const next = bytes[at + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        at += 2;
        continue;
      }
      return at; // index of the 0xFF starting the next real marker
    }
    at += 1;
  }
  return -1; // stream ends without a marker: no EOI anywhere
}

function sanitizeJpeg(bytes) {
  const keep = [[0, 2]]; // SOI
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill bytes before a marker are legal
      continue;
    }
    if (marker === 0xd9) {
      keep.push([offset, offset + 2]); // EOI: the logical end of the image
      return assembleSanitized(bytes, keep);
    }
    if (marker === 0xd8 || marker < 0xc0) return null; // second SOI / marker invalid at this position
    if (offset + 4 > bytes.length) return null;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return null;
    if (marker === 0xda) {
      // SOS: keep the header segment, then the entropy-coded scan up to the
      // next real marker (EOI, or the next scan's DHT/SOS in progressive).
      keep.push([offset, offset + 2 + segmentLength]);
      const entropyStart = offset + 2 + segmentLength;
      const stop = jpegEntropyEnd(bytes, entropyStart);
      if (stop === -1) return null;
      keep.push([entropyStart, stop]);
      offset = stop;
      continue;
    }
    const drop = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe; // APPn + COM
    if (!drop) keep.push([offset, offset + 2 + segmentLength]);
    offset += 2 + segmentLength;
  }
  return null; // ran out of bytes before EOI
}

// GIF: block walk. Comment (0x21 0xFE) and plaintext (0x21 0x01) extensions
// are dropped; graphic control (0x21 0xF9) and application extensions
// (0x21 0xFF — the animation loop) survive, as do image descriptors with
// their color tables and LZW data; the file must reach its trailer (0x3B),
// and bytes after it are truncated.
function gifSubBlocksEnd(bytes, from) {
  let at = from;
  while (at < bytes.length) {
    const size = bytes[at];
    at += 1;
    if (size === 0) return at;
    at += size;
  }
  return -1; // sub-block chain never terminated
}

function sanitizeGif(bytes) {
  const packed = bytes[10];
  const colorTableBytes = (packed & 0x80) ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
  let offset = 13 + colorTableBytes;
  const keep = [[0, offset]]; // header + logical screen descriptor (+ global color table)
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x3b) {
      keep.push([offset, offset + 1]); // trailer: the logical end
      return assembleSanitized(bytes, keep);
    }
    if (block === 0x21) {
      if (offset + 1 >= bytes.length) return null;
      const label = bytes[offset + 1];
      const end = gifSubBlocksEnd(bytes, offset + 2);
      if (end === -1) return null;
      if (label !== 0xfe && label !== 0x01) keep.push([offset, end]);
      offset = end;
      continue;
    }
    if (block === 0x2c) {
      if (offset + 10 > bytes.length) return null;
      const localTable = (bytes[offset + 9] & 0x80) ? 3 * 2 ** ((bytes[offset + 9] & 0x07) + 1) : 0;
      // Image data = LZW minimum-code-size byte, THEN the sub-block chain —
      // the +1 skips that bare code-size byte before the first size byte.
      const end = gifSubBlocksEnd(bytes, offset + 10 + localTable + 1);
      if (end === -1) return null;
      keep.push([offset, end]);
      offset = end;
      continue;
    }
    return null; // unknown block byte
  }
  return null; // never reached the trailer
}

// WebP: RIFF chunk walk bounded by the declared RIFF size. EXIF/XMP chunks
// are dropped; frame/animation chunks (VP8, VP8L, VP8X, ANIM/ANMF, ALPH)
// survive; at least one frame chunk must be present, and bytes past the RIFF
// end are truncated.
function sanitizeWebp(bytes) {
  const riffSize = bytes[4] + bytes[5] * 2 ** 8 + bytes[6] * 2 ** 16 + bytes[7] * 2 ** 24;
  const riffEnd = 8 + riffSize;
  if (riffSize < 4 || riffEnd > bytes.length) return null;
  const keep = [[0, 12]];
  let offset = 12;
  let sawFrame = false;
  while (offset + 8 <= riffEnd) {
    const tag = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = bytes[offset + 4] + bytes[offset + 5] * 2 ** 8 +
      bytes[offset + 6] * 2 ** 16 + bytes[offset + 7] * 2 ** 24;
    const total = 8 + size + (size % 2); // RIFF chunks are padded to even sizes
    if (offset + total > riffEnd) return null;
    if (tag === "VP8 " || tag === "VP8L" || tag === "VP8X") sawFrame = true;
    if (tag !== "EXIF" && tag !== "XMP ") keep.push([offset, offset + total]);
    offset += total;
  }
  if (offset !== riffEnd || !sawFrame) return null;
  const output = assembleSanitized(bytes, keep);
  if (output === bytes) return output;
  // Bytes were dropped: rewrite the RIFF size field to match, or the
  // container would claim more data than it holds.
  const newSize = output.length - 8;
  output[4] = newSize & 255;
  output[5] = (newSize >>> 8) & 255;
  output[6] = (newSize >>> 16) & 255;
  output[7] = (newSize >>> 24) & 255;
  return output;
}

export function sanitizeImage(bytes) {
  const mime = sniffImageMime(bytes);
  if (!mime) return null;
  const sanitized = mime === "image/png" ? sanitizePng(bytes)
    : mime === "image/jpeg" ? sanitizeJpeg(bytes)
    : mime === "image/gif" ? sanitizeGif(bytes)
    : sanitizeWebp(bytes);
  if (!sanitized) return null;
  return { bytes: sanitized, mime };
}

// Egress for stored image bytes. The row's claimed MIME is re-verified
// against the bytes' magic signature at serve time — a mismatch (corrupt or
// tampered storage) fails SAFE as null, which every serving route turns into
// its own 404. Matched bytes get the full defensive set: the sniffed
// Content-Type (never a stored string alone), nosniff so browsers cannot
// guess the type, and Content-Disposition: inline with a fixed ASCII
// filename so no execution context is ever inherited from the path.
export function imageResponse(bytes, claimedMime, cacheControl) {
  const sniffed = sniffImageMime(bytes);
  if (!sniffed || sniffed !== claimedMime) return null;
  const headers = securityHeaders();
  headers.set("Content-Type", sniffed);
  headers.set("Cache-Control", cacheControl);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", 'inline; filename="image"');
  headers.set("Content-Length", String(bytes.length));
  return new Response(bytes, { status: 200, headers });
}

function setCookie(request, token, maxAge = SESSION_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return "wempo_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + secure;
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

async function readSession(request, env) {
  const token = cookieValue(request, "wempo_session");
  if (!token || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.FORUM_DB.prepare(
    "SELECT s.token_hash, s.user_id, s.csrf_token, s.expires_at, " +
      "u.username, u.role, u.bio, u.avatar_status, u.avatar_mime, u.avatar_updated_at, u.avatar_version " +
      "FROM sessions s LEFT JOIN users u ON u.id = s.user_id " +
      "WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1",
  ).bind(tokenHash, nowSeconds()).first();
  if (!row) return null;

  let user = null;
  if (row.user_id !== null && row.username !== null) {
    user = {
      id: Number(row.user_id),
      username: row.username,
      role: publicRole(row.role),
      bio: row.bio || "",
      avatarStatus: row.avatar_status || null,
      avatarUrl: row.avatar_mime ? "/api/avatars/" + row.user_id + "?v=" + row.avatar_version : null,
    };
  }
  return { tokenHash: row.token_hash, csrfToken: row.csrf_token, expiresAt: Number(row.expires_at), user };
}

export async function createSession(request, env, userId = null, oldTokenHash = null, requireUnbanned = false) {
  // IP bans (v3.1): remember which network each member signed in from —
  // keyed hash only, best-effort (a tracking failure never blocks sign-in).
  if (userId !== null) {
    try {
      const ipHash = await requestIpHash(request, env);
      await env.FORUM_DB.prepare(
        "INSERT INTO known_ips (ip_hash, user_id, last_seen) VALUES (?, ?, ?) " +
          "ON CONFLICT(ip_hash, user_id) DO UPDATE SET last_seen = excluded.last_seen",
      ).bind(ipHash, Number(userId), nowSeconds()).run();
    } catch {
      /* best-effort tracking */
    }
  }
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const csrfToken = randomToken(24);
  const now = nowSeconds();
  const expiresAt = now + SESSION_TTL_SECONDS;
  const insert = requireUnbanned
    ? env.FORUM_DB.prepare(SESSION_INSERT_IF_UNBANNED_SQL)
      .bind(tokenHash, userId, csrfToken, now, expiresAt, userId, now)
    : env.FORUM_DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(tokenHash, userId, csrfToken, now, expiresAt);

  if (oldTokenHash && requireUnbanned) {
    const results = await env.FORUM_DB.batch([
      insert,
      env.FORUM_DB.prepare(
        "DELETE FROM sessions WHERE token_hash = ? AND EXISTS (" +
          "SELECT 1 FROM sessions WHERE token_hash = ?)",
      ).bind(oldTokenHash, tokenHash),
    ]);
    if (Number(results[0]?.meta?.changes) !== 1) return null;
  } else if (oldTokenHash) {
    await env.FORUM_DB.batch([
      env.FORUM_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(oldTokenHash),
      insert,
    ]);
  } else {
    const result = await insert.run();
    if (requireUnbanned && Number(result.meta?.changes) !== 1) return null;
  }

  await env.FORUM_DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  return { tokenHash, csrfToken, setCookie: setCookie(request, token) };
}

function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) {
    throw new HttpError(403, "This request was blocked because its origin could not be verified.");
  }
}

async function requireCsrf(request, env) {
  assertSameOrigin(request);
  const session = await readSession(request, env);
  if (!session) throw new HttpError(401, "Your session has expired. Reload the page and sign in again.");
  const supplied = request.headers.get("X-CSRF-Token") || "";
  if (!equalConstantTime(supplied, session.csrfToken)) {
    throw new HttpError(403, "Your security token is out of date. Reload the page and try again.");
  }
  return session;
}

async function requireUser(request, env) {
  const session = await requireCsrf(request, env);
  if (!session.user) throw new HttpError(401, "Please sign in to do that.");
  return session;
}

async function requireSignedInRead(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.user) throw new HttpError(401, "Please sign in to do that.");
  return session;
}

// Moderation gate: admins and mods. Mutating (default) requests go
// through requireUser (same-origin + CSRF); read-only requests skip that.
// Roles are read at request time, so demotions take effect on the next
// readSession without any session invalidation.
async function requiremod(request, env, mutating = true) {
  const session = mutating
    ? await requireUser(request, env)
    : await requireSignedInRead(request, env);
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    throw new HttpError(403, "Only admins can do that.");
  }
  return session;
}

// Strictly owner-only gate (promote/demote, first-owner-style operations).
async function requireAdmin(request, env, mutating = true) {
  const session = mutating
    ? await requireUser(request, env)
    : await requireSignedInRead(request, env);
  if (session.user.role !== "owner") throw new HttpError(403, "Only the owner can do that.");
  return session;
}

async function assertNotBanned(env, userId) {
  const activeBan = await env.FORUM_DB.prepare(
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
  ).bind(userId, nowSeconds()).first();
  if (activeBan) throw new HttpError(403, "This account is currently banned.");
}

// Platform keys accepted by PATCH /api/me `socials`, each with the users table
// column it persists to and the pinned per-platform handle shape (mirrors the
// migration CHECKs' 120-char ceiling; the regexes are the real gate).
const SOCIAL_PLATFORMS = [
  { key: "youtube", column: "social_youtube", regex: /^[A-Za-z0-9._-]{1,60}$/ },
  { key: "x", column: "social_x", regex: /^[A-Za-z0-9_]{1,15}$/ },
  { key: "reddit", column: "social_reddit", regex: /^[A-Za-z0-9_-]{3,20}$/ },
  { key: "github", column: "social_github", regex: /^[A-Za-z0-9-]{1,39}$/ },
  { key: "discord", column: "social_discord", regex: /^[A-Za-z0-9._#-]{2,64}$/ },
  { key: "gitlab", column: "social_gitlab", regex: /^[A-Za-z0-9_.]{1,30}$/ },
  { key: "instagram", column: "social_instagram", regex: /^[A-Za-z0-9_.]{1,30}$/ },
  { key: "tiktok", column: "social_tiktok", regex: /^[A-Za-z0-9_.]{1,24}$/ },
  { key: "twitch", column: "social_twitch", regex: /^[A-Za-z0-9_]{1,25}$/ },
  { key: "polytoria", column: "polytoria_username", regex: /^[A-Za-z0-9_]{1,24}$/ },
];

const SOCIAL_SELECT_COLUMNS =
  SOCIAL_PLATFORMS.map((platform) => platform.column).join(", ") + ", ";

// Sparse socials map for read responses: only platforms holding a non-empty
// handle are present. Rows from SQL predating the social columns (e.g. the
// search projection) normalize to the empty map.
function socialsFromRow(row) {
  const socials = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const value = row[platform.column];
    if (typeof value === "string" && value.length > 0) socials[platform.key] = value;
  }
  return socials;
}

async function userByUsernameKey(env, key) {
  return env.FORUM_DB.prepare(
    "SELECT id, username, username_key, password_salt, password_hash, role, bio, profile_accent, banner_color, banner_text, flair, pending_css, approved_css, " +
      SOCIAL_SELECT_COLUMNS +
      "avatar_status, avatar_mime, avatar_updated_at, avatar_version " +
      "FROM users WHERE username_key = ? LIMIT 1",
  ).bind(key).first();
}

// Profile colors (any hex, v3.0.2): members pick any #rrggbb. The stored
// value is ALWAYS a validated lowercase hex — the strict regex is the whole
// security story (a matched value cannot carry CSS or markup), so clients
// apply it as a CSS custom property WRITE (element.style.setProperty, a
// CSSOM assignment — not an inline style string) and the CSP stays pure.
// The old whitelisted palette keys survive as legacy: still accepted on
// write (converted to their hex) and normalized on read, so existing
// profiles keep their colors untouched. Banner key values mirror the old
// per-key CSS (the banner variants, e.g. darker gold for white text).
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

export const PROFILE_BANNER_COLORS = {
  "": "",
  green: "#397357",
  rust: "#b05334",
  gold: "#8d690f",
  slate: "#4a5a70",
  plum: "#7c5480",
};

export const PROFILE_ACCENTS = {
  "": "",
  forest: "#3f8a63",
  coral: "#d05f4c",
  gold: "#d9a627",
  sky: "#4d8fc4",
  violet: "#8b6cc4",
  rose: "#c95f86",
  teal: "#3d9aa0",
};

// Write-side: "" clears, a legacy palette key converts to its hex, anything
// else must be #rrggbb (lowercased for storage). Returns null to REJECT.
export function normalizeProfileColorInput(value, palette) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return "";
  if (Object.prototype.hasOwnProperty.call(palette, raw)) return palette[raw];
  return isValidHexColor(raw) ? raw.toLowerCase() : null;
}

// Read-side: stored hex passes through lowercased, a legacy key maps to its
// hex, and anything else (pre-migration junk) normalizes to "".
export function normalizeProfileColor(value, palette) {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return "";
  if (Object.prototype.hasOwnProperty.call(palette, raw)) return palette[raw] || "";
  return isValidHexColor(raw) ? raw.toLowerCase() : "";
}

export function normalizeProfileAccent(value) {
  return normalizeProfileColor(value, PROFILE_ACCENTS);
}

export function normalizeBannerColor(value) {
  return normalizeProfileColor(value, PROFILE_BANNER_COLORS);
}

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    role: publicRole(row.role),
    bio: row.bio || "",
    socials: socialsFromRow(row),
    polytoriaUsername: row.polytoria_username || null,
    // Profile theme accent (any hex, v3.0.2): normalized server-side to a
    // #rrggbb hex (legacy palette keys map through); "" = none. Pre-migration
    // projections normalize to "".
    profileAccent: normalizeProfileAccent(row.profile_accent === undefined ? "" : row.profile_accent),
    // Rows from SQL that predates avatar moderation (e.g. search projections)
    // omit the column; normalize it to the never-uploaded shape.
    avatarStatus: row.avatar_status || null,
    avatarUrl: row.avatar_mime ? "/api/avatars/" + row.id + "?v=" + row.avatar_version : null,
  };
}

// publicLevel (optional, JSON-only annotation — never touches SQL or binds):
// 0 = root post, 1 = level-1 reply, 2 = level-2 reply. Routes that know each
// row's depth pass it in; when omitted the field is left off so clients fall
// back to their conservative (non-reply) handling.
function publicPost(row, publicLevel) {
  const post = {
    id: Number(row.id),
    body: row.body,
    visibility: row.visibility,
    // Board (v2.4.1): serialized for every post (general or suggestions);
    // rows from pre-migration projections normalize to the "general" shape.
    board: row.board || "general",
    // Suggestion status (v3.1): 'resolved'/'declined' on suggestions-board
    // roots, null otherwise (display-only chip; staff flip it through
    // POST /api/posts/:id/suggestion-status).
    suggestionStatus: row.suggestion_status || null,
    // View counter (v2.4.3, migration 0009): raw impressions, display-only.
    // The detail route overrides this with the RETURNING value when it
    // counted a fresh view, so the payload never reads stale by one.
    viewCount: Number(row.view_count || 0),
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    lastActivityAt: row.last_activity_at === null || row.last_activity_at === undefined
      ? null
      : new Date(Number(row.last_activity_at) * 1000).toISOString(),
    // edited_at (migration 0005) rides POST_SELECT, so every serialized post
    // carries it: null until the author's first edit, then the epoch-seconds
    // stamp the edit route wrote. Same ISO-shape convention as createdAt.
    editedAt: row.edited_at === null || row.edited_at === undefined
      ? null
      : new Date(Number(row.edited_at) * 1000).toISOString(),
    author: {
      id: Number(row.author_id),
      username: row.author_username,
      // Flair chip + accent on cards (any hex, v3.0.2): the accent is
      // normalized to #rrggbb here — the client writes it as a CSS custom
      // property, never a class string.
      flair: row.author_flair || null,
      profileAccent: normalizeProfileAccent(row.author_accent === undefined ? "" : row.author_accent) || null,
      // Role badges (v3.1): the mapped public role ('owner'/'admin'), null
      // for members so the badge only appears for staff.
      role: row.author_role ? publicRole(row.author_role) : null,
      avatarUrl: row.author_avatar_mime
        ? "/api/avatars/" + row.author_id + "?v=" + row.author_avatar_version
        : null,
    },
    parent: row.parent_id ? { id: Number(row.parent_id), body: row.parent_body || "" } : null,
    likeCount: Number(row.like_count || 0),
    dislikeCount: Number(row.dislike_count || 0),
    viewerReaction: row.viewer_reaction || null,
    // Pinning (C5): the stamp (epoch seconds) as ISO, null never-pinned. Rows
    // from pre-migration projections normalize to null like editedAt.
    pinnedAt: row.pinned_at === null || row.pinned_at === undefined || Number(row.pinned_at) === 0
      ? null
      : new Date(Number(row.pinned_at) * 1000).toISOString(),
  };
  if (publicLevel !== undefined) post.publicLevel = publicLevel;
  return post;
}

async function postById(env, postId, viewerId) {
  const row = await env.FORUM_DB.prepare(POST_SELECT + "WHERE p.id = ? LIMIT 1")
    .bind(viewerId || -1, postId).first();
  return row || null;
}

// Nuke rule (v3.0.1): hidden content (a hidden post, or ANY content by an
// actively-banned author) is invisible to everyone EXCEPT mods and
// admins — the author included. Normal surfaces (feeds, replies, detail,
// search, history) never carry it (the list SQL binds a no-match bypass
// sentinel); the only in-app door is the desk's hidden-posts page
// (GET /api/admin/hidden). An expired or revoked ban restores content
// without any write ("now" stays SQL-computed and bind-free).
export async function canViewPost(env, row, viewer) {
  if (!row) return false;
  const ismod = Boolean(viewer && (viewer.role === "owner" || viewer.role === "admin"));
  if (row.visibility !== "public" && !ismod) return false;
  const bannedAuthor = await env.FORUM_DB.prepare(
    "SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1",
  ).bind(Number(row.author_id)).first();
  if (bannedAuthor && !ismod) return false;
  // Every ancestor up to the root (parent, and the grandparent root for
  // level-2 replies) must be viewable: hidden ancestors never leak through a
  // public reply chain. The same mod-only rule applies per ancestor.
  let ancestorId = row.parent_id;
  for (let depth = 0; ancestorId !== null && ancestorId !== undefined && depth < 2; depth++) {
    const ancestor = await env.FORUM_DB.prepare(
      "SELECT id, author_id, visibility, parent_id FROM posts WHERE id = ? LIMIT 1",
    ).bind(Number(ancestorId)).first();
    if (!ancestor || (ancestor.visibility !== "public" && !ismod)) return false;
    const ancestorBanned = await env.FORUM_DB.prepare(
      "SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1",
    ).bind(Number(ancestor.author_id)).first();
    if (ancestorBanned && !ismod) return false;
    ancestorId = ancestor.parent_id;
  }
  return true;
}

// Avatar serving (moved here from the session group — registered on the
// profiles route group, since avatars belong to profiles). Approved avatars
// serve to anyone with public cache headers. Whenever a pending upload exists
// (first-ever upload or a re-upload over an approved avatar), its bytes are
// visible to the account owner and to admins/mods — reviewers must see
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

export {
  HttpError,
  nowSeconds,
  sha256Hex,
  randomToken,
  equalConstantTime,
  readSession,
  requireCsrf,
  requireUser,
  requireSignedInRead,
  requiremod,
  requireAdmin,
  assertSameOrigin,
  assertNotBanned,
  requireMutationApplied,
  readLimitedBody,
  readJson,
  requiredText,
  securityHeaders,
  json,
  userByUsernameKey,
  SOCIAL_PLATFORMS,
  socialsFromRow,
  publicUser,
  publicPost,
  postById,
  handleAvatarReadRoute,
  hashPassword,
  publicRole,
  ROLE_ADMIN_DB,
  ROLE_MEMBER_DB,
  ROLE_OWNER_DB,
  isValidPassword,
  isValidPasswordPepper,
  isValidSetupSecret,
  rateLimit,
  requireTurnstile,
  verifyPassword,
  MAX_JSON_BYTES,
};
// Accountability archive (v2.4.1): builds the INSERT..SELECT that copies the
// doomed post rows into post_archive — run FIRST in the same atomic batch as
// the deletion, while the rows are still present. whereSql selects the doomed
// set (by original post column alias `p`); the NOT EXISTS guard keeps a row
// from being archived twice (e.g. an own reply that is also a child of an own
// root). COALESCE keeps the name even when the users row is about to vanish.
export function archivePostRowsStatement(
  db, whereSql, binds, reason, deletedAt, deletedByUserId = null, deletedByName = null,
) {
  return db.prepare(
    "INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because, deleted_by_user_id, deleted_by_name, idempotency_key, idempotency_fingerprint) " +
    "SELECT p.id, p.author_id, COALESCE(u.username, 'removed'), p.body, p.board, p.created_at, ?, ?, ?, ?, p.idempotency_key, p.idempotency_fingerprint " +
    "FROM posts p LEFT JOIN users u ON u.id = p.author_id " +
    "WHERE (" + whereSql + ") AND NOT EXISTS (SELECT 1 FROM post_archive a WHERE a.original_post_id = p.id)",
  ).bind(deletedAt, reason, deletedByUserId, deletedByName, ...binds);
}

// Custom profile CSS (v2.5): the sandbox. Mods approve the TEXT, and at serve
// time the raw CSS is re-scoped before it ever reaches a page:
//   1. Every rule's selectors are prefixed with .profile-theme-scope (a
//      per-profile container class), so nothing can escape its container.
//   2. An @-block pass-through keeps @media/@keyframes working; @import and
//      any other at-rule are dropped (url/resource smuggling surface).
//   3. A blocklist strips the properties that could escape or hijack: any
//      fixed positioning, z-index above 1, and everything the whitelist
//      doesn't recognize as a cosmetic property (allow-list, not block-list:
//      unknown properties are dropped — browsers ignore them anyway).
// Residual risk is accepted-with-approval: a mod reads the CSS before
// it goes live, and the CSP still gates every url() to same-origin.
const PROFILE_CSS_PROPERTY_ALLOW = new Set([
  "color", "background", "background-color", "background-image", "background-position", "background-size", "background-repeat",
  "border", "border-color", "border-width", "border-style", "border-radius",
  "font", "font-family", "font-size", "font-style", "font-weight",
  "letter-spacing", "line-height", "text-align", "text-transform", "text-decoration", "text-shadow",
  "padding", "padding-left", "padding-right", "padding-top", "padding-bottom",
  "margin", "margin-left", "margin-right", "margin-top", "margin-bottom",
  "width", "height", "max-width", "max-height", "min-width", "min-height",
  "opacity", "transform", "box-shadow", "display", "align-items", "justify-content",
  "flex-direction", "flex-wrap", "gap", "overflow", "overflow-x", "overflow-y",
  "object-fit", "object-position", "filter", "backdrop-filter", "border-bottom", "border-top",
  "border-left", "border-right", "border-bottom-color", "border-top-color",
  "border-left-color", "border-right-color",
]);

export const CUSTOM_CSS_MAX_BYTES = 20 * 1024;

// A depth-tracking brace scanner: finds the block whose opening brace is at
// `open` and returns the index just past its MATCHING close (handles nesting
// — @media bodies contain full rule blocks).
function blockEnd(text, openAt) {
  let depth = 0;
  let inString = null;
  for (let at = openAt; at < text.length; at++) {
    const ch = text[at];
    if (inString) {
      if (ch === "\\") at += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return text.length;
}

// The at-rule's NAME: everything before the first non-name char (space,
// paren... — "@media(min-width:1px)" extracts cleanly).
function atRuleName(selectorText) {
  return selectorText.replace(/^\s+/, "").split(/[^@a-zA-Z-]/)[0].toLowerCase();
}

export function scopeProfileCss(rawCss) {
  const text = String(rawCss ?? "");
  if (!text.trim()) return "";
  const sanitizedRules = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open === -1) break;
    const close = blockEnd(text, open);
    const selectorText = text.slice(index, open).trim();
    const bodyText = text.slice(open + 1, close);
    index = close + 1;
    if (selectorText.startsWith("@")) {
      const atName = atRuleName(selectorText);
      if (atName === "@media") {
        // Media blocks recurse: scope the INNER rules, keep the condition.
        const condition = selectorText.slice("@media".length).trim();
        sanitizedRules.push("@media" + " " + condition + "{" + scopeProfileCss(bodyText) + "}");
      } else if (atName === "@keyframes" || atName === "@-webkit-keyframes") {
        // Keyframes: the inner blocks are step selectors (from/to/percentage
        // — never scoped), and each step's body passes the allow-list.
        const inner = scopeKeyframeBody(bodyText);
        sanitizedRules.push(selectorText + "{" + inner + "}");
      }
      // Everything else (@import, @font-face, @supports…) is dropped.
      continue;
    }
    const scoped = selectorText
      .split(",")
      .map((selector) => ".profile-theme-scope " + selector.trim())
      .join(", ");
    const body = sanitizeDeclarationBody(bodyText);
    if (body) sanitizedRules.push(scoped + "{" + body + "}");
  }
  return sanitizedRules.join("\n");
}

// Keyframe steps: from/to/percentage selectors in, allow-listed properties
// per step.
function scopeKeyframeBody(bodyText) {
  const steps = [];
  let index = 0;
  while (index < bodyText.length) {
    const open = bodyText.indexOf("{", index);
    if (open === -1) break;
    const close = bodyText.indexOf("}", open);
    if (close === -1) break;
    const selector = bodyText.slice(index, open).trim();
    steps.push(selector + "{" + sanitizeDeclarationBody(bodyText.slice(open + 1, close)) + "}");
    index = close + 1;
  }
  return steps.join("\n");
}

// Property allow-list for one declaration body; url() survives only for the
// same-origin / static assets path (the CSP gates it further either way).
function sanitizeDeclarationBody(body) {
  const kept = [];
  for (const declaration of body.split(";")) {
    const prop = declaration.slice(0, declaration.indexOf(":") > -1 ? declaration.indexOf(":") : 0).trim().toLowerCase();
    const value = declaration.includes(":") ? declaration.slice(declaration.indexOf(":") + 1).trim() : "";
    if (!prop || !value) continue;
    if (prop === "z-index") continue; // stacking hijacks never pass
    if (value.toLowerCase().includes("position") && prop === "position" && /(fixed|sticky)/.test(value.toLowerCase())) continue;
    if (!PROFILE_CSS_PROPERTY_ALLOW.has(prop)) continue;
    if (/(javascript:|expression\(|@import)/i.test(value)) continue;
    kept.push(prop + ":" + value);
  }
  return kept.join(";");
}
