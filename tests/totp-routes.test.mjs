// TOTP route layer (v4.0.1 review follow-up): the behavior pins the core
// tests can't reach — setup/confirm/disable state gating, the login step's
// claim-once consume (replay 401 with no session minted), wrong codes never
// changing state, and challenge hashes stored without the plaintext.
// Runs through handleTotpRoutes with a recording fake db; the RFC-pinned
// primitives (core) are already covered by tests/totp-core.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { issueTotpChallenge, handleTotpRoutes } from "../api/twofa.mjs";
import { totpAt } from "../api/core/totp.mjs";
import { sha256Hex } from "../api/core/crypto.mjs";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // the RFC 6238 seed
const SESSION_TOKEN = "A".repeat(44);
const CSRF_TOKEN = "c".repeat(24);

// Recording fake db (mirrors tests/textmod.test.mjs, plus per-needle run()
// changes counts so the guarded consume/promotion updates can fail like the
// real D1 would when a concurrent request won the row).
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

function totpEnv(db) {
  return {
    FORUM_DB: db,
    PASSWORD_PEPPER: "test-pepper",
    TOTP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

function envWithDb(answers = {}, runChanges = {}) {
  const db = fakeDb(answers, runChanges);
  return { db, env: totpEnv(db) };
}

function loginStepRequest(code, challenge = "ch".repeat(20)) {
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

// Session-shaped answers every member-endpoint test needs: requireCsrf's
// session row lookup and the network-ban sweep both answer before any totp
// table is touched.
const MEMBER_ANSWERS = {
  "FROM sessions s LEFT JOIN users": {
    token_hash: "h", user_id: 2, csrf_token: CSRF_TOKEN, expires_at: 9999999999,
    username: "tester", role: "member", bio: "", avatar_status: null,
    avatar_mime: null, avatar_updated_at: null, avatar_version: null, totp_enabled: 0,
  },
  "banned_ips": null,
};

test("issueTotpChallenge stores ONLY the sha-256 hash, never the plaintext", async () => {
  const { env } = envWithDb(MEMBER_ANSWERS);
  const challenge = await issueTotpChallenge(env.FORUM_DB, 2);
  const insert = env.FORUM_DB.statements.find((s) => s.sql.includes("INSERT INTO totp_challenges"));
  assert.ok(insert, "the challenge insert ran");
  const [tokenHash] = insert.params;
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(tokenHash, challenge);
  assert.ok(!env.FORUM_DB.statements.some((s) => s.params.includes(challenge)));
});

test("setup stages a fresh secret (update carries it) and 409s when already on", async () => {
  const { env } = envWithDb({
    ...MEMBER_ANSWERS,
    "SELECT totp_enabled, totp_secret FROM users": { totp_enabled: 0, totp_secret: null },
  });
  const base = "https://forum.test/api/me/totp/setup";
  const request = (path) => new Request(path, {
    method: "POST",
    headers: {
      "Origin": "https://forum.test",
      "X-CSRF-Token": CSRF_TOKEN,
      "Cookie": "wempo_session=" + SESSION_TOKEN,
    },
  });
  const response = await handleTotpRoutes(request(base), env, new URL(base), "/api/me/totp/setup", "POST");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.secret, /^[A-Z2-7]{32}$/);
  assert.match(body.otpauth, /^otpauth:\/\/totp\//);
  const update = env.FORUM_DB.statements.find((s) => s.sql.includes("SET totp_pending_secret"));
  assert.equal(update.params[0], body.secret);
  assert.equal(update.params[1], 2);

  const alreadyOn = envWithDb({
    ...MEMBER_ANSWERS,
    "SELECT totp_enabled, totp_secret FROM users": { totp_enabled: 1, totp_secret: SECRET },
  });
  await assert.rejects(
    () => handleTotpRoutes(request(base), alreadyOn.env, new URL(base), "/api/me/totp/setup", "POST"),
    { status: 409 },
  );
});

test("confirm with a wrong code 401s and never issues the guarded promotion", async () => {
  const { db, env } = envWithDb({
    ...MEMBER_ANSWERS,
    "totp_pending_secret IS NOT NULL LIMIT 1": { totp_pending_secret: SECRET },
  });
  await assert.rejects(
    () => handleTotpRoutes(
      loginStepRequest("000000"), env, new URL("https://forum.test/api/me/totp/confirm"),
      "/api/me/totp/confirm", "POST",
    ),
    { status: 401, message: "That code is not correct. Nothing has been changed." },
  );
  // The wrong-code attempt still reads the staged secret but never promotes.
  assert.ok(!db.statements.some((s) => s.sql.includes("totp_pending_secret, totp_enabled = 1")));
});

test("confirm with a correct code promotes; a lost race (changes 0) 409s", async () => {
  const now = Math.floor(Date.now() / 1000);
  // Valid within the ±1-step window even if the clock rolls a step mid-test.
  const attempt = async (env) => {
    for (const drift of [0, 30, -30]) {
      const candidate = await totpAt(SECRET, now + drift);
      try {
        return await handleTotpRoutes(
          loginStepRequest(candidate), env,
          new URL("https://forum.test/api/me/totp/confirm"), "/api/me/totp/confirm", "POST",
        );
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }
    throw new Error("no step of the window verified");
  };

  const good = envWithDb({
    ...MEMBER_ANSWERS,
    "totp_pending_secret IS NOT NULL LIMIT 1": () => ({ totp_pending_secret: SECRET }),
  });
  const response = await attempt(good.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { totpEnabled: true });
  assert.ok(good.db.statements.some((s) => s.sql.includes("totp_enabled = 0 AND totp_pending_secret IS NOT NULL")));

  // The stale tab also verified its code, but its guarded promotion matches
  // zero rows — 409 with nothing re-written.
  const raced = envWithDb({
    ...MEMBER_ANSWERS,
    "totp_pending_secret IS NOT NULL LIMIT 1": () => ({ totp_pending_secret: SECRET }),
  }, { "totp_enabled = 0 AND totp_pending_secret IS NOT NULL": 0 });
  await assert.rejects(
    () => attempt(raced.env),
    { status: 409, message: "Two-factor setup has already completed in another tab." },
  );
});

test("disable demands the live secret: wrong code 401s, right code clears both columns", async () => {
  const now = Math.floor(Date.now() / 1000);
  const build = () => envWithDb({
    ...MEMBER_ANSWERS,
    "totp_enabled = 1 AND totp_secret IS NOT NULL LIMIT 1": { totp_secret: SECRET },
  });
  const wrong = build();
  await assert.rejects(
    () => handleTotpRoutes(
      loginStepRequest("000000"), wrong.env,
      new URL("https://forum.test/api/me/totp/disable"), "/api/me/totp/disable", "POST",
    ),
    { status: 401, message: "That code is not correct. Nothing has been changed." },
  );
  assert.ok(!wrong.db.statements.some((s) => s.sql.includes("SET totp_secret = NULL")));

  const right = build();
  const code = await totpAt(SECRET, now);
  const response = await handleTotpRoutes(
    loginStepRequest(code), right.env,
    new URL("https://forum.test/api/me/totp/disable"), "/api/me/totp/disable", "POST",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { totpEnabled: false });
  const update = right.db.statements.find((s) => s.sql.includes("SET totp_secret = NULL"));
  assert.equal(update.params[0], 2);
});

test("login step: a matching code consumes the challenge ONCE and mints the session", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = "ch".repeat(20);
  const tokenHash = await sha256Hex(token);
  const code = await totpAt(SECRET, now);
  const build = (consumeChanges = 1) => envWithDb({
    ...MEMBER_ANSWERS,
    "totp_challenges WHERE expires_at <=": { changes: 1 },
    "FROM totp_challenges WHERE token_hash": { user_id: 2 },
    "SELECT username_key, totp_enabled, totp_secret FROM users": {
      username_key: "tester", totp_enabled: 1, totp_secret: SECRET,
    },
    "FROM users WHERE username_key": USER_ROW,
  }, {
    "DELETE FROM totp_challenges WHERE token_hash": consumeChanges,
  });
  const good = build();
  const request = loginStepRequest(code, token);
  const response = await handleTotpRoutes(
    request, good.env, new URL("https://forum.test/api/auth/totp"), "/api/auth/totp", "POST",
  );
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("Set-Cookie");
  assert.match(setCookie, /^wempo_session=/);
  const body = await response.json();
  assert.equal(body.user.username, "tester");
  // The consume was the LAST write: verifyTotpCode ran before it (wrong-code
  // test pins that), and the session insert rode the batch.
  const consume = good.db.statements.find((s) => s.sql.includes("DELETE FROM totp_challenges WHERE token_hash"));
  assert.equal(consume.params[0], tokenHash, "the consume keys on the challenge's hash");
  assert.ok(good.db.statements.some((s) => s.sql.includes("INSERT INTO sessions")));

  // Replay the same challenge: the consume matches zero rows → 401, and no
  // second session insert can run (the handler exits before createSession).
  const replay = build(0);
  await assert.rejects(
    () => handleTotpRoutes(
      loginStepRequest(code, token), replay.env,
      new URL("https://forum.test/api/auth/totp"), "/api/auth/totp", "POST",
    ),
    { status: 401 },
  );
});

test("login step: a wrong code 401s WITHOUT consuming the challenge", async () => {
  const { db, env } = envWithDb({
    ...MEMBER_ANSWERS,
    "FROM totp_challenges WHERE token_hash": { user_id: 2 },
    "SELECT username_key, totp_enabled, totp_secret FROM users": {
      username_key: "tester", totp_enabled: 1, totp_secret: SECRET,
    },
    "FROM users WHERE username_key": USER_ROW,
  });
  await assert.rejects(
    () => handleTotpRoutes(
      loginStepRequest("000000"), env,
      new URL("https://forum.test/api/auth/totp"), "/api/auth/totp", "POST",
    ),
    { status: 401, message: "That code is not correct." },
  );
  assert.ok(!db.statements.some(
    (s) => s.sql.includes("DELETE FROM totp_challenges WHERE token_hash = ? AND expires_at > ?"),
  ));
  assert.ok(!db.statements.some((s) => s.sql.includes("INSERT INTO sessions")));
});

test("login step: an unknown or expired challenge 401s before any totp work", async () => {
  const { db, env } = envWithDb(MEMBER_ANSWERS);
  await assert.rejects(
    () => handleTotpRoutes(
      loginStepRequest("000000"), env,
      new URL("https://forum.test/api/auth/totp"), "/api/auth/totp", "POST",
    ),
    { status: 401, message: "This verification request has expired. Sign in again." },
  );
  assert.ok(!db.statements.some((s) => s.sql.includes("DELETE FROM totp_challenges WHERE token_hash = ? AND expires_at > ?")));
});
