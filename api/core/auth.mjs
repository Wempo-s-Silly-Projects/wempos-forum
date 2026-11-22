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
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// v4.0 core leaf: session and identity machinery — cookie sessions (only
// SHA-256 token hashes are stored), CSRF + same-origin enforcement, the
// role gates, active-ban and banned-network checks, and the keyed IP hash.
// Imports only the crypto/http/roles leaves and constants.mjs.
import ipaddr from "ipaddr.js";
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
//
// v5.74.1: the hashed key is the NETWORK, not the raw address. IPv6 keys on
// the /64 prefix (one subscriber allocation — a device rotates its interface
// bits freely, which made exact-address bans trivial to walk out of); IPv4
// and IPv4-mapped IPv6 key on the dotted address, byte-identical to v3.1 so
// existing IPv4 rows keep matching. Unparseable input folds to "unknown".
const IPV6_BAN_PREFIX_HEXTETS = 4; // 4 × 16 bits = /64

function rawRequestIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

export function networkKey(rawIp) {
  if (!ipaddr.isValid(rawIp)) return "unknown";
  const address = ipaddr.process(rawIp); // folds ::ffff:a.b.c.d to IPv4
  if (address.kind() === "ipv4") return address.toString();
  const prefix = address.toNormalizedString().split(":").slice(0, IPV6_BAN_PREFIX_HEXTETS).join(":");
  return "v6/64:" + prefix;
}

export async function requestIpHash(request, env) {
  return hashIpKey(networkKey(rawRequestIp(request)), env);
}

// Ban-gate lookup set: the network-key hash plus, during the v5.74.1
// transition, the legacy full-address hash so pre-v5.74.1 IPv6 ban rows keep
// refusing. Deduped (IPv4 keys equal their legacy form).
export async function requestIpHashCandidates(request, env) {
  const raw = rawRequestIp(request);
  const keys = [...new Set([networkKey(raw), raw])];
  return Promise.all(keys.map((key) => hashIpKey(key, env)));
}

async function hashIpKey(key, env) {
  const data = new TextEncoder().encode("wempo-forum-ip:" + key);
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
  const ipHashes = await requestIpHashCandidates(request, env);
  // Join bans for the ACTIVE predicate: an expired or revoked ban clears its
  // own rows on unban/appeal-approval, but the join keeps the gate correct
  // even if rows outlive the ban (review finding — blind membership blocked
  // networks whose ban was long gone).
  const now = nowSeconds();
  const row = await env.FORUM_DB.prepare(
    "SELECT 1 FROM banned_ips bi JOIN bans b ON b.id = bi.ban_id " +
      "WHERE bi.ip_hash IN (?, ?) AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > ?) LIMIT 1",
  ).bind(ipHashes[0], ipHashes[1] ?? ipHashes[0], now).first();
  if (row) throw new HttpError(403, "This network is banned from the forum.");
}

// __Host- wave: the minted name carries the cookie prefix and Secure is
// unconditional (the prefix contract requires Secure; browsers treat
// http://localhost as trustworthy, so the wrangler dev flow survives). The
// request parameter stays for caller-shape stability.
function setCookie(request, token, maxAge = SESSION_TTL_SECONDS) {
  return "__Host-wempo_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + "; Secure";
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
  // __Host- wave: the prefixed name is read first; the legacy bare name is
  // accepted for one transitional window, and a legacy hit that resolves a
  // live row self-migrates — migrateCookies re-issues the SAME token under
  // the prefixed name plus clears the legacy cookie, no session rewrite.
  // The fallback comes out on the named cleanup row once legacy reads stop.
  let token = cookieValue(request, "__Host-wempo_session");
  let legacyCookie = false;
  if (!token) {
    token = cookieValue(request, "wempo_session");
    legacyCookie = Boolean(token);
  }
  if (!token || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.FORUM_DB.prepare(
    "SELECT s.token_hash, s.user_id, s.csrf_token, s.expires_at, " +
      "u.username, u.role, u.bio, u.avatar_status, u.avatar_mime, u.avatar_updated_at, u.avatar_version, " +
      "u.totp_enabled, u.created_at " +
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
      // Two-factor sign-in (v4.0.1): the account settings panel reads the
      // real state from the session payload. Additive — nothing else in the
      // session shape moves.
      totpEnabled: Number(row.totp_enabled) === 1,
      // Newcomer cards (wave 2026-11-21-20): the member's own join date, the
      // same value their public profile already shows. Additive.
      joinedAt: row.created_at ? new Date(Number(row.created_at) * 1000).toISOString() : null,
    };
  }
  const session = { tokenHash: row.token_hash, csrfToken: row.csrf_token, expiresAt: Number(row.expires_at), user };
  if (legacyCookie) {
    session.migrateCookies = [
      "__Host-wempo_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
        Math.max(Number(row.expires_at) - nowSeconds(), 0) + "; Secure",
      "wempo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    ];
  }
  return session;
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
  // A pre-auth guest session is a one-time capability. Consume it in the
  // same D1 batch that inserts the authenticated session, and make the INSERT
  // conditional on that guest row still existing. D1 serializes batches, so
  // two tabs racing login/SSO/TOTP cannot both rotate the same guest cookie.
  // The loser gets 409 rather than a second Set-Cookie overwriting the winner.
  let insert;
  if (oldTokenHash) {
    const guestPredicate =
      "EXISTS (SELECT 1 FROM sessions WHERE token_hash = ? AND user_id IS NULL AND expires_at > ?)";
    const banPredicate = requireUnbanned
      ? " AND NOT EXISTS (SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))"
      : "";
    insert = env.FORUM_DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) " +
        "SELECT ?, ?, ?, ?, ? WHERE " + guestPredicate + banPredicate,
    ).bind(
      tokenHash, userId, csrfToken, now, expiresAt, oldTokenHash, now,
      ...(requireUnbanned ? [userId, now] : []),
    );
    const results = await env.FORUM_DB.batch([
      insert,
      env.FORUM_DB.prepare(
        "DELETE FROM sessions WHERE token_hash = ? AND EXISTS (" +
          "SELECT 1 FROM sessions WHERE token_hash = ?)",
      ).bind(oldTokenHash, tokenHash),
    ]);
    if (Number(results[0]?.meta?.changes) !== 1) {
      const guestStillExists = await env.FORUM_DB.prepare(
        "SELECT 1 FROM sessions WHERE token_hash = ? AND user_id IS NULL AND expires_at > ? LIMIT 1",
      ).bind(oldTokenHash, now).first();
      if (!guestStillExists) {
        throw new HttpError(409, "This sign-in was completed in another tab. Reload to continue.");
      }
      return null;
    }
  } else {
    insert = requireUnbanned
      ? env.FORUM_DB.prepare(SESSION_INSERT_IF_UNBANNED_SQL)
        .bind(tokenHash, userId, csrfToken, now, expiresAt, userId, now)
      : env.FORUM_DB.prepare(
        "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(tokenHash, userId, csrfToken, now, expiresAt);
    const result = await insert.run();
    if (requireUnbanned && Number(result.meta?.changes) !== 1) return null;
  }

  await env.FORUM_DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  return { tokenHash, csrfToken, setCookie: setCookie(request, token) };
}

// Fetch Metadata: a browser that sends Sec-Fetch-Site says where the write
// came from. The origin policy below is exact-origin (no sibling subdomain),
// so only same-origin and a user-initiated "none" pass this gate; cross-site
// and same-site are refused outright. An absent header (older browsers,
// non-browser clients) falls through to the Origin check unchanged. Token
// routes (the Accounts relay, MCP) never call this.
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

export function assertSameOrigin(request) {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite !== null && !ALLOWED_FETCH_SITES.has(fetchSite.trim().toLowerCase())) {
    throw new HttpError(403, "This request was blocked because its origin could not be verified.");
  }
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
