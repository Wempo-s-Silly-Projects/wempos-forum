// v4.0 core leaf: session and identity machinery — cookie sessions (only
// SHA-256 token hashes are stored), CSRF + same-origin enforcement, the
// role gates, active-ban and banned-network checks, and the keyed IP hash.
// Imports only the crypto/http/roles leaves and constants.mjs.
import { SESSION_INSERT_IF_UNBANNED_SQL } from "../../constants.mjs";
import { equalConstantTime, nowSeconds, randomToken, sha256Hex } from "./crypto.mjs";
import { HttpError } from "./http.mjs";
import { publicRole } from "./roles.mjs";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

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

export async function readSession(request, env) {
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

export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) {
    throw new HttpError(403, "This request was blocked because its origin could not be verified.");
  }
}

export async function requireCsrf(request, env) {
  assertSameOrigin(request);
  const session = await readSession(request, env);
  if (!session) throw new HttpError(401, "Your session has expired. Reload the page and sign in again.");
  const supplied = request.headers.get("X-CSRF-Token") || "";
  if (!equalConstantTime(supplied, session.csrfToken)) {
    throw new HttpError(403, "Your security token is out of date. Reload the page and try again.");
  }
  return session;
}

export async function requireUser(request, env) {
  const session = await requireCsrf(request, env);
  if (!session.user) throw new HttpError(401, "Please sign in to do that.");
  return session;
}

export async function requireSignedInRead(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.user) throw new HttpError(401, "Please sign in to do that.");
  return session;
}

// Moderation gate: staff — the admin tier plus the owner (v3.1 public
// vocabulary; 'moderator' survives only as the STORED role value for the
// admin tier; the pre-rename requiremod spelling was renamed requireStaff
// in the final sweep). Mutating (default) requests go
// through requireUser (same-origin + CSRF); read-only requests skip that.
// Roles are read at request time, so demotions take effect on the next
// readSession without any session invalidation.
export async function requireStaff(request, env, mutating = true) {
  const session = mutating
    ? await requireUser(request, env)
    : await requireSignedInRead(request, env);
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    throw new HttpError(403, "Only admins can do that.");
  }
  return session;
}

// Strictly owner-only gate (promote/demote, first-owner-style operations).
export async function requireAdmin(request, env, mutating = true) {
  const session = mutating
    ? await requireUser(request, env)
    : await requireSignedInRead(request, env);
  if (session.user.role !== "owner") throw new HttpError(403, "Only the owner can do that.");
  return session;
}

export async function assertNotBanned(env, userId) {
  const activeBan = await env.FORUM_DB.prepare(
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
  ).bind(userId, nowSeconds()).first();
  if (activeBan) throw new HttpError(403, "This account is currently banned.");
}
