// Copyright 2026 YourLocalGoober
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

// Backup-codes route layer (v4.8.1): generation (replace-in-one-batch,
// raw codes in the response exactly once), the login step's code-or-backup
// burn, disable wiping the set with the disable, the limiter riding both
// paths, and the migration's shape. Shares the recording fake db the totp
// route tests use; no live secrets, per the repo's family-friendly rule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleTotpRoutes } from "../api/twofa.mjs";
import { totpAt } from "../api/core/totp.mjs";
import { sha256Hex } from "../api/core/crypto.mjs";
import { hashPassword } from "../api/core/passwords.mjs";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // the RFC 6238 seed
const SESSION_TOKEN = "A".repeat(44);
const CSRF_TOKEN = "c".repeat(24);
const PASSWORD = "correct horse battery staple";
const PEPPER = "0123456789abcdef0123456789abcdef";

// Recording fake db (mirrors tests/totp-routes.test.mjs): statements are
// recorded at bind time, so statements built for db.batch are recorded too.
function fakeDb(sqlAnswers = {}, runChanges = {}) {
  const statements = [];
  const answer = (sql) => {
    for (const [needle, value] of Object.entries(sqlAnswers)) {
      if (sql.includes(needle)) return typeof value === "function" ? value() : value;
    }
    return null;
  };
  const changes = (sql) => {
    for (const [needle, value] of Object.entries(runChanges)) {
      if (sql.includes(needle)) return value;
    }
    return 1;
  };
  const mk = (sql, params) => {
    statements.push({ sql, params });
    return {
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: changes(sql), last_row_id: statements.length } }),
    };
  };
  return {
    statements,
    prepare: (sql) => ({
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      bind: (...params) => mk(sql, params),
    }),
    batch: async (stmts) => stmts.map((_, index) => ({ meta: { changes: 1, last_row_id: index + 1 } })),
  };
}

const USER_ROW = {
  id: 2, username: "tester", username_key: "tester", role: "member", bio: "",
  flair: null, profile_accent: null, banner_color: null, banner_text: null,
  pending_css: null, approved_css: null,
  avatar_status: null, avatar_mime: null, avatar_updated_at: null, avatar_version: null,
};

const MEMBER_ANSWERS = {
  "FROM sessions s LEFT JOIN users": {
    token_hash: "h", user_id: 2, csrf_token: CSRF_TOKEN, expires_at: 9999999999,
    username: "tester", role: "member", bio: "", avatar_status: null,
    avatar_mime: null, avatar_updated_at: null, avatar_version: null, totp_enabled: 0,
  },
  "banned_ips": null,
};

const ACCOUNT_ANSWERS = {
  ...MEMBER_ANSWERS,
  "totp_enabled = 1 AND totp_secret IS NOT NULL": { totp_secret: SECRET },
  "FORUM_DB_PLACEHOLDER_NEVER": null,
};

function recordingLimiter() {
  const limiter = {
    calls: [],
    async limit({ key }) {
      limiter.calls.push(key);
      return { success: true };
    },
  };
  return limiter;
}

function totpEnv(db) {
  const limiter = recordingLimiter();
  return {
    limiter,
    env: { FORUM_DB: db, PASSWORD_PEPPER: PEPPER, TOTP_RATE_LIMITER: limiter },
  };
}

let cachedPasswordHash = null;
async function realPasswordHash() {
  if (!cachedPasswordHash) cachedPasswordHash = await hashPassword(PASSWORD, PEPPER);
  return cachedPasswordHash;
}

// The generate-route answers: the signed-in member's own row with a REAL
// password hash (same Web Crypto path as the route; the comparison is exact).
async function envWithRow(totpEnabled, runChanges = {}) {
  const passwordHash = await realPasswordHash();
  const db = fakeDb({
    ...MEMBER_ANSWERS,
    "SELECT totp_enabled, totp_secret": {
      totp_enabled: totpEnabled, totp_secret: totpEnabled === 1 ? SECRET : null,
      password_salt: passwordHash.salt, password_hash: passwordHash.hash,
    },
    "SELECT totp_secret FROM users WHERE id = ?": { totp_secret: SECRET },
  }, runChanges);
  return { db, ...totpEnv(db) };
}

// The login-step answers: a live 2FA row plus the burn's changes count.
function envWithLoginChanges(burnChanges) {
  const db = fakeDb({
    ...MEMBER_ANSWERS,
    "totp_challenges WHERE expires_at <=": { changes: 1 },
    "FROM totp_challenges WHERE token_hash": { user_id: 2 },
    "SELECT username_key, totp_enabled, totp_secret FROM users": {
      username_key: "tester", totp_enabled: 1, totp_secret: SECRET,
    },
    "FROM users WHERE username_key": USER_ROW,
  }, {
    "DELETE FROM totp_backup_codes WHERE user_id = ? AND code_hash = ?": burnChanges,
  });
  return { db, ...totpEnv(db) };
}

function totpStepRequest(code, challenge = "ch".repeat(20)) {
  return new Request("https://forum.test/api/auth/totp", {
    method: "POST",
    body: JSON.stringify({ challenge, code }),
    headers: {
      "content-type": "application/json",
      "Origin": "https://forum.test",
      "X-CSRF-Token": CSRF_TOKEN,
      "Cookie": "wempo_session=" + SESSION_TOKEN,
    },
  });
}

function memberRequest(path, body) {
  return new Request("https://forum.test" + path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "Origin": "https://forum.test",
      "X-CSRF-Token": CSRF_TOKEN,
      "Cookie": "wempo_session=" + SESSION_TOKEN,
    },
  });
}

function call(path) {
  return async (request, env) =>
    handleTotpRoutes(request, env, new URL("https://forum.test" + path), path, "POST");
}

// --- migration shape ------------------------------------------------------------

const MIGRATION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
  "0042_totp_backup_codes.sql",
);

test("migration 0042 pins the backup-code table's shape", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 1);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS totp_backup_codes\s*\(/);
  assert.match(sql, /user_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /code_hash TEXT NOT NULL/);
  assert.match(sql, /created_at INTEGER NOT NULL/);
  assert.match(sql, /used_at INTEGER/);
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_totp_backup_codes_user ON totp_backup_codes\(user_id\)/,
  );
  // The table is created (never re-shaped): no ALTER, no DROP anywhere.
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /\bALTER\b|\bDROP\b/i);
});

// --- generation -------------------------------------------------------------------

const generate = call("/api/me/totp/backups/generate");
const GENERATE_URL = new URL("https://forum.test/api/me/totp/backups/generate");

test("generate: replaces the set in one batch and shows the raw codes exactly once", async () => {
  const { db, env } = await envWithRow(1);
  const response = await generate(
    memberRequest("/api/me/totp/backups/generate", {
      currentPassword: PASSWORD,
      code: "b".repeat(8),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.codes, "object");
  assert.equal(body.codes.length, 10);
  for (const code of body.codes) assert.match(code, /^[A-Za-z0-9_-]{8}$/);

  // Exactly one invalidating DELETE + the 10 inserts, keyed on this user,
  // hashes only. (The confirm's own statements precede the batch.)
  const batchSql = db.statements.filter((s) =>
    s.sql === "DELETE FROM totp_backup_codes WHERE user_id = ?" ||
    s.sql === "INSERT INTO totp_backup_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)");
  assert.equal(batchSql.length, 11);
  assert.equal(batchSql[0].sql.startsWith("DELETE"), true);
  batchSql[0].params.forEach((param) => assert.equal(param, 2));
  for (let index = 1; index < 11; index++) {
    assert.equal(batchSql[index].params[0], 2);
    assert.equal(batchSql[index].params[1], await sha256Hex(body.codes[index - 1]));
  }
  // A raw code rides ONLY the response — no statement bind ever carries one.
  const allBinds = db.statements.flatMap((s) => s.params.map(String));
  for (const code of body.codes) {
    assert.equal(allBinds.includes(code), false, "raw code must never be stored");
  }
});

test("generate: the old set is invalidated BEFORE any fresh insert", async () => {
  const { db, env } = await envWithRow(1);
  await generate(
    memberRequest("/api/me/totp/backups/generate", { currentPassword: PASSWORD, code: "b".repeat(8) }),
    env,
  );
  const deleteAt = db.statements.findIndex((s) => s.sql.startsWith("DELETE FROM totp_backup_codes"));
  const insertAt = db.statements.findIndex((s) => s.sql.startsWith("INSERT INTO totp_backup_codes"));
  assert.ok(deleteAt >= 0 && insertAt > deleteAt, "delete precedes the inserts");
});

test("generate: wrong password 401s and no batch is written", async () => {
  const { db, env } = await envWithRow(1);
  await assert.rejects(
    () => generate(
      memberRequest("/api/me/totp/backups/generate", {
        currentPassword: "not my password",
        code: "b".repeat(8),
      }),
      env,
    ),
    { status: 401, message: "Your current password is incorrect." },
  );
  assert.equal(db.statements.filter((s) => s.sql.includes("totp_backup_codes")).length, 0);
});

test("generate: with 2FA off the password alone suffices (no code gate)", async () => {
  const { db, env } = await envWithRow(0);
  const response = await generate(
    memberRequest("/api/me/totp/backups/generate", { currentPassword: PASSWORD }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).codes.length, 10);
  assert.equal(db.statements.filter((s) => s.sql.includes("totp_backup_codes")).length, 11);
});

test("generate: the 6-digit authenticator code confirms too", async () => {
  const { env } = await envWithRow(1);
  const now = Math.floor(Date.now() / 1000);
  let lastError = null;
  for (const drift of [0, 30, -30]) {
    try {
      const response = await generate(
        memberRequest("/api/me/totp/backups/generate", {
          currentPassword: PASSWORD,
          code: await totpAt(SECRET, now + drift),
        }),
        env,
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).codes.length, 10);
      return;
    } catch (error) {
      if (error.status !== 401) throw error;
      lastError = error;
    }
  }
  throw lastError;
});

test("generate: rides the totp limiter keyed per account", async () => {
  const { env, limiter } = await envWithRow(1);
  await generate(
    memberRequest("/api/me/totp/backups/generate", { currentPassword: PASSWORD, code: "b".repeat(8) }),
    env,
  );
  assert.equal(limiter.calls.length, 1);
  assert.equal(limiter.calls[0], await sha256Hex("totp:user:2"));
});

// --- disable with a backup code ----------------------------------------------------

test("disable: a backup code verifies and the disable wipes the set in one batch", async () => {
  const { db, env } = await envWithRow(1);
  const response = await handleTotpRoutes(
    memberRequest("/api/me/totp/disable", { code: "a".repeat(8) }),
    env,
    new URL("https://forum.test/api/me/totp/disable"),
    "/api/me/totp/disable",
    "POST",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { totpEnabled: false });
  // The burn happened (the verify's own statement), then the batch wipes
  // whatever remains beside the totp columns clearing.
  assert.ok(db.statements.some(
    (s) => s.sql.includes("DELETE FROM totp_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL"),
  ));
  const wipe = db.statements.filter((s) => s.sql === "DELETE FROM totp_backup_codes WHERE user_id = ?");
  assert.equal(wipe.length, 1);
  assert.deepEqual(wipe[0].params, [2]);
  const update = db.statements.find((s) => s.sql.includes("SET totp_secret = NULL"));
  assert.equal(update.params[0], 2, "the update sits beside the wipe in the same batch");
});

test("disable: an unburned backup code leaves everything unchanged", async () => {
  const { db, env } = await envWithRow(1, {
    "DELETE FROM totp_backup_codes WHERE user_id = ? AND code_hash = ?": 0,
  });
  await assert.rejects(
    () => handleTotpRoutes(
      memberRequest("/api/me/totp/disable", { code: "x".repeat(8) }),
      env,
      new URL("https://forum.test/api/me/totp/disable"),
      "/api/me/totp/disable",
      "POST",
    ),
    { status: 401, message: "That code is not correct. Nothing has been changed." },
  );
  assert.ok(!db.statements.some((s) => s.sql.includes("SET totp_secret = NULL")));
});

// --- login step: code or backup code ------------------------------------------------

test("login step: a valid backup code burns once and mints the session", async () => {
  const raw = "k".repeat(8);
  const { db, env } = envWithLoginChanges(1);
  const response = await handleTotpRoutes(
    totpStepRequest(raw), env,
    new URL("https://forum.test/api/auth/totp"), "/api/auth/totp", "POST",
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Set-Cookie"), /^wempo_session=/);
  const burn = db.statements.find((s) =>
    s.sql.includes("DELETE FROM totp_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL"));
  assert.deepEqual(burn.params, [2, await sha256Hex(raw)], "the burn keys on the hash, never the raw code");
  assert.ok(db.statements.some((s) => s.sql.includes("INSERT INTO sessions")));
});

test("login step: a reused backup code fails (changes 0) with no session minted", async () => {
  const raw = "k".repeat(8);
  const { db, env } = envWithLoginChanges(0);
  await assert.rejects(
    () => handleTotpRoutes(
      totpStepRequest(raw), env,
      new URL("https://forum.test/api/auth/totp"), "/api/auth/totp", "POST",
    ),
    { status: 401, message: "That code is not correct." },
  );
  assert.ok(!db.statements.some((s) => s.sql.includes("INSERT INTO sessions")));
});

test("login step: a wrong 6-digit code and a wrong backup code answer IDENTICALLY (no leak)", async () => {
  const messages = [];
  for (const wrongCode of ["000000", "z".repeat(8)]) {
    const { env } = envWithLoginChanges(0);
    await assert.rejects(
      () => handleTotpRoutes(
        totpStepRequest(wrongCode), env,
        new URL("https://forum.test/api/auth/totp"), "/api/auth/totp", "POST",
      ),
      (error) => ((messages.push(error.message + " " + error.status)), error.status === 401),
    );
  }
  // Same status, same copy — neither answer tells the caller which family a
  // real code would have belonged to.
  assert.equal(messages[0], messages[1]);
  assert.equal(messages[0], "That code is not correct. 401");
});

test("login step: the limiter still rides a backup-code attempt (per-IP then per-user)", async () => {
  const { limiter, env } = envWithLoginChanges(0);
  await assert.rejects(
    () => handleTotpRoutes(
      totpStepRequest("k".repeat(8)), env,
      new URL("https://forum.test/api/auth/totp"), "/api/auth/totp", "POST",
    ),
    { status: 401 },
  );
  assert.deepEqual(limiter.calls, [
    await sha256Hex("totp:unknown"),
    await sha256Hex("totp:user:2"),
  ], "both limiter passes fire before the backup burn");
});

void ACCOUNT_ANSWERS;
