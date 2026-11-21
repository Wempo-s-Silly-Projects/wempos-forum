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

// v5.20.0: opt-in SHA-256 TOTP. Existing members (no totp_algorithms row)
// keep verifying with SHA-1 exactly as before; a member who opts in at setup
// has the algorithm stored per member, and every verify path rides it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedUser, sha256 } from "./helpers/seed.mjs";
import {
  base32Encode, generateTotpSecret, normalizeTotpAlgorithm, otpauthUri, totpAt, verifyTotpCode,
} from "../api/core/totp.mjs";
import { issueTotpChallenge } from "../api/twofa.mjs";

const ROOT = new URL("../", import.meta.url);
const PASSWORD = "correct horse battery";
const ascii = (text) => new TextEncoder().encode(text);

// ---- primitives: RFC 6238 Appendix B vectors ---------------------------------

const SHA1_KEY = base32Encode(ascii("12345678901234567890"));
const SHA256_KEY = base32Encode(ascii("12345678901234567890123456789012"));

test("RFC 6238 SHA-1 vectors are unchanged with the default algorithm", async () => {
  assert.equal(await totpAt(SHA1_KEY, 59, 8), "94287082");
  assert.equal(await totpAt(SHA1_KEY, 1111111109, 8), "07081804");
  assert.equal(await totpAt(SHA1_KEY, 1234567890, 8), "89005924");
  assert.equal(await totpAt(SHA1_KEY, 20000000000, 8), "65353130");
});

test("RFC 6238 SHA-256 vectors", async () => {
  const vectors = [
    [59, "46119246"], [1111111109, "68084774"], [1111111111, "67062674"],
    [1234567890, "91819424"], [2000000000, "90698825"], [20000000000, "77737706"],
  ];
  for (const [time, code] of vectors) {
    assert.equal(await totpAt(SHA256_KEY, time, 8, "SHA256"), code, "T=" + time);
  }
});

test("verifyTotpCode: a code only verifies under its own algorithm", async () => {
  const secret = generateTotpSecret();
  const at = now();
  const sha1Code = await totpAt(secret, at, 6);
  const sha256Code = await totpAt(secret, at, 6, "SHA256");
  assert.equal(await verifyTotpCode(secret, sha1Code, at), true);
  assert.equal(await verifyTotpCode(secret, sha256Code, at, "SHA256"), true);
  if (sha1Code !== sha256Code) {
    assert.equal(await verifyTotpCode(secret, sha256Code, at), false);
    assert.equal(await verifyTotpCode(secret, sha1Code, at, "SHA256"), false);
  }
});

test("normalizeTotpAlgorithm: only SHA256 opts in; anything else is SHA1", () => {
  assert.equal(normalizeTotpAlgorithm("SHA256"), "SHA256");
  for (const value of [undefined, null, "", "SHA1", "sha256", "SHA512", 256, {}]) {
    assert.equal(normalizeTotpAlgorithm(value), "SHA1");
  }
});

test("otpauthUri carries algorithm=SHA1 by default and SHA256 when chosen", () => {
  assert.match(otpauthUri("ABCD", "Forum", "alice"), /&algorithm=SHA1&/);
  assert.match(otpauthUri("ABCD", "Forum", "alice", "SHA256"), /&algorithm=SHA256&/);
  assert.doesNotMatch(otpauthUri("ABCD", "Forum", "alice", "SHA256"), /SHA1/);
});

// ---- routes -------------------------------------------------------------------

async function member(env, name = "alice") {
  const id = await seedUser(env.__sqlite, { username: name, password: PASSWORD });
  return { id, session: forgeSession(env.__sqlite, id) };
}

const post = (env, path, session, body) => call(env, path, { method: "POST", session, body });
const algorithmRow = (env, id) =>
  env.__sqlite.prepare("SELECT algorithm FROM totp_algorithms WHERE user_id = ?").get(id);
const enabled = (env, id) =>
  Number(env.__sqlite.prepare("SELECT totp_enabled AS e FROM users WHERE id = ?").get(id).e);

async function enroll(env, who, algorithm) {
  const body = algorithm ? { currentPassword: PASSWORD, algorithm } : { currentPassword: PASSWORD };
  const setup = await (await post(env, "/api/me/totp/setup", who.session, body)).json();
  return setup;
}

// The pre-v5.20 enrollment shape: secret on users, NO totp_algorithms row.
function seedLegacyEnrollment(env, id) {
  const secret = generateTotpSecret();
  env.__sqlite.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?").run(secret, id);
  return secret;
}

async function loginStep(env, userId, code) {
  const guestToken = "g".repeat(44);
  env.__sqlite.prepare(
    "INSERT OR IGNORE INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)",
  ).run(sha256(guestToken), "guestcsrf", now(), now() + 3600);
  const challenge = await issueTotpChallenge(env.FORUM_DB, userId);
  return post(env, "/api/auth/totp", { cookie: "__Host-wempo_session=" + guestToken, csrf: "guestcsrf" },
    { challenge, code });
}

test("default enrollment stays SHA-1: URI, confirm and stored algorithm", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const setup = await enroll(env, alice);
  assert.match(setup.otpauth, /&algorithm=SHA1&/);
  const res = await post(env, "/api/me/totp/confirm", alice.session, { code: await totpAt(setup.secret, now(), 6) });
  assert.equal(res.status, 200);
  assert.equal(enabled(env, alice.id), 1);
  assert.equal(algorithmRow(env, alice.id)?.algorithm ?? "SHA1", "SHA1");
});

test("SHA-256 enrollment: URI says SHA256; a SHA-1 code fails setup safely, a SHA-256 code completes it", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const setup = await enroll(env, alice, "SHA256");
  assert.match(setup.otpauth, /&algorithm=SHA256&/);
  const at = now();
  const sha1Code = await totpAt(setup.secret, at, 6);
  const sha256Code = await totpAt(setup.secret, at, 6, "SHA256");
  if (sha1Code !== sha256Code) {
    const wrong = await post(env, "/api/me/totp/confirm", alice.session, { code: sha1Code });
    assert.equal(wrong.status, 401);
    assert.equal(enabled(env, alice.id), 0, "a wrong-app code never turns 2FA on");
  }
  const ok = await post(env, "/api/me/totp/confirm", alice.session, { code: sha256Code });
  assert.equal(ok.status, 200);
  assert.equal(enabled(env, alice.id), 1);
  assert.equal(algorithmRow(env, alice.id).algorithm, "SHA256");
});

test("re-running setup with the default after a SHA-256 draft goes back to SHA-1", async () => {
  const env = makeEnv();
  const alice = await member(env);
  await enroll(env, alice, "SHA256");
  const setup = await enroll(env, alice);
  assert.match(setup.otpauth, /&algorithm=SHA1&/);
  const ok = await post(env, "/api/me/totp/confirm", alice.session, { code: await totpAt(setup.secret, now(), 6) });
  assert.equal(ok.status, 200);
  assert.equal(algorithmRow(env, alice.id)?.algorithm ?? "SHA1", "SHA1");
});

test("existing member without an algorithm row signs in with SHA-1 exactly as before", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const secret = seedLegacyEnrollment(env, alice.id);
  assert.equal(algorithmRow(env, alice.id), undefined);
  const at = now();
  const sha256Code = await totpAt(secret, at, 6, "SHA256");
  const sha1Code = await totpAt(secret, at, 6);
  if (sha1Code !== sha256Code) {
    assert.equal((await loginStep(env, alice.id, sha256Code)).status, 401);
  }
  assert.equal((await loginStep(env, alice.id, sha1Code)).status, 200);
});

test("SHA-256 member: login rejects a SHA-1 code and accepts a SHA-256 code", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const setup = await enroll(env, alice, "SHA256");
  await post(env, "/api/me/totp/confirm", alice.session, { code: await totpAt(setup.secret, now(), 6, "SHA256") });
  const at = now();
  const sha1Code = await totpAt(setup.secret, at, 6);
  const sha256Code = await totpAt(setup.secret, at, 6, "SHA256");
  if (sha1Code !== sha256Code) {
    assert.equal((await loginStep(env, alice.id, sha1Code)).status, 401);
  }
  assert.equal((await loginStep(env, alice.id, sha256Code)).status, 200);
});

test("disable verifies with the stored algorithm and removes the algorithm row", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const setup = await enroll(env, alice, "SHA256");
  await post(env, "/api/me/totp/confirm", alice.session, { code: await totpAt(setup.secret, now(), 6, "SHA256") });
  const at = now();
  const sha1Code = await totpAt(setup.secret, at, 6);
  const sha256Code = await totpAt(setup.secret, at, 6, "SHA256");
  if (sha1Code !== sha256Code) {
    assert.equal((await post(env, "/api/me/totp/disable", alice.session, { code: sha1Code })).status, 401);
  }
  const res = await post(env, "/api/me/totp/disable", alice.session, { code: sha256Code });
  assert.equal(res.status, 200);
  assert.equal(enabled(env, alice.id), 0);
  assert.equal(algorithmRow(env, alice.id), undefined);
});

test("legacy member disables with a SHA-1 code", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const secret = seedLegacyEnrollment(env, alice.id);
  const res = await post(env, "/api/me/totp/disable", alice.session, { code: await totpAt(secret, now(), 6) });
  assert.equal(res.status, 200);
  assert.equal(enabled(env, alice.id), 0);
});

test("setup cannot change the algorithm of a member whose 2FA is already on", async () => {
  const env = makeEnv();
  const alice = await member(env);
  seedLegacyEnrollment(env, alice.id);
  const res = await post(env, "/api/me/totp/setup", alice.session, { currentPassword: PASSWORD, algorithm: "SHA256" });
  assert.equal(res.status, 409);
  assert.equal(algorithmRow(env, alice.id), undefined);
});

test("the algorithm row is wiped with the account: users FK with ON DELETE CASCADE", () => {
  const env = makeEnv();
  const fks = env.__sqlite.prepare("PRAGMA foreign_key_list(totp_algorithms)").all();
  assert.equal(fks.length, 1);
  assert.equal(fks[0].table, "users");
  assert.equal(fks[0].from, "user_id");
  assert.equal(fks[0].on_delete, "CASCADE");
});

test("account deletion through /api/me/delete takes the algorithm row with it", {
  todo: "BUG (pre-existing, not 5.20): migrations/0043_fleet_boosts.sql:21 REFERENCES gc_messages, " +
    "a table the forum schema lacks, so every users DELETE fails with 'no such table: main.gc_messages'",
}, async () => {
  const env = makeEnv();
  const alice = await member(env);
  const setup = await enroll(env, alice, "SHA256");
  await post(env, "/api/me/totp/confirm", alice.session, { code: await totpAt(setup.secret, now(), 6, "SHA256") });
  assert.equal(algorithmRow(env, alice.id).algorithm, "SHA256");
  const res = await post(env, "/api/me/delete", alice.session, {});
  assert.equal(res.status, 200);
  assert.equal(algorithmRow(env, alice.id), undefined);
});

test("data export names the algorithm, never the secret", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const setup = await enroll(env, alice, "SHA256");
  await post(env, "/api/me/totp/confirm", alice.session, { code: await totpAt(setup.secret, now(), 6, "SHA256") });
  const text = await (await call(env, "/api/me/export", { session: alice.session })).text();
  const data = JSON.parse(text);
  assert.equal(data.settings.twoFactorAlgorithm, "SHA256");
  assert.ok(!text.includes(setup.secret));
  const bob = await member(env, "bob");
  const bobData = await (await call(env, "/api/me/export", { session: bob.session })).json();
  assert.equal(bobData.settings.twoFactorAlgorithm, null);
});

// ---- migration + client -------------------------------------------------------

test("migration 0061 is CREATE-only with the SHA1/SHA256 check", () => {
  const sql = readFileSync(new URL("migrations/0061_totp_algorithm.sql", ROOT), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS totp_algorithms/);
  assert.match(sql, /ON DELETE CASCADE/);
  assert.match(sql, /CHECK \(algorithm IN \('SHA1', ?'SHA256'\)\)/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(ALTER|DROP|UPDATE)\b/i);
});

test("setup UI: opt-in SHA-256 checkbox, unchecked by default, sends the algorithm", () => {
  const source = readFileSync(new URL("public/js/routes/twofa.js", ROOT), "utf8");
  assert.match(source, /createCheckbox\(document, \{[^}]*name: "sha256"/s);
  assert.doesNotMatch(source, /name: "sha256"[^}]*checked: true/s);
  assert.match(source, /text\("sha256"\) === "on" \? "SHA256" : "SHA1"/);
});

test("the new strings exist in every locale and keep the app names verbatim", () => {
  const dir = new URL("public/locales/", ROOT);
  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  assert.ok(files.length >= 41);
  for (const file of files) {
    const strings = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    assert.ok(strings["twofa.useSha256"], file + " twofa.useSha256");
    const help = strings["twofa.useSha256Help"];
    assert.ok(help, file + " twofa.useSha256Help");
    for (const app of ["Aegis", "2FAS", "1Password", "Bitwarden", "Google Authenticator"]) {
      assert.ok(help.includes(app), file + " keeps " + app);
    }
  }
});
