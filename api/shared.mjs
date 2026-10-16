// Shared helpers used by every API route group. Handlers live in api/session.mjs,
// api/posts.mjs, api/profiles.mjs, and api/moderation.mjs; worker.mjs re-exports
// only the functions the test suite imports, because workerd validates every
// Worker export as a function or ExportedHandler (non-function values stay here
// as consts, mirroring constants.mjs).
import {
  PBKDF2_ITERATIONS,
  RATE_LIMIT_BINDINGS,
  SESSION_INSERT_IF_UNBANNED_SQL,
  TURNSTILE_SITEVERIFY_URL,
} from "../constants.mjs";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_JSON_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

export const POST_SELECT =
  "SELECT p.id, p.author_id, p.parent_id, p.body, p.visibility, p.created_at, p.last_activity_at, p.edited_at, p.board, p.view_count, p.pinned_at, " +
  "u.username AS author_username, u.avatar_mime AS author_avatar_mime, " +
  "u.avatar_updated_at AS author_avatar_updated_at, u.avatar_version AS author_avatar_version, " +
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

class HttpError extends Error {
  // `payload` replaces the JSON body when present (used by the ban-screen
  // login response, which carries reason/expiresAt beyond the error message).
  constructor(status, message, headers = {}, payload = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.headers = headers;
    this.payload = payload;
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function hex(bytes) {
  let result = "";
  for (const value of bytes) result += value.toString(16).padStart(2, "0");
  return result;
}

function fromHex(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function randomToken(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256Hex(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function equalConstantTime(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function isValidUsername(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]{3,24}$/.test(value);
}

export function isValidPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
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

export function isValidPasswordPepper(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 256;
}

export function isValidSetupSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4096;
}

async function derivePassword(password, saltHex, pepper) {
  if (!isValidPasswordPepper(pepper)) {
    throw new HttpError(503, "Password security is not configured. Set PASSWORD_PEPPER using Wrangler.");
  }

  const pepperKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const pepperedPassword = await crypto.subtle.sign(
    "HMAC",
    pepperKey,
    encoder.encode(password),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    pepperedPassword,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}

export async function hashPassword(password, pepper) {
  const saltHex = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt: saltHex, hash: await derivePassword(password, saltHex, pepper) };
}

export async function verifyPassword(password, salt, expectedHash, pepper) {
  return equalConstantTime(await derivePassword(password, salt, pepper), expectedHash);
}

function securityHeaders(headers = new Headers()) {
  const result = new Headers(headers);
  result.set("X-Content-Type-Options", "nosniff");
  result.set("Strict-Transport-Security", "max-age=31536000");
  result.set("X-Frame-Options", "DENY");
  result.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  result.set("Cross-Origin-Resource-Policy", "same-origin");
  result.set("Cross-Origin-Opener-Policy", "same-origin");
  result.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; " +
      "img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; " +
      "frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; " +
      "form-action 'self'; frame-ancestors 'none'",
  );
  return result;
}

function json(data, status = 200, headers = {}) {
  const resultHeaders = securityHeaders(new Headers(headers));
  resultHeaders.set("Content-Type", "application/json; charset=utf-8");
  resultHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: resultHeaders });
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
      role: row.role,
      bio: row.bio || "",
      avatarStatus: row.avatar_status || null,
      avatarUrl: row.avatar_mime ? "/api/avatars/" + row.user_id + "?v=" + row.avatar_version : null,
    };
  }
  return { tokenHash: row.token_hash, csrfToken: row.csrf_token, expiresAt: Number(row.expires_at), user };
}

export async function createSession(request, env, userId = null, oldTokenHash = null, requireUnbanned = false) {
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

// Moderation gate: admins and moderators. Mutating (default) requests go
// through requireUser (same-origin + CSRF); read-only requests skip that.
// Roles are read at request time, so demotions take effect on the next
// readSession without any session invalidation.
async function requireModerator(request, env, mutating = true) {
  const session = mutating
    ? await requireUser(request, env)
    : await requireSignedInRead(request, env);
  if (session.user.role !== "admin" && session.user.role !== "moderator") {
    throw new HttpError(403, "Only moderators can do that.");
  }
  return session;
}

// Strictly admin-only gate (promote/demote, first-admin-style operations).
async function requireAdmin(request, env, mutating = true) {
  const session = mutating
    ? await requireUser(request, env)
    : await requireSignedInRead(request, env);
  if (session.user.role !== "admin") throw new HttpError(403, "Only moderators can do that.");
  return session;
}

async function assertNotBanned(env, userId) {
  const activeBan = await env.FORUM_DB.prepare(
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
  ).bind(userId, nowSeconds()).first();
  if (activeBan) throw new HttpError(403, "This account is currently banned.");
}

function requireMutationApplied(result) {
  if (Number(result?.meta?.changes) !== 1) {
    throw new HttpError(403, "This account is currently banned.");
  }
  return result;
}

export async function rateLimit(request, env, scope, actor = "") {
  const bindingName = RATE_LIMIT_BINDINGS[scope];
  const limiter = bindingName ? env[bindingName] : null;
  if (!limiter || typeof limiter.limit !== "function") {
    throw new HttpError(503, "Rate limiting is not configured for this endpoint.");
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const identity = actor ? scope + ":" + actor : scope + ":" + ip;
  const key = await sha256Hex(identity);
  const { success } = await limiter.limit({ key });
  if (!success) {
    throw new HttpError(429, "Too many requests. Please wait a little and try again.", {
      "Retry-After": "60",
    });
  }
}

export async function requireTurnstile(request, env, body, expectedAction) {
  const secret = env.TURNSTILE_SECRET;
  const hostnames = String(env.TURNSTILE_HOSTNAMES || "")
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  const token = typeof body["cf-turnstile-response"] === "string" ? body["cf-turnstile-response"] : "";
  if (!secret || hostnames.length === 0 || !token || token.length > TURNSTILE_TOKEN_MAX_LENGTH) {
    throw new HttpError(403, "Human verification is required.");
  }
  let result;
  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: request.headers.get("CF-Connecting-IP") || "",
      }),
    });
    if (!response.ok) throw new Error("siteverify responded with " + response.status);
    result = await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Turnstile siteverify request failed:", error && error.name ? error.name : "UnknownError");
    throw new HttpError(403, "Human verification could not be completed. Please try again.");
  }
  if (!result.success || result.action !== expectedAction || !hostnames.includes(result.hostname)) {
    throw new HttpError(403, "Human verification failed. Please try again.");
  }
}

async function readLimitedBody(request, maximum) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximum) throw new HttpError(413, "That upload is too large.");
  const reader = request.body && request.body.getReader ? request.body.getReader() : null;
  if (!reader) return new Uint8Array();
  const chunks = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximum) {
      try {
        await reader.cancel();
      } catch (cancelError) {
        console.warn(
          "Request body cancellation failed:",
          cancelError && cancelError.name ? cancelError.name : "UnknownError",
        );
      }
      throw new HttpError(413, "That upload is too large.");
    }
    chunks.push(part.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "Send this form as JSON.");
  }
  const bytes = await readLimitedBody(request, maxBytes);
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
  return value;
}

function requiredText(value, field, maximum) {
  if (typeof value !== "string") throw new HttpError(400, "Enter a valid " + field + ".");
  const result = value.trim();
  if (!result || result.length > maximum) {
    throw new HttpError(400, field.charAt(0).toUpperCase() + field.slice(1) + " must be between 1 and " + maximum + " characters.");
  }
  return result;
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
    "SELECT id, username, username_key, password_salt, password_hash, role, bio, profile_accent, banner_color, banner_text, flair, approved_css, " +
      SOCIAL_SELECT_COLUMNS +
      "avatar_status, avatar_mime, avatar_updated_at, avatar_version " +
      "FROM users WHERE username_key = ? LIMIT 1",
  ).bind(key).first();
}

// Profile themes (v2.5): the accent is a WHITELISTED palette key from this
// table — never raw CSS. The stored value is one of these ids ("" = no custom
// accent); clients look the colors up, so nothing user-chosen ever reaches
// CSS as a string. Colors are theme-stable (they read fine on dark too).
export const PROFILE_BANNER_COLORS = {
  "": null,
  green: "#397357",
  rust: "#b05334",
  gold: "#d9a627",
  slate: "#4a5a70",
  plum: "#7c5480",
};

export function isValidBannerColor(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROFILE_BANNER_COLORS, value);
}

export const PROFILE_ACCENTS = {
  "": null,
  forest: "#3f8a63",
  coral: "#d05f4c",
  gold: "#d9a627",
  sky: "#4d8fc4",
  violet: "#8b6cc4",
  rose: "#c95f86",
  teal: "#3d9aa0",
};

export function isValidProfileAccent(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROFILE_ACCENTS, value);
}

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    bio: row.bio || "",
    socials: socialsFromRow(row),
    polytoriaUsername: row.polytoria_username || null,
    // Profile theme accent (v2.5): the whitelisted KEY, or "" when the row
    // predates migration 0010 (the column just isn't in a projection).
    profileAccent: isValidProfileAccent(row.profile_accent === undefined ? "" : row.profile_accent)
      ? row.profile_accent
      : "",
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

export async function canViewPost(env, row, viewer) {
  if (!row) return false;
  if (row.visibility !== "public" &&
      (!viewer || (viewer.id !== Number(row.author_id) && viewer.role !== "admin"))) {
    return false;
  }
  // Banning auto-hides posts (v2.4.1): an ACTIVE ban on the author hides the
  // content the way a hidden post does — the author themselves and admins
  // pass, moderators and everyone else do not. "Now" is SQL-computed
  // (bind-free), so an expired or revoked ban restores the post without any
  // write. The same check applies per ancestor below.
  const bannedAuthor = await env.FORUM_DB.prepare(
    "SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1",
  ).bind(Number(row.author_id)).first();
  const canViewBannedAuthor = viewer &&
    (viewer.role === "admin" || viewer.id === Number(row.author_id));
  if (bannedAuthor && !canViewBannedAuthor) return false;
  // Every ancestor up to the root (parent, and the grandparent root for
  // level-2 replies) must be viewable: hidden ancestors never leak through a
  // public reply chain. Author/admin rules apply per ancestor.
  let ancestorId = row.parent_id;
  for (let depth = 0; ancestorId !== null && ancestorId !== undefined && depth < 2; depth++) {
    const ancestor = await env.FORUM_DB.prepare(
      "SELECT id, author_id, visibility, parent_id FROM posts WHERE id = ? LIMIT 1",
    ).bind(Number(ancestorId)).first();
    const canViewHiddenAncestor = ancestor && viewer &&
      (viewer.role === "admin" || Number(ancestor.author_id) === viewer.id);
    if (!ancestor || (ancestor.visibility !== "public" && !canViewHiddenAncestor)) return false;
    const ancestorBanned = await env.FORUM_DB.prepare(
      "SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1",
    ).bind(Number(ancestor.author_id)).first();
    const canViewBannedAncestor = viewer &&
      (viewer.role === "admin" || Number(ancestor.author_id) === viewer.id);
    if (ancestorBanned && !canViewBannedAncestor) return false;
    ancestorId = ancestor.parent_id;
  }
  return true;
}

// Avatar serving (moved here from the session group — registered on the
// profiles route group, since avatars belong to profiles). Approved avatars
// serve to anyone with public cache headers. Whenever a pending upload exists
// (first-ever upload or a re-upload over an approved avatar), its bytes are
// visible to the account owner and to admins/moderators — reviewers must see
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
      const isModerator = viewer && (viewer.role === "admin" || viewer.role === "moderator");
      if (viewer && (viewer.id === userId || isModerator)) {
        const headers = securityHeaders();
        headers.set("Content-Type", row.pending_avatar_mime);
        headers.set("Cache-Control", "no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(blobToUint8Array(row.pending_avatar_data), { status: 200, headers });
      }
    }

    if (row.avatar_mime && row.avatar_data) {
      const headers = securityHeaders();
      headers.set("Content-Type", row.avatar_mime);
      headers.set("Cache-Control", "public, max-age=3600");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(blobToUint8Array(row.avatar_data), { status: 200, headers });
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
  requireModerator,
  requireAdmin,
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
  MAX_JSON_BYTES,
};
// Accountability archive (v2.4.1): builds the INSERT..SELECT that copies the
// doomed post rows into post_archive — run FIRST in the same atomic batch as
// the deletion, while the rows are still present. whereSql selects the doomed
// set (by original post column alias `p`); the NOT EXISTS guard keeps a row
// from being archived twice (e.g. an own reply that is also a child of an own
// root). COALESCE keeps the name even when the users row is about to vanish.
export function archivePostRowsStatement(db, whereSql, binds, reason, deletedAt) {
  return db.prepare(
    "INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because) " +
    "SELECT p.id, p.author_id, COALESCE(u.username, 'removed'), p.body, p.board, p.created_at, ?, ? " +
    "FROM posts p LEFT JOIN users u ON u.id = p.author_id " +
    "WHERE (" + whereSql + ") AND NOT EXISTS (SELECT 1 FROM post_archive a WHERE a.original_post_id = p.id)",
  ).bind(deletedAt, reason, ...binds);
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
// Residual risk is accepted-with-approval: a moderator reads the CSS before
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

export function scopeProfileCss(rawCss) {
  const text = String(rawCss ?? "");
  if (!text.trim()) return "";
  const sanitizedRules = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open === -1) break;
    const close = text.indexOf("}", open);
    if (close === -1) break;
    const selectorText = text.slice(index, open).trim();
    const bodyText = text.slice(open + 1, close);
    index = close + 1;
    if (selectorText.startsWith("@")) {
      const atName = selectorText.slice(0, selectorText.match(/\s|\{/)?.index ?? selectorText.length).toLowerCase();
      if (atName === "@media") {
        // Media blocks recurse one level: scope the inner rules.
        const inner = scopeProfileCss(bodyText);
        sanitizedRules.push("@media" + selectorText.slice("@media".length) + "{" + inner + "}");
      } else if (atName === "@keyframes" || atName === "@-webkit-keyframes") {
        // Keyframes pass through but only their percentage selectors + allow-
        // listed properties; the wrapper class prefix must NOT apply (keyframe
        // selectors are percentages).
        sanitizedRules.push(selectorText + "{" + sanitizeDeclarationBody(bodyText) + "}");
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
