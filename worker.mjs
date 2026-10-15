const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const PBKDF2_ITERATIONS = 100000;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_AVATAR_BYTES = 1024 * 1024;
const MAX_AVATAR_REQUEST_BYTES = MAX_AVATAR_BYTES + 64 * 1024;
const encoder = new TextEncoder();
const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.headers = headers;
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
  return null;
}

export function isValidPasswordPepper(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 256;
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
  result.set("X-Frame-Options", "DENY");
  result.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  result.set("Cross-Origin-Resource-Policy", "same-origin");
  result.set("Cross-Origin-Opener-Policy", "same-origin");
  result.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  return result;
}

function secureResponse(response) {
  const headers = securityHeaders(response.headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data, status = 200, headers = {}) {
  const resultHeaders = securityHeaders(new Headers(headers));
  resultHeaders.set("Content-Type", "application/json; charset=utf-8");
  resultHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: resultHeaders });
}

function apiError(error) {
  if (error instanceof HttpError) {
    return json({ error: error.message }, error.status, error.headers);
  }
  console.error("Forum request failed:", error && error.name ? error.name : "UnknownError");
  return json({ error: "Something went wrong. Please try again." }, 500);
}

function setCookie(request, token, maxAge = SESSION_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return "wempo_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + secure;
}

function expiredCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return "wempo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secure;
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
      "u.username, u.role, u.bio, u.avatar_mime, u.avatar_updated_at, u.avatar_version " +
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
      avatarUrl: row.avatar_mime ? "/api/avatars/" + row.user_id + "?v=" + row.avatar_version : null,
    };
  }
  return { tokenHash: row.token_hash, csrfToken: row.csrf_token, expiresAt: Number(row.expires_at), user };
}

export const SESSION_INSERT_IF_UNBANNED_SQL =
  "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) " +
    "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
    "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
    "AND (expires_at IS NULL OR expires_at > ?))";

export const UNBAN_ACTIVE_UPDATE_SQL =
  "UPDATE bans SET revoked_at = ?, revoked_by = ?, revocation_reason = ? " +
    "WHERE id = ? AND user_id = ? AND revoked_at IS NULL " +
    "AND (expires_at IS NULL OR expires_at > ?)";

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

export const RATE_LIMIT_BINDINGS = Object.freeze({
  read: "READ_RATE_LIMITER",
  write: "WRITE_RATE_LIMITER",
  "guest-session": "GUEST_SESSION_RATE_LIMITER",
  register: "REGISTER_RATE_LIMITER",
  login: "LOGIN_RATE_LIMITER",
  setup: "SETUP_RATE_LIMITER",
  "post-write": "POST_WRITE_RATE_LIMITER",
  "password-change": "PASSWORD_CHANGE_RATE_LIMITER",
  report: "REPORT_RATE_LIMITER",
  "avatar-upload": "AVATAR_UPLOAD_RATE_LIMITER",
  reaction: "REACTION_RATE_LIMITER",
});

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
      try { await reader.cancel(); } catch {}
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

async function readJson(request) {
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "Send this form as JSON.");
  }
  const bytes = await readLimitedBody(request, MAX_JSON_BYTES);
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

function validateNewCredentials(body) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!isValidUsername(username)) {
    throw new HttpError(400, "Username must be 3–24 characters and use only letters, numbers, and underscores.");
  }
  if (!isValidPassword(body.password)) {
    throw new HttpError(400, "Password must be 12–128 characters long.");
  }
  return { username, usernameKey: username.toLowerCase(), password: body.password };
}

async function userByUsernameKey(env, key) {
  return env.FORUM_DB.prepare(
    "SELECT id, username, username_key, password_salt, password_hash, role, bio, avatar_mime, avatar_updated_at, avatar_version " +
      "FROM users WHERE username_key = ? LIMIT 1",
  ).bind(key).first();
}

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    bio: row.bio || "",
    avatarUrl: row.avatar_mime ? "/api/avatars/" + row.id + "?v=" + row.avatar_version : null,
  };
}

export const SEARCH_USERS_SQL =
  "SELECT id, username, role, bio, avatar_mime, avatar_updated_at, avatar_version FROM users " +
  "WHERE instr(username_key, ?) > 0 OR instr(lower(bio), ?) > 0 ORDER BY username_key LIMIT 20";

const POST_SELECT =
  "SELECT p.id, p.author_id, p.parent_id, p.body, p.visibility, p.created_at, " +
  "u.username AS author_username, u.avatar_mime AS author_avatar_mime, " +
  "u.avatar_updated_at AS author_avatar_updated_at, u.avatar_version AS author_avatar_version, " +
  "(SELECT parent.body FROM posts parent WHERE parent.id = p.parent_id) AS parent_body, " +
  "(SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.value = 'like') AS like_count, " +
  "(SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.value = 'dislike') AS dislike_count, " +
  "(SELECT r.value FROM reactions r WHERE r.post_id = p.id AND r.user_id = ?) AS viewer_reaction " +
  "FROM posts p JOIN users u ON u.id = p.author_id ";

function publicPost(row) {
  return {
    id: Number(row.id),
    body: row.body,
    visibility: row.visibility,
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
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
  };
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
  if (row.parent_id !== null && row.parent_id !== undefined) {
    const parent = await env.FORUM_DB.prepare(
      "SELECT id, author_id, visibility FROM posts WHERE id = ? LIMIT 1",
    ).bind(Number(row.parent_id)).first();
    const canViewHiddenParent = parent && viewer &&
      (viewer.role === "admin" || Number(parent.author_id) === viewer.id);
    if (!parent || (parent.visibility !== "public" && !canViewHiddenParent)) return false;
  }
  return true;
}

async function listRootPosts(env, viewerId, options = {}) {
  let sql = POST_SELECT + "WHERE p.parent_id IS NULL AND p.visibility = 'public' ";
  const values = [viewerId || -1];
  if (options.before !== null && options.before !== undefined) {
    sql += "AND p.id < ? ";
    values.push(options.before);
  }
  if (options.authorId) {
    sql += "AND p.author_id = ? ";
    values.push(options.authorId);
  }
  if (options.searchTerm) {
    sql += "AND instr(lower(p.body), ?) > 0 ";
    values.push(options.searchTerm);
  }
  sql += "ORDER BY p.id DESC LIMIT 21";
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  const rows = result.results || [];
  const hasMore = rows.length > 20;
  const shown = rows.slice(0, 20).map(publicPost);
  return { posts: shown, nextBefore: hasMore && shown.length ? shown[shown.length - 1].id : null };
}

async function listReplies(env, postId, viewerId, showAll = false, before = null) {
  const visibilityFilter = showAll ? "" : "AND (p.visibility = 'public' OR p.author_id = ?) ";
  const cursorFilter = before === null ? "" : "AND p.id < ? ";
  const sql = POST_SELECT + "WHERE p.parent_id = ? " + cursorFilter +
    visibilityFilter + "ORDER BY p.id DESC LIMIT 101";
  const values = [viewerId || -1, postId];
  if (before !== null) values.push(before);
  if (!showAll) values.push(viewerId || -1);
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  const rows = result.results || [];
  const hasMore = rows.length > 100;
  const shown = rows.slice(0, 100);
  const nextBefore = hasMore && shown.length ? Number(shown[shown.length - 1].id) : null;
  return { replies: shown.map(publicPost).reverse(), nextBefore };
}

async function setupRequired(env) {
  const row = await env.FORUM_DB.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first();
  return !row;
}

async function storeUser(env, credentials, role = "member") {
  const password = await hashPassword(credentials.password, env.PASSWORD_PEPPER);
  const now = nowSeconds();
  try {
    const result = await env.FORUM_DB.prepare(
      "INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) " +
        "VALUES (?, ?, ?, ?, ?, '', ?)",
    ).bind(credentials.username, credentials.usernameKey, password.salt, password.hash, role, now).run();
    return await env.FORUM_DB.prepare(
      "SELECT id, username, username_key, password_salt, password_hash, role, bio, avatar_mime, avatar_updated_at, avatar_version " +
        "FROM users WHERE id = ? LIMIT 1",
    ).bind(Number(result.meta.last_row_id)).first();
  } catch (error) {
    const existing = await userByUsernameKey(env, credentials.usernameKey);
    if (existing) throw new HttpError(409, "That username is already taken.");
    throw error;
  }
}

async function handleSessionRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/session" && method === "GET") {
    const existing = await readSession(request, env);
    if (existing) return json({ user: existing.user, csrfToken: existing.csrfToken });
    await rateLimit(request, env, "guest-session");
    const created = await createSession(request, env);
    return json({ user: null, csrfToken: created.csrfToken }, 200, { "Set-Cookie": created.setCookie });
  }
  return null;
}

async function handleSetupStatusRoute(request, env, url, path, method) {
  if (path === "/api/setup/status" && method === "GET") {
    return json({
      required: await setupRequired(env),
      secretConfigured: Boolean(env.SETUP_SECRET),
      passwordSecurityConfigured: isValidPasswordPepper(env.PASSWORD_PEPPER),
    });
  }
  return null;
}

async function handleAvatarReadRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const avatarMatch = path.match(/^\/api\/avatars\/([0-9]+)$/);
  if (avatarMatch) {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    const row = await db.prepare("SELECT avatar_mime, avatar_data FROM users WHERE id = ? LIMIT 1")
      .bind(Number(avatarMatch[1])).first();
    if (!row || !row.avatar_mime || !row.avatar_data) throw new HttpError(404, "Picture not found.");
    const headers = securityHeaders();
    headers.set("Content-Type", row.avatar_mime);
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    const imageBytes = blobToUint8Array(row.avatar_data);
    return new Response(imageBytes, { status: 200, headers });
  }
  return null;
}

async function handleFirstAdminSetupRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/setup" && method === "POST") {
    const guest = await requireCsrf(request, env);
    await rateLimit(request, env, "setup");
    if (!(await setupRequired(env))) throw new HttpError(409, "First-time setup has already been completed.");
    if (!env.SETUP_SECRET || env.SETUP_SECRET.length < 32) {
      throw new HttpError(503, "First-time setup is locked. Configure SETUP_SECRET using Wrangler before creating the administrator.");
    }
    const body = await readJson(request);
    const credentials = validateNewCredentials(body);
    const suppliedKey = typeof body.setupKey === "string" ? body.setupKey : "";
    const expectedKeyHash = await sha256Hex(env.SETUP_SECRET);
    const suppliedKeyHash = await sha256Hex(suppliedKey);
    if (!equalConstantTime(suppliedKeyHash, expectedKeyHash)) {
      throw new HttpError(403, "The setup secret is not correct.");
    }
    let user;
    try {
      user = await storeUser(env, credentials, "admin");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (!(await setupRequired(env))) {
        throw new HttpError(409, "First-time setup has already been completed.");
      }
      throw error;
    }
    const session = await createSession(request, env, Number(user.id), guest.tokenHash);
    return json({ user: publicUser(user), csrfToken: session.csrfToken }, 201, { "Set-Cookie": session.setCookie });
  }
  return null;
}

async function handleRegistrationRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/auth/register" && method === "POST") {
    const guest = await requireCsrf(request, env);
    await rateLimit(request, env, "register");
    const body = await readJson(request);
    const credentials = validateNewCredentials(body);
    const user = await storeUser(env, credentials, "member");
    const session = await createSession(request, env, Number(user.id), guest.tokenHash);
    return json({ user: publicUser(user), csrfToken: session.csrfToken }, 201, { "Set-Cookie": session.setCookie });
  }
  return null;
}

async function handleLoginRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/auth/login" && method === "POST") {
    const guest = await requireCsrf(request, env);
    await rateLimit(request, env, "login");
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!isValidUsername(username) || password.length < 1 || password.length > 128) {
      throw new HttpError(400, "Enter your username and password.");
    }
    await rateLimit(request, env, "login", "account:" + username.toLowerCase());
    const user = await userByUsernameKey(env, username.toLowerCase());
    const valid = await verifyPassword(
      password,
      user ? user.password_salt : DUMMY_SALT,
      user ? user.password_hash : DUMMY_HASH,
      env.PASSWORD_PEPPER,
    );
    if (!user || !valid) throw new HttpError(401, "The username or password is incorrect.");
    const activeBan = await db.prepare(
      "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
    ).bind(Number(user.id), nowSeconds()).first();
    if (activeBan) throw new HttpError(403, "This account is currently banned.");
    const session = await createSession(request, env, Number(user.id), guest.tokenHash, true);
    if (!session) throw new HttpError(403, "This account is currently banned.");
    return json({ user: publicUser(user), csrfToken: session.csrfToken }, 200, { "Set-Cookie": session.setCookie });
  }
  return null;
}

async function handleLogoutRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/auth/logout" && method === "POST") {
    const session = await requireUser(request, env);
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.tokenHash).run();
    return new Response(null, {
      status: 204,
      headers: securityHeaders(new Headers({ "Cache-Control": "no-store", "Set-Cookie": expiredCookie(request) })),
    });
  }
  return null;
}

async function handleAuthRoutes(request, env, url, path, method) {
  const handlers = [handleSessionRoute, handleSetupStatusRoute, handleAvatarReadRoute, handleFirstAdminSetupRoute, handleRegistrationRoute, handleLoginRoute, handleLogoutRoute];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }
  return null;
}

async function handlePostFeedRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/posts" && method === "GET") {
    const session = await readSession(request, env);
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      if (!/^[1-9][0-9]{0,14}$/.test(beforeRaw)) throw new HttpError(400, "That page cursor is invalid.");
      before = Number(beforeRaw);
    }
    const feed = await listRootPosts(env, session && session.user ? session.user.id : null, { before });
    return json(feed);
  }
  return null;
}

async function handleRepliesReadRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const repliesReadMatch = path.match(/^\/api\/posts\/([0-9]+)\/replies$/);
  if (repliesReadMatch && method === "GET") {
    const postId = Number(repliesReadMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const parent = await postById(env, postId, viewer ? viewer.id : null);
    if (!(await canViewPost(env, parent, viewer))) {
      throw new HttpError(404, "Post not found.");
    }
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      if (!/^[1-9][0-9]{0,14}$/.test(beforeRaw)) throw new HttpError(400, "That reply cursor is invalid.");
      before = Number(beforeRaw);
    }
    const page = await listReplies(env, postId, viewer ? viewer.id : null,
      Boolean(viewer && viewer.role === "admin"), before);
    return json(page);
  }
  return null;
}

async function handlePostDetailRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const postMatch = path.match(/^\/api\/posts\/([0-9]+)$/);
  if (postMatch && method === "GET") {
    const postId = Number(postMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const row = await postById(env, postId, viewer ? viewer.id : null);
    if (!(await canViewPost(env, row, viewer))) throw new HttpError(404, "Post not found.");
    const post = publicPost(row);
    const replyPage = await listReplies(env, postId, viewer ? viewer.id : null, Boolean(viewer && viewer.role === "admin"));
    post.replies = replyPage.replies;
    post.repliesNextBefore = replyPage.nextBefore;
    return json(post);
  }
  return null;
}

async function handleReplyCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const replyMatch = path.match(/^\/api\/posts\/([0-9]+)\/replies$/);
  if (replyMatch && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const parentId = Number(replyMatch[1]);
    if (!Number.isSafeInteger(parentId) || parentId < 1) throw new HttpError(404, "Post not found.");
    const parent = await postById(env, parentId, session.user.id);
    if (!parent || parent.visibility !== "public" || parent.parent_id !== null) {
      throw new HttpError(400, "Replies must be attached to a public conversation, not another reply.");
    }
    const body = await readJson(request);
    const message = requiredText(body.body, "reply", 2000);
    const result = await db.prepare(
      "INSERT INTO posts (author_id, parent_id, body, visibility, created_at) VALUES (?, ?, ?, 'public', ?)",
    ).bind(session.user.id, parentId, message, nowSeconds()).run();
    return json({ id: Number(result.meta.last_row_id) }, 201);
  }
  return null;
}

async function handlePostCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/posts" && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const body = await readJson(request);
    const message = requiredText(body.body, "post", 2000);
    const result = await db.prepare(
      "INSERT INTO posts (author_id, parent_id, body, visibility, created_at) VALUES (?, NULL, ?, 'public', ?)",
    ).bind(session.user.id, message, nowSeconds()).run();
    return json({ id: Number(result.meta.last_row_id) }, 201);
  }
  return null;
}

async function handleReactionRoute(request, env, url, path, method) {
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
    await db.prepare(
      "INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(post_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at",
    ).bind(postId, session.user.id, body.value, nowSeconds()).run();
    return json({ ok: true });
  }
  return null;
}

async function handleSearchRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/search" && method === "GET") {
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (!query || query.length > 100) {
      if (!query) return json({ users: [], posts: [] });
      throw new HttpError(400, "Search must be 1–100 characters long.");
    }
    const session = await readSession(request, env);
    const viewerId = session && session.user ? session.user.id : null;
    const users = await db.prepare(SEARCH_USERS_SQL).bind(query, query).all();
    const posts = await listRootPosts(env, viewerId, { searchTerm: query });
    return json({
      users: (users.results || []).map(publicUser),
      posts: posts.posts,
    });
  }
  return null;
}

async function handlePostRoutes(request, env, url, path, method) {
  const handlers = [handlePostFeedRoute, handleRepliesReadRoute, handlePostDetailRoute, handleReplyCreateRoute, handlePostCreateRoute, handleReactionRoute, handleSearchRoute];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }
  return null;
}

async function handleUserProfileRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === "GET") {
    let username;
    try {
      username = decodeURIComponent(userMatch[1]);
    } catch {
      throw new HttpError(404, "Member not found.");
    }
    const user = await userByUsernameKey(env, username.toLowerCase());
    if (!user) throw new HttpError(404, "Member not found.");
    const session = await readSession(request, env);
    const viewerId = session && session.user ? session.user.id : null;
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      if (!/^[1-9][0-9]{0,14}$/.test(beforeRaw)) throw new HttpError(400, "That page cursor is invalid.");
      before = Number(beforeRaw);
    }
    const posts = await listRootPosts(env, viewerId, { authorId: Number(user.id), before });
    return json({
      id: Number(user.id),
      username: user.username,
      role: user.role,
      bio: user.bio || "",
      avatarUrl: user.avatar_mime ? "/api/avatars/" + user.id + "?v=" + user.avatar_version : null,
      posts: posts.posts,
      postsNextBefore: posts.nextBefore,
    });
  }
  return null;
}

async function handleBioUpdateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me" && method === "PATCH") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    const body = await readJson(request);
    if (typeof body.bio !== "string" || body.bio.length > 280) {
      throw new HttpError(400, "Your bio must be 280 characters or fewer.");
    }
    const bio = body.bio.trim();
    await db.prepare("UPDATE users SET bio = ? WHERE id = ?").bind(bio, session.user.id).run();
    return json({ bio });
  }
  return null;
}

async function handleAvatarUploadRoute(request, env, url, path, method) {
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
    const updatedAt = nowSeconds();
    const avatarVersion = createAvatarVersion();
    await db.prepare(
      "UPDATE users SET avatar_mime = ?, avatar_data = ?, avatar_updated_at = ?, avatar_version = ? WHERE id = ?",
    ).bind(mime, bytes, updatedAt, avatarVersion, session.user.id).run();
    return json({ avatarUrl: "/api/avatars/" + session.user.id + "?v=" + avatarVersion });
  }
  return null;
}

async function handlePasswordChangeRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me/password" && method === "PATCH") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    const body = await readJson(request);
    if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string" ||
      body.currentPassword.length > 128 || !isValidPassword(body.newPassword)) {
      throw new HttpError(400, "Enter your current password and a new password of 12–128 characters.");
    }
    await rateLimit(request, env, "password-change", String(session.user.id));
    const row = await userByUsernameKey(env, session.user.username.toLowerCase());
    if (!row || !(await verifyPassword(body.currentPassword, row.password_salt, row.password_hash, env.PASSWORD_PEPPER))) {
      throw new HttpError(401, "Your current password is incorrect.");
    }
    const password = await hashPassword(body.newPassword, env.PASSWORD_PEPPER);
    await db.batch([
      db.prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?")
        .bind(password.salt, password.hash, session.user.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
        .bind(session.user.id, session.tokenHash),
    ]);
    return json({ ok: true });
  }
  return null;
}

async function handleProfileRoutes(request, env, url, path, method) {
  const handlers = [handleUserProfileRoute, handleBioUpdateRoute, handleAvatarUploadRoute, handlePasswordChangeRoute];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }
  return null;
}

async function handleReportCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const reportMatch = path.match(/^\/api\/posts\/([0-9]+)\/reports$/);
  if (reportMatch && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "report", String(session.user.id));
    const postId = Number(reportMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
    if (Number(post.author_id) === session.user.id) throw new HttpError(400, "You cannot report your own post.");
    const body = await readJson(request);
    const reason = requiredText(body.reason, "report reason", 500);
    try {
      await db.prepare(
        "INSERT INTO reports (post_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)",
      ).bind(postId, session.user.id, reason, nowSeconds()).run();
    } catch (error) {
      const duplicate = await db.prepare(
        "SELECT id FROM reports WHERE post_id = ? AND reporter_id = ? AND status = 'open' LIMIT 1",
      ).bind(postId, session.user.id).first();
      if (duplicate) throw new HttpError(409, "You already have an open report for this post.");
      throw error;
    }
    return json({ ok: true }, 201);
  }
  return null;
}

async function handleReportQueueRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/reports" && method === "GET") {
    await requireAdmin(request, env, false);
    const result = await db.prepare(
      "SELECT r.id, r.reason, r.created_at, reporter.username AS reporter_username, " +
        "p.id AS post_id, p.body AS post_body, author.id AS author_id, author.username AS author_username " +
        "FROM reports r JOIN users reporter ON reporter.id = r.reporter_id " +
        "JOIN posts p ON p.id = r.post_id JOIN users author ON author.id = p.author_id " +
        "WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT 100",
    ).all();
    return json({
      reports: (result.results || []).map((row) => ({
        id: Number(row.id),
        reason: row.reason,
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
        reporter: { username: row.reporter_username },
        post: {
          id: Number(row.post_id),
          body: row.post_body,
          author: { id: Number(row.author_id), username: row.author_username },
        },
      })),
    });
  }
  return null;
}

async function hidePostForOpenReport(db, reportId, moderatorId, now) {
  const results = await db.batch([
    db.prepare(
      "UPDATE posts SET visibility = 'hidden' WHERE id = (" +
        "SELECT post_id FROM reports WHERE id = ? AND status = 'open')",
    ).bind(reportId),
    db.prepare(
      "UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ? " +
        "WHERE id = ? AND status = 'open'",
    ).bind(now, moderatorId, reportId),
  ]);
  if (Number(results[1]?.meta?.changes) !== 1) {
    throw new HttpError(409, "This report was already resolved by another moderator.");
  }
}

async function dismissOpenReport(db, reportId, moderatorId, now) {
  const result = await db.prepare(
    "UPDATE reports SET status = 'dismissed', resolved_at = ?, resolved_by = ? " +
      "WHERE id = ? AND status = 'open'",
  ).bind(now, moderatorId, reportId).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409, "This report was already resolved by another moderator.");
  }
}

async function handleReportResolveRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/reports\/([0-9]+)\/resolve$/);
  if (!match || method !== "POST") return null;

  const session = await requireAdmin(request, env);
  const reportId = Number(match[1]);
  if (!Number.isSafeInteger(reportId) || reportId < 1) {
    throw new HttpError(404, "Report not found.");
  }
  const body = await readJson(request);
  if (body.action !== "dismiss" && body.action !== "hide_post") {
    throw new HttpError(400, "Choose dismiss or hide post.");
  }
  const db = env.FORUM_DB;
  const report = await db.prepare(
    "SELECT id, post_id FROM reports WHERE id = ? AND status = 'open' LIMIT 1",
  ).bind(reportId).first();
  if (!report) throw new HttpError(404, "Open report not found.");

  const now = nowSeconds();
  if (body.action === "hide_post") {
    await hidePostForOpenReport(db, reportId, session.user.id, now);
  } else {
    await dismissOpenReport(db, reportId, session.user.id, now);
  }
  return json({ ok: true });
}

async function handleBanListRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/bans" && method === "GET") {
    await requireAdmin(request, env, false);
    const result = await db.prepare(
      "SELECT b.id, b.user_id, b.reason, b.expires_at, u.username " +
        "FROM bans b JOIN users u ON u.id = b.user_id " +
        "WHERE b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?) " +
        "ORDER BY b.created_at DESC LIMIT 200",
    ).bind(nowSeconds()).all();
    return json({
      bans: (result.results || []).map((row) => ({
        id: Number(row.id),
        user: { id: Number(row.user_id), username: row.username },
        reason: row.reason,
        expiresAt: row.expires_at ? new Date(Number(row.expires_at) * 1000).toISOString() : null,
      })),
    });
  }
  return null;
}

export async function createUserBan(db, targetId, moderatorId, request) {
  const body = await readJson(request);
  const reason = requiredText(body.reason, "ban reason", 500);
  const now = nowSeconds();
  const results = await db.batch([
    db.prepare(
      "UPDATE bans SET revoked_at = ?, revoked_by = ?, revocation_reason = 'Expired automatically' " +
        "WHERE user_id = ? AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?",
    ).bind(now, moderatorId, targetId, now),
    db.prepare(
      "INSERT INTO bans (user_id, reason, created_at, created_by) " +
        "SELECT ?, ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(targetId, reason, now, moderatorId, targetId, now),
    db.prepare(
      "DELETE FROM sessions WHERE user_id = ? AND EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(targetId, targetId, now),
  ]);
  if (Number(results[1]?.meta?.changes) !== 1) {
    throw new HttpError(409, "This member is already banned.");
  }
  return json({ ok: true }, 201);
}

async function revokeUserBan(db, targetId, moderatorId, request) {
  const body = await readJson(request);
  const reason = requiredText(body.reason, "unban reason", 500);
  const active = await db.prepare(
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1",
  ).bind(targetId, nowSeconds()).first();
  if (!active) throw new HttpError(404, "No active ban was found for this member.");
  const now = nowSeconds();
  const result = await db.prepare(UNBAN_ACTIVE_UPDATE_SQL)
    .bind(now, moderatorId, reason, Number(active.id), targetId, now).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409, "This ban was already revoked by another moderator.");
  }
  return json({ ok: true });
}

async function handleBanMutationRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/users\/([0-9]+)\/bans$/);
  if (!match || (method !== "POST" && method !== "DELETE")) return null;

  const session = await requireAdmin(request, env);
  const targetId = Number(match[1]);
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(404, "Member not found.");
  const db = env.FORUM_DB;
  const target = await db.prepare(
    "SELECT id, role FROM users WHERE id = ? LIMIT 1",
  ).bind(targetId).first();
  if (!target) throw new HttpError(404, "Member not found.");
  if (target.role === "admin" || targetId === session.user.id) {
    throw new HttpError(403, "Administrator accounts cannot be banned here.");
  }
  if (method === "POST") return createUserBan(db, targetId, session.user.id, request);
  return revokeUserBan(db, targetId, session.user.id, request);
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (!env.FORUM_DB) throw new HttpError(503, "The forum database is not configured.");

  await rateLimit(request, env, method === "GET" || method === "HEAD" ? "read" : "write");

  const handlers = [handleAuthRoutes, handlePostRoutes, handleProfileRoutes, handleModerationRoutes];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }

  if (path.startsWith("/api/")) throw new HttpError(404, "That API endpoint does not exist.");
  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await routeApi(request, env);
      } catch (error) {
        return apiError(error);
      }
    }
    if (!env.ASSETS) return json({ error: "Static assets are not configured." }, 503);
    try {
      return secureResponse(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error("Static asset request failed:", error && error.name ? error.name : "UnknownError");
      return json({ error: "The requested page could not be loaded." }, 500);
    }
  },
};
