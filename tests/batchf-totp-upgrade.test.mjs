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

// Batch F (account security), item 3: the TOTP upgrade. Pins replay refusal
// (a code verifies at most once per member, on every live-secret path),
// expiry, the human-readable single-use recovery codes, the limiter, the
// enrolment QR, and that no secret ever rides a log line or a non-setup
// response.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedUser, sha256 } from "./helpers/seed.mjs";
import { generateTotpSecret, totpAt, totpMatchStep, TOTP_STEP } from "../api/core/totp.mjs";
import { issueTotpChallenge, normalizeBackupCode } from "../api/twofa.mjs";
import { qrMatrix } from "../public/js/totp-qr.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const PASSWORD = "correct horse battery";
const post = (env, path, session, body) => call(env, path, { method: "POST", session, body });

async function enrolled(env, name = "alice") {
  const id = await seedUser(env.__sqlite, { username: name, password: PASSWORD });
  const secret = generateTotpSecret();
  env.__sqlite.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?").run(secret, id);
  return { id, secret, session: forgeSession(env.__sqlite, id) };
}

let guestCounter = 0;
function guest(env) {
  guestCounter += 1;
  const token = sha256("guest-" + guestCounter).slice(0, 44);
  env.__sqlite.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)",
  ).run(sha256(token), "guestcsrf", now(), now() + 3600);
  return { cookie: "__Host-wempo_session=" + token, csrf: "guestcsrf" };
}

async function loginStep(env, userId, code) {
  const challenge = await issueTotpChallenge(env.FORUM_DB, userId);
  return post(env, "/api/auth/totp", guest(env), { challenge, code });
}

test("totpMatchStep returns the matched counter inside the ±1 window and null outside it", async () => {
  const secret = generateTotpSecret();
  const at = 1_800_000_000;
  const step = Math.floor(at / TOTP_STEP);
  assert.equal(await totpMatchStep(secret, await totpAt(secret, at), at), step);
  assert.equal(await totpMatchStep(secret, await totpAt(secret, at - TOTP_STEP), at), step - 1);
  const stale = await totpAt(secret, at - 3 * TOTP_STEP);
  const window = await Promise.all([-1, 0, 1].map((d) => totpAt(secret, at + d * TOTP_STEP)));
  if (!window.includes(stale)) assert.equal(await totpMatchStep(secret, stale, at), null, "expired code refused");
  assert.equal(await totpMatchStep(secret, "12345", at), null);
});

test("login: the same TOTP code is refused the second time (replay)", async () => {
  const env = makeEnv();
  const alice = await enrolled(env);
  const code = await totpAt(alice.secret, now());
  assert.equal((await loginStep(env, alice.id, code)).status, 200);
  assert.equal((await loginStep(env, alice.id, code)).status, 401, "replayed code must not mint a second session");
});

test("a code spent at login cannot then switch two-factor off", async () => {
  const env = makeEnv();
  const alice = await enrolled(env);
  const code = await totpAt(alice.secret, now());
  assert.equal((await loginStep(env, alice.id, code)).status, 200);
  assert.equal((await post(env, "/api/me/totp/disable", alice.session, { code })).status, 401);
  assert.equal(Number(env.__sqlite.prepare("SELECT totp_enabled AS e FROM users WHERE id = ?").get(alice.id).e), 1);
});

test("an older step is refused once a newer step has been spent", async () => {
  const env = makeEnv();
  const alice = await enrolled(env);
  const at = now();
  env.__sqlite.prepare("INSERT INTO totp_used_steps (user_id, last_step) VALUES (?, ?)")
    .run(alice.id, Math.floor(at / TOTP_STEP));
  const previous = await totpAt(alice.secret, at - TOTP_STEP);
  const current = await totpAt(alice.secret, at);
  if (previous !== current) assert.equal((await loginStep(env, alice.id, previous)).status, 401);
  assert.equal((await loginStep(env, alice.id, current)).status, 401, "the spent step itself is refused too");
});

test("an expired code (three steps old) is refused at login", async () => {
  const env = makeEnv();
  const alice = await enrolled(env);
  const at = now();
  const stale = await totpAt(alice.secret, at - 3 * TOTP_STEP);
  const window = await Promise.all([-1, 0, 1].map((d) => totpAt(alice.secret, at + d * TOTP_STEP)));
  if (!window.includes(stale)) assert.equal((await loginStep(env, alice.id, stale)).status, 401);
});

test("recovery codes are human-readable base32 groups, shown once, single-use, and stored hashed", async () => {
  const env = makeEnv();
  const alice = await enrolled(env);
  const res = await post(env, "/api/me/totp/backups/generate", alice.session,
    { currentPassword: PASSWORD, code: await totpAt(alice.secret, now()) });
  assert.equal(res.status, 200);
  const { codes } = await res.json();
  assert.equal(codes.length, 10);
  for (const code of codes) assert.match(code, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  const stored = env.__sqlite.prepare("SELECT code_hash FROM totp_backup_codes WHERE user_id = ?").all(alice.id);
  assert.equal(stored.length, 10);
  for (const row of stored) assert.ok(!codes.includes(row.code_hash));
  // Typed in lower case with a space, it still works — once.
  const typed = codes[0].toLowerCase().replace("-", " ");
  assert.equal((await loginStep(env, alice.id, typed)).status, 200);
  assert.equal((await loginStep(env, alice.id, codes[0])).status, 401, "a recovery code burns on first use");
});

test("normalizeBackupCode accepts spacing/case variants of the new format and nothing else", () => {
  assert.equal(normalizeBackupCode("abcde-fghij"), "ABCDEFGHIJ");
  assert.equal(normalizeBackupCode(" ABCDE FGHIJ "), "ABCDEFGHIJ");
  assert.equal(normalizeBackupCode("ABCDE-FGHI1"), null);
  assert.equal(normalizeBackupCode("ABCDEFGHIJK"), null);
  assert.equal(normalizeBackupCode(42), null);
});

test("legacy 8-character backup codes keep working (single-use)", async () => {
  const env = makeEnv();
  const alice = await enrolled(env);
  env.__sqlite.prepare("INSERT INTO totp_backup_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)")
    .run(alice.id, sha256("Ab-_9xYz"), now());
  assert.equal((await loginStep(env, alice.id, "Ab-_9xYz")).status, 200);
  assert.equal((await loginStep(env, alice.id, "Ab-_9xYz")).status, 401);
});

test("the TOTP limiter refuses code guessing with 429", async () => {
  const { bindings } = makeLimiters(false);
  const env = makeEnv(bindings);
  const alice = await enrolled(env);
  const res = await loginStep(env, alice.id, "000000");
  assert.equal(res.status, 429);
});

test("no secret in logs or non-setup responses", async () => {
  const env = makeEnv();
  const alice = await enrolled(env);
  const lines = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const name of Object.keys(saved)) console[name] = (...args) => lines.push(args.join(" "));
  try {
    const bodies = [];
    for (const res of [
      await loginStep(env, alice.id, "000000"),
      await loginStep(env, alice.id, await totpAt(alice.secret, now())),
      await post(env, "/api/me/totp/disable", alice.session, { code: "111111" }),
    ]) bodies.push(await res.text());
    for (const text of [...bodies, ...lines]) assert.ok(!text.includes(alice.secret), "secret leaked: " + text);
  } finally {
    Object.assign(console, saved);
  }
});

test("enrolment QR: built client-side from the otpauth URI with the vendored qrcode-generator", () => {
  const matrix = qrMatrix("otpauth://totp/Forum:alice?secret=JBSWY3DPEHPK3PXP&issuer=Forum");
  assert.ok(matrix.length >= 21 && matrix.length === matrix[0].length, "square QR module matrix");
  // Finder pattern: the top-left 7x7 corner's outer ring is dark.
  for (let i = 0; i < 7; i++) assert.equal(matrix[0][i], true);
  const source = read("public/js/totp-qr.js");
  assert.match(source, /from "\.\/vendor\/qrcode-generator\/qrcode\.mjs"/);
  assert.doesNotMatch(source, /innerHTML|fetch\(|api\(/, "QR is DOM-built and never leaves the browser");
  const twofa = read("public/js/routes/twofa.js");
  assert.match(twofa, /otpauthQrSvg\(/, "the setup step shows the QR");
});
