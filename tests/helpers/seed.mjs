// Seeding + request helpers shared by the suites. Rows go straight into the
// node:sqlite referee; sessions are FORGED the way api/core/auth.mjs reads
// them (sessions.token_hash = sha256(token), cookie __Host-wempo_session).
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "../../api/core/passwords.mjs";
import worker from "../../worker.mjs";
import { TEST_PEPPER } from "./d1.mjs";

export const ORIGIN = "https://wempos-forum.com";
const DAY = 86400;

export const now = () => Math.floor(Date.now() / 1000);
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export async function seedUser(sqlite, { username, role = "member", password = null } = {}) {
  const hashed = password
    ? await hashPassword(password, TEST_PEPPER)
    : { salt: "0".repeat(32), hash: "0".repeat(64) };
  const info = sqlite.prepare(
    "INSERT INTO users (username, username_key, password_salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(username, username.toLowerCase(), hashed.salt, hashed.hash, role, now());
  return Number(info.lastInsertRowid);
}

export function seedPost(sqlite, { authorId, body, parentId = null, visibility = "public", board = "general" }) {
  const at = now();
  const info = sqlite.prepare(
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(authorId, parentId, body, visibility, at, at, board);
  return Number(info.lastInsertRowid);
}

// expiresIn: seconds from now (negative = already expired), null = permanent.
export function seedBan(sqlite, userId, expiresIn = null) {
  const expires = expiresIn === null ? null : now() + expiresIn;
  sqlite.prepare("INSERT INTO bans (user_id, reason, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(userId, "test", now() - DAY, expires);
}

export function forgeSession(sqlite, userId) {
  const token = randomBytes(33).toString("base64url"); // 44 chars, matches /^[A-Za-z0-9_-]{40,50}$/
  const csrf = randomBytes(24).toString("base64url");
  sqlite.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sha256(token), userId, csrf, now(), now() + DAY);
  return { cookie: "__Host-wempo_session=" + token, csrf };
}

// Builds a request; a session adds the cookie, and for mutations the
// same-origin + CSRF headers requireUser() demands.
export function makeRequest(path, { method = "GET", body, headers = {}, session, host = ORIGIN } = {}) {
  const finalHeaders = new Headers(headers);
  if (session) {
    finalHeaders.set("Cookie", session.cookie);
    if (method !== "GET") {
      finalHeaders.set("Origin", host);
      finalHeaders.set("X-CSRF-Token", session.csrf);
    }
  }
  let payload = body;
  if (body !== undefined && typeof body !== "string") {
    payload = JSON.stringify(body);
    finalHeaders.set("Content-Type", "application/json");
  }
  return new Request(host + path, { method, headers: finalHeaders, body: payload });
}

export function call(env, path, options) {
  return worker.fetch(makeRequest(path, options), env, { waitUntil() {} });
}
