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

// Batch F: passkeys (WebAuthn) as an ADDITIONAL sign-in method, verified by
// @simplewebauthn/server (MIT, Web Crypto — runs on workerd). Passwords and
// Wempo Accounts sign-in stay exactly as they were.
//
//   POST   /api/me/passkeys/options  registration options (current password re-proof)
//   POST   /api/me/passkeys          verify + store a new passkey
//   GET    /api/me/passkeys          list (names and dates only)
//   DELETE /api/me/passkeys/:id      remove one of your own
//   POST   /api/auth/passkey/options sign-in options (guest session)
//   POST   /api/auth/passkey         verify + mint the forum session
//
// Every ceremony challenge is stored as its SHA-256, bound to the session
// that asked for it, and claimed by ONE guarded DELETE before verification —
// a replayed, expired, or foreign-session challenge matches nothing. Passkeys
// are discoverable and user-verified (device PIN/biometric), so a passkey
// sign-in is itself multi-factor and does not ask for the TOTP code.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { PASSKEY_CHALLENGE_TTL_SECONDS, PASSKEY_MAX_PER_USER, PASSKEY_NAME_MAX_LENGTH } from "../constants.mjs";
import { assertNetworkNotBanned, createSession, requireCsrf, requireSignedInRead, requireUser } from "./core/auth.mjs";
import { nowSeconds, sha256Hex } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { verifyPassword } from "./core/passwords.mjs";
import { publicUser, userByUsernameKey } from "./core/shapers.mjs";
import { siteName } from "./branding.mjs";

const EXPIRED_REGISTRATION = "This passkey request has expired. Start again.";
const EXPIRED_SIGN_IN = "This passkey sign-in has expired. Try again.";
const UNRECOGNISED = "That passkey was not recognised.";
const TRANSPORTS = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);

function base64urlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decodeUserHandle(handle) {
  try {
    return new TextDecoder().decode(base64urlToBytes(handle));
  } catch {
    return "";
  }
}

function bytesToBase64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The relying party is the forum's own host; the expected origin is the
// request's own origin (assertSameOrigin already pinned it for mutations).
function relyingParty(url) {
  return { rpID: url.hostname, origin: url.origin };
}

// The challenge the browser signed, read from clientDataJSON — only a lookup
// key for the claim; the library re-checks it against the claimed value.
function signedChallenge(response) {
  try {
    const clientData = JSON.parse(new TextDecoder().decode(base64urlToBytes(String(response.response.clientDataJSON))));
    return typeof clientData.challenge === "string" && clientData.challenge.length <= 256 ? clientData.challenge : "";
  } catch {
    return "";
  }
}

function readCeremonyResponse(body) {
  const response = body && typeof body.response === "object" && body.response ? body.response : null;
  if (!response || typeof response.id !== "string" || response.id.length > 1024 || !response.response) return null;
  return response;
}

async function storeChallenge(db, challenge, purpose, sessionHash, userId) {
  await db.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= ?").bind(nowSeconds()).run();
  await db.prepare(
    "INSERT INTO webauthn_challenges (challenge_hash, purpose, session_hash, user_id, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(await sha256Hex(challenge), purpose, sessionHash, userId, nowSeconds() + PASSKEY_CHALLENGE_TTL_SECONDS).run();
}

async function claimChallenge(db, challenge, purpose, sessionHash, userId) {
  if (!challenge) return false;
  const userClause = userId === null ? "user_id IS NULL" : "user_id = ?";
  const binds = [await sha256Hex(challenge), purpose, sessionHash, ...(userId === null ? [] : [userId]), nowSeconds()];
  const claimed = await db.prepare(
    "DELETE FROM webauthn_challenges WHERE challenge_hash = ? AND purpose = ? AND session_hash = ? AND " +
      userClause + " AND expires_at > ?",
  ).bind(...binds).run();
  return Number(claimed.meta?.changes) === 1;
}

function shapePasskey(row) {
  return {
    id: Number(row.id),
    name: row.name,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null || row.last_used_at === undefined ? null : Number(row.last_used_at),
  };
}

async function registrationOptions(request, env, url) {
  const db = env.FORUM_DB;
  const session = await requireUser(request, env);
  await rateLimit(request, env, "totp", "user:" + session.user.id);
  const body = await readJson(request);
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  if (currentPassword.length < 1 || currentPassword.length > 128) {
    throw new HttpError(400, "Enter your current password to add a passkey.");
  }
  const row = await db.prepare("SELECT password_salt, password_hash FROM users WHERE id = ? LIMIT 1")
    .bind(session.user.id).first();
  if (!row || !(await verifyPassword(currentPassword, row.password_salt, row.password_hash, env.PASSWORD_PEPPER))) {
    throw new HttpError(401, "Your current password is incorrect.");
  }
  const existing = (await db.prepare("SELECT credential_id, transports FROM passkeys WHERE user_id = ?")
    .bind(session.user.id).all()).results ?? [];
  if (existing.length >= PASSKEY_MAX_PER_USER) {
    throw new HttpError(409, "You have reached the passkey limit. Remove one first.");
  }
  const { rpID } = relyingParty(url);
  const options = await generateRegistrationOptions({
    rpName: await siteName(env),
    rpID,
    userName: session.user.username,
    userID: new TextEncoder().encode(String(session.user.id)),
    attestationType: "none",
    timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports ? passkey.transports.split(",") : undefined,
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await storeChallenge(db, options.challenge, "register", session.tokenHash, session.user.id);
  return json(options);
}

async function registrationVerify(request, env, url) {
  const db = env.FORUM_DB;
  const session = await requireUser(request, env);
  await rateLimit(request, env, "totp", "user:" + session.user.id);
  const body = await readJson(request);
  const response = readCeremonyResponse(body);
  if (!response) throw new HttpError(400, EXPIRED_REGISTRATION);
  const requestedName = typeof body.name === "string" ? body.name.trim() : "";
  const name = requestedName.substring(0, PASSKEY_NAME_MAX_LENGTH) || "Passkey";
  const challenge = signedChallenge(response);
  if (!(await claimChallenge(db, challenge, "register", session.tokenHash, session.user.id))) {
    throw new HttpError(400, EXPIRED_REGISTRATION);
  }
  const { rpID, origin } = relyingParty(url);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    });
  } catch {
    verification = null;
  }
  if (!verification?.verified || !verification.registrationInfo) {
    throw new HttpError(400, "That passkey could not be verified. Nothing has been changed.");
  }
  const { credential } = verification.registrationInfo;
  const transports = (credential.transports ?? []).filter((transport) => TRANSPORTS.has(transport)).join(",");
  const at = nowSeconds();
  const inserted = await db.prepare(
    "INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, name, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(credential_id) DO NOTHING",
  ).bind(session.user.id, credential.id, bytesToBase64url(credential.publicKey), Number(credential.counter) || 0,
    transports, name, at).run();
  if (Number(inserted.meta?.changes) !== 1) throw new HttpError(409, "That passkey is already registered.");
  const row = await db.prepare("SELECT id, name, created_at, last_used_at FROM passkeys WHERE credential_id = ? LIMIT 1")
    .bind(credential.id).first();
  return json({ passkey: shapePasskey(row) }, 201);
}

async function signInOptions(request, env, url) {
  await assertNetworkNotBanned(request, env);
  const guest = await requireCsrf(request, env);
  await rateLimit(request, env, "login");
  const { rpID } = relyingParty(url);
  const options = await generateAuthenticationOptions({
    rpID, userVerification: "required", timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
  });
  await storeChallenge(env.FORUM_DB, options.challenge, "login", guest.tokenHash, null);
  return json(options);
}

async function signInVerify(request, env, url) {
  const db = env.FORUM_DB;
  await assertNetworkNotBanned(request, env);
  const guest = await requireCsrf(request, env);
  await rateLimit(request, env, "login");
  const response = readCeremonyResponse(await readJson(request));
  if (!response) throw new HttpError(401, EXPIRED_SIGN_IN);
  const challenge = signedChallenge(response);
  if (!(await claimChallenge(db, challenge, "login", guest.tokenHash, null))) {
    throw new HttpError(401, EXPIRED_SIGN_IN);
  }
  const passkey = await db.prepare(
    "SELECT p.id, p.user_id, p.credential_id, p.public_key, p.counter, p.transports, u.username_key " +
      "FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.credential_id = ? LIMIT 1",
  ).bind(response.id).first();
  if (!passkey) throw new HttpError(401, UNRECOGNISED);
  const userId = Number(passkey.user_id);
  // A discoverable passkey names its account; it must be the row's owner.
  const handle = response.response.userHandle;
  if (typeof handle === "string" && handle) {
    if (decodeUserHandle(handle) !== String(userId)) throw new HttpError(401, UNRECOGNISED);
  }
  await rateLimit(request, env, "login", "user:" + userId);
  const { rpID, origin } = relyingParty(url);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey: base64urlToBytes(passkey.public_key),
        counter: Number(passkey.counter) || 0,
        transports: passkey.transports ? passkey.transports.split(",") : undefined,
      },
    });
  } catch {
    verification = null;
  }
  if (!verification?.verified) throw new HttpError(401, UNRECOGNISED);
  await db.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(Number(verification.authenticationInfo.newCounter) || 0, nowSeconds(), passkey.id).run();
  const user = await userByUsernameKey(env, passkey.username_key);
  if (!user) throw new HttpError(401, UNRECOGNISED);
  // requireUnbanned: createSession refuses a banned member atomically.
  const session = await createSession(request, env, userId, guest.tokenHash, true);
  if (!session) throw new HttpError(403, "This account is currently banned.");
  return json({ user: publicUser(user), csrfToken: session.csrfToken }, 200, { "Set-Cookie": session.setCookie });
}

export async function handlePasskeyRoutes(request, env, url, path, method) {
  if (path === "/api/me/passkeys/options" && method === "POST") return registrationOptions(request, env, url);
  if (path === "/api/me/passkeys" && method === "POST") return registrationVerify(request, env, url);
  if (path === "/api/me/passkeys" && method === "GET") {
    const session = await requireSignedInRead(request, env);
    const rows = (await env.FORUM_DB.prepare(
      "SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at, id",
    ).bind(session.user.id).all()).results ?? [];
    return json({ passkeys: rows.map(shapePasskey) });
  }
  const removeMatch = path.match(/^\/api\/me\/passkeys\/([0-9]{1,12})$/);
  if (removeMatch && method === "DELETE") {
    const session = await requireUser(request, env);
    const removed = await env.FORUM_DB.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?")
      .bind(Number(removeMatch[1]), session.user.id).run();
    if (Number(removed.meta?.changes) !== 1) throw new HttpError(404, "Not found.");
    return json({ removed: true });
  }
  if (path === "/api/auth/passkey/options" && method === "POST") return signInOptions(request, env, url);
  if (path === "/api/auth/passkey" && method === "POST") return signInVerify(request, env, url);
  return null;
}
