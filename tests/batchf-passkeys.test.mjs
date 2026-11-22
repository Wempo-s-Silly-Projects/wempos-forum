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

// Batch F (account security), item 4: passkeys (WebAuthn) as an ADDITIONAL
// sign-in method, verified on the worker by @simplewebauthn/server. A small
// software authenticator below (P-256, "none" attestation) drives the real
// ceremonies. Pins: re-proof before registration, challenges bound to the
// asking session and single-use, replayed assertions refused, the limiter,
// ban gate, and no key material in any response.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, now, seedBan, seedUser, sha256 } from "./helpers/seed.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const PASSWORD = "correct horse battery";
const RP_ID = new URL(ORIGIN).hostname;
const post = (env, path, session, body) => call(env, path, { method: "POST", session, body });

// ---- a minimal CBOR encoder (ints, byte/text strings, arrays, maps) -------
function head(major, length) {
  if (length < 24) return [(major << 5) | length];
  if (length < 256) return [(major << 5) | 24, length];
  if (length < 65536) return [(major << 5) | 25, length >> 8, length & 255];
  return [(major << 5) | 26, (length >>> 24) & 255, (length >> 16) & 255, (length >> 8) & 255, length & 255];
}
function cbor(value) {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const bytes = [...Buffer.from(value, "utf8")];
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  if (Array.isArray(value)) return [...head(4, value.length), ...value.flatMap(cbor)];
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return [...head(5, entries.length), ...entries.flatMap(([k, v]) => [...cbor(k), ...cbor(v)])];
}
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const u32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const rpIdHash = () => [...createHash("sha256").update(RP_ID).digest()];

function makeAuthenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(32);
  let counter = 0;
  return {
    credentialId: b64url(credentialId),
    attest(challenge) {
      const cose = new Map([[1, 2], [3, -7], [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))]]);
      const authData = new Uint8Array([...rpIdHash(), 0x45, ...u32(0), ...new Array(16).fill(0),
        credentialId.length >> 8, credentialId.length & 255, ...credentialId, ...cbor(cose)]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: ORIGIN, crossOrigin: false }));
      return {
        id: b64url(credentialId), rawId: b64url(credentialId), type: "public-key",
        response: {
          clientDataJSON: b64url(clientDataJSON),
          attestationObject: b64url(new Uint8Array(cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])))),
          transports: ["internal"],
        },
        clientExtensionResults: {}, authenticatorAttachment: "platform",
      };
    },
    assert(challenge, userHandle) {
      counter += 1;
      const authData = Buffer.from([...rpIdHash(), 0x05, ...u32(counter)]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
      const signed = Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]);
      return {
        id: b64url(credentialId), rawId: b64url(credentialId), type: "public-key",
        response: {
          clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData),
          signature: b64url(sign("sha256", signed, privateKey)), userHandle,
        },
        clientExtensionResults: {}, authenticatorAttachment: "platform",
      };
    },
  };
}

async function member(env, name = "alice") {
  const id = await seedUser(env.__sqlite, { username: name, password: PASSWORD });
  return { id, session: forgeSession(env.__sqlite, id) };
}

let guestCounter = 0;
function guest(env) {
  guestCounter += 1;
  const token = sha256("pk-guest-" + guestCounter).slice(0, 44);
  env.__sqlite.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)",
  ).run(sha256(token), "guestcsrf", now(), now() + 3600);
  return { cookie: "__Host-wempo_session=" + token, csrf: "guestcsrf" };
}

async function register(env, who, authenticator, name = "Laptop") {
  const optionsRes = await post(env, "/api/me/passkeys/options", who.session, { currentPassword: PASSWORD });
  assert.equal(optionsRes.status, 200, await optionsRes.clone().text());
  const options = await optionsRes.json();
  const response = authenticator.attest(options.challenge);
  return { options, response, res: await post(env, "/api/me/passkeys", who.session, { response, name }) };
}

async function signIn(env, authenticator, userHandle) {
  const visitor = guest(env);
  const optionsRes = await post(env, "/api/auth/passkey/options", visitor, {});
  assert.equal(optionsRes.status, 200, await optionsRes.clone().text());
  const options = await optionsRes.json();
  const response = authenticator.assert(options.challenge, userHandle);
  return { visitor, response, res: await post(env, "/api/auth/passkey", visitor, { response }) };
}

test("registration: options demand the current password and ask for a discoverable, user-verified passkey", async () => {
  const env = makeEnv();
  const alice = await member(env);
  assert.equal((await post(env, "/api/me/passkeys/options", alice.session, { currentPassword: "wrong" })).status, 401);
  assert.equal((await post(env, "/api/me/passkeys/options", alice.session, {})).status, 400);
  const options = await (await post(env, "/api/me/passkeys/options", alice.session, { currentPassword: PASSWORD })).json();
  assert.equal(options.rp.id, RP_ID);
  assert.equal(options.authenticatorSelection.residentKey, "required");
  assert.equal(options.authenticatorSelection.userVerification, "required");
  assert.equal(options.attestation, "none");
  const stored = env.__sqlite.prepare("SELECT challenge_hash, purpose FROM webauthn_challenges").all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].purpose, "register");
  assert.notEqual(stored[0].challenge_hash, options.challenge, "only the challenge hash is stored");
});

test("registration verifies, stores public material only, and lists without key material", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const authenticator = makeAuthenticator();
  const { res } = await register(env, alice, authenticator, "My laptop");
  assert.equal(res.status, 201, await res.clone().text());
  const row = env.__sqlite.prepare("SELECT * FROM passkeys WHERE user_id = ?").get(alice.id);
  assert.equal(row.credential_id, authenticator.credentialId);
  assert.equal(row.name, "My laptop");
  const list = await (await call(env, "/api/me/passkeys", { session: alice.session })).json();
  assert.equal(list.passkeys.length, 1);
  assert.deepEqual(Object.keys(list.passkeys[0]).sort(), ["createdAt", "id", "lastUsedAt", "name"]);
  assert.ok(!JSON.stringify(list).includes(row.public_key));
});

test("a registration challenge is single-use", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const authenticator = makeAuthenticator();
  const { response, res } = await register(env, alice, authenticator);
  assert.equal(res.status, 201);
  env.__sqlite.prepare("DELETE FROM passkeys").run();
  const replay = await post(env, "/api/me/passkeys", alice.session, { response, name: "again" });
  assert.equal(replay.status, 400);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM passkeys").get().n, 0);
});

test("a registration challenge is bound to the member who asked for it", async () => {
  const env = makeEnv();
  const alice = await member(env, "alice");
  const mallory = await member(env, "mallory");
  const options = await (await post(env, "/api/me/passkeys/options", alice.session, { currentPassword: PASSWORD })).json();
  const response = makeAuthenticator().attest(options.challenge);
  assert.equal((await post(env, "/api/me/passkeys", mallory.session, { response, name: "x" })).status, 400);
});

test("sign-in with a passkey mints a session, bumps the counter, and records last use", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const authenticator = makeAuthenticator();
  await register(env, alice, authenticator);
  const { res } = await signIn(env, authenticator, b64url(Buffer.from(String(alice.id))));
  assert.equal(res.status, 200, await res.clone().text());
  assert.match(res.headers.get("Set-Cookie"), /__Host-wempo_session=/);
  const body = await res.json();
  assert.equal(body.user.username, "alice");
  assert.ok(body.csrfToken);
  const row = env.__sqlite.prepare("SELECT counter, last_used_at FROM passkeys").get();
  assert.equal(row.counter, 1);
  assert.ok(row.last_used_at > 0);
});

test("a replayed sign-in assertion is refused (challenge single-use)", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const authenticator = makeAuthenticator();
  await register(env, alice, authenticator);
  const { visitor, response, res } = await signIn(env, authenticator);
  assert.equal(res.status, 200);
  const replay = await post(env, "/api/auth/passkey", visitor, { response });
  assert.equal(replay.status, 401);
});

test("an expired sign-in challenge is refused", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const authenticator = makeAuthenticator();
  await register(env, alice, authenticator);
  const visitor = guest(env);
  const options = await (await post(env, "/api/auth/passkey/options", visitor, {})).json();
  env.__sqlite.prepare("UPDATE webauthn_challenges SET expires_at = ?").run(now() - 1);
  const res = await post(env, "/api/auth/passkey", visitor, { response: authenticator.assert(options.challenge) });
  assert.equal(res.status, 401);
});

test("an unknown credential or a banned member cannot sign in", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const stranger = makeAuthenticator();
  assert.equal((await signIn(env, stranger)).res.status, 401);
  const authenticator = makeAuthenticator();
  await register(env, alice, authenticator);
  seedBan(env.__sqlite, alice.id);
  assert.equal((await signIn(env, authenticator)).res.status, 403);
});

test("the login limiter throttles passkey sign-in", async () => {
  const { bindings } = makeLimiters(false);
  const env = makeEnv(bindings);
  const res = await post(env, "/api/auth/passkey/options", guest(env), {});
  assert.equal(res.status, 429);
});

test("removing a passkey: own only", async () => {
  const env = makeEnv();
  const alice = await member(env, "alice");
  const mallory = await member(env, "mallory");
  await register(env, alice, makeAuthenticator());
  const id = env.__sqlite.prepare("SELECT id FROM passkeys").get().id;
  assert.equal((await call(env, "/api/me/passkeys/" + id, { method: "DELETE", session: mallory.session })).status, 404);
  assert.equal((await call(env, "/api/me/passkeys/" + id, { method: "DELETE", session: alice.session })).status, 200);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM passkeys").get().n, 0);
});

test("client: vendored @simplewebauthn/browser drives the ceremonies; sign-in button is offered", () => {
  const client = read("public/js/passkeys.js");
  assert.match(client, /from "\.\/vendor\/simplewebauthn-browser\/index\.js"/);
  assert.match(client, /startRegistration\(/);
  assert.match(client, /startAuthentication\(/);
  assert.match(read("public/js/routes/feed.js"), /renderPasskeySettings\(/);
});
