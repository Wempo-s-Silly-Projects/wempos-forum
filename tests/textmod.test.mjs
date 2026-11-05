// Text auto-mod (v3.1, OpenAI Moderation engine): the pure decision
// surfaces — enable gates, moderation parsing, the flagged trip — plus the
// full background check against a recording fake db and fetch stub, and the
// OCR extracted-text evaluator. The admin ROUTES stay covered by the owner's
// local smoke pass (they need the full request/session harness).
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateExtractedText,
  fetchModerationVerdict,
  isTextModConfigured,
  isTextModEnabled,
  isTextModKilled,
  runTextCheck,
  scheduleTextCheck,
  tripsTextAutoMod,
} from "../api/textmod.mjs";

// A recording db: prepare().bind() captures (sql, params); first() answers
// from a per-SQL-substring table; batch() returns the always-changes shape.
// (Mirrors tests/vision.test.mjs's fakeDb.)
function fakeDb(sqlAnswers = {}) {
  const statements = [];
  const answer = (sql) => {
    for (const [needle, value] of Object.entries(sqlAnswers)) {
      if (sql.includes(needle)) return typeof value === "function" ? value() : value;
    }
    return null;
  };
  const mk = (sql, params) => {
    statements.push({ sql, params });
    return {
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 1, last_row_id: statements.length } }),
    };
  };
  return {
    statements,
    prepare: (sql) => ({
      // Real D1 allows parameterless .first() without .bind(); the
      // kill-switch read uses exactly that shape.
      first: async () => answer(sql),
      all: async () => ({ results: [] }),
      bind: (...params) => mk(sql, params),
    }),
    batch: async (stmts) => stmts.map((_, index) => ({ meta: { changes: 1, last_row_id: index + 1 } })),
  };
}

// OpenAI moderation response shape: flagged + per-category booleans/scores.
const moderationResponse = (flagged, categories = {}) => {
  const all = {
    "harassment": false,
    "harassment/threatening": false,
    "hate": false,
    "hate/threatening": false,
    "self-harm": false,
    "self-harm/instructions": false,
    "self-harm/intent": false,
    "sexual": false,
    "sexual/minors": false,
    "violence": false,
    "violence/graphic": false,
    ...categories,
  };
  const scores = {};
  for (const [key, value] of Object.entries(all)) {
    scores[key] = value ? 0.99 : 0.01;
  }
  return { results: [{ flagged, categories: all, category_scores: scores }] };
};

test("enable gates: the API key configures; the desk kill switch disables", async () => {
  const db = fakeDb();
  assert.equal(isTextModConfigured({}), false);
  assert.equal(isTextModConfigured({ OPENAI_API_KEY: "k" }), true);
  assert.equal(await isTextModEnabled(db, { OPENAI_API_KEY: "k" }), true);
  const killed = fakeDb({ "FROM site_settings": { value: "1" } });
  assert.equal(await isTextModKilled(killed), true);
  assert.equal(await isTextModEnabled(killed, { OPENAI_API_KEY: "k" }), false);
});

test("fetchModerationVerdict: Bearer-authenticates, sends the model, parses the result", async () => {
  let seen;
  const verdict = await fetchModerationVerdict({ OPENAI_API_KEY: "test-key" }, "hello there", async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => moderationResponse(false) };
  });
  assert.equal(seen.init.headers.Authorization, "Bearer test-key");
  assert.ok(!seen.url.includes("test-key"), "the key must never ride the URL");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(seen.init.body).model, "omni-moderation-latest");
  assert.equal(JSON.parse(seen.init.body).input, "hello there");
  assert.equal(verdict.flagged, false);
  assert.deepEqual(verdict.categories, []);
  assert.equal(verdict.categoryScores["harassment"], 0.01);
});

test("fetchModerationVerdict: flagged categories survive with their scores", async () => {
  const verdict = await fetchModerationVerdict({ OPENAI_API_KEY: "k" }, "bad text", async () => ({
    ok: true,
    json: async () => moderationResponse(true, { harassment: true, "hate/threatening": true }),
  }));
  assert.equal(verdict.flagged, true);
  assert.deepEqual(verdict.categories.sort(), ["harassment", "hate/threatening"]);
  assert.equal(verdict.categoryScores["harassment"], 0.99);
});

test("fetchModerationVerdict: junk scores are dropped; a scoreless response errors", async () => {
  const junk = await fetchModerationVerdict({ OPENAI_API_KEY: "k" }, "x", async () => ({
    ok: true,
    json: async () => ({
      results: [{
        flagged: false,
        categories: { harassment: false },
        category_scores: { harassment: "high", violence: -3, sexual: 5 },
      }],
    }),
  }));
  // No real 0..1 number survived, so the whole call is an error (callers fail
  // open) — a partial verdict is never returned.
  assert.match(junk.error, /no scores/);
});

test("fetchModerationVerdict: non-200, transport failures, and missing results return errors", async () => {
  const http = await fetchModerationVerdict({ OPENAI_API_KEY: "k" }, "x", async () => ({ ok: false, status: 429 }));
  assert.match(http.error, /HTTP 429/);
  const boom = await fetchModerationVerdict({ OPENAI_API_KEY: "k" }, "x", async () => { throw new Error("network down"); });
  assert.match(boom.error, /Text auto-mod check failed/);
  const empty = await fetchModerationVerdict({ OPENAI_API_KEY: "k" }, "x", async () => ({ ok: true, json: async () => ({ results: [] }) }));
  assert.match(empty.error, /no result/);
});

test("tripsTextAutoMod follows OpenAI's calibrated flagged verdict", () => {
  assert.equal(tripsTextAutoMod({ flagged: true, categories: ["harassment"], categoryScores: {} }), true);
  assert.equal(tripsTextAutoMod({ flagged: false, categories: [], categoryScores: {} }), false);
  assert.equal(tripsTextAutoMod(null), false);
  // High scores alone do NOT trip — flagged is the verdict, scores are the
  // evidence on the desk.
  assert.equal(tripsTextAutoMod({ flagged: false, categories: [], categoryScores: { harassment: 0.5 } }), false);
});

test("runTextCheck: a flagged post HIDES (never deletes), records the action, notifies", async () => {
  const db = fakeDb();
  await runTextCheck({ FORUM_DB: db, OPENAI_API_KEY: "k" }, {
    kind: "post", entityId: 42, userId: 9, text: "awful things", postId: 7,
  }, async () => ({ ok: true, json: async () => moderationResponse(true, { harassment: true }) }));
  const hide = db.statements.find((s) => s.sql.includes("UPDATE posts SET visibility = 'hidden'"));
  assert.ok(hide, "the post must be hidden, not deleted");
  assert.equal(hide.params[0], 42);
  assert.equal(db.statements.filter((s) => s.sql.includes("DELETE FROM")).length, 0);
  const action = db.statements.find((s) => s.sql.includes("INSERT INTO moderation_actions"));
  assert.ok(action, "the auto-mod action row must be recorded");
  // Bind order: userId, entity_kind, entity_id, reason, verdicts, created_at
  // (kind='auto_text' is an in-SQL literal).
  assert.equal(action.params[0], 9);
  assert.equal(action.params[2], "42");
  assert.match(action.params[3], /OpenAI moderation: harassment/);
  const stored = JSON.parse(action.params[4]);
  assert.deepEqual(stored, { flagged: true, categories: { harassment: 0.99 } });
  const note = db.statements.find((s) => s.sql.includes("INSERT INTO notifications"));
  assert.equal(note.params[1], 7); // thread root id for the click-through
  assert.equal(note.params[2], 42); // the hidden reply's own id
});

test("runTextCheck: a flagged chat message DELETES (chat has no hidden state)", async () => {
  const db = fakeDb();
  await runTextCheck({ FORUM_DB: db, OPENAI_API_KEY: "k" }, {
    kind: "chat", entityId: 5, userId: 3, text: "awful things",
  }, async () => ({ ok: true, json: async () => moderationResponse(true, { "violence/graphic": true }) }));
  assert.ok(db.statements.some((s) => s.sql.includes("DELETE FROM chat_messages")));
  assert.ok(db.statements.some((s) => s.sql.includes("INSERT INTO moderation_actions")));
  assert.ok(db.statements.some((s) => s.sql.includes("INSERT INTO notifications")));
});

test("runTextCheck: an unflagged text takes no action at all", async () => {
  const db = fakeDb();
  await runTextCheck({ FORUM_DB: db, OPENAI_API_KEY: "k" }, {
    kind: "post", entityId: 1, userId: 1, text: "friendly post",
  }, async () => ({ ok: true, json: async () => moderationResponse(false) }));
  // Only the dedup read is recorded (the kill-switch read uses D1's
  // parameterless .first() shape, which records nothing).
  assert.equal(db.statements.length, 1);
  assert.ok(db.statements.every((s) => !s.sql.includes("INSERT")));
});

test("runTextCheck: one live action per entity — an existing auto_text action dedups", async () => {
  const db = fakeDb({ "AND reversed_at IS NULL": { existing: 1 } });
  await runTextCheck({ FORUM_DB: db, OPENAI_API_KEY: "k" }, {
    kind: "post", entityId: 42, userId: 9, text: "awful things", postId: 7,
  }, async () => ({ ok: true, json: async () => moderationResponse(true, { harassment: true }) }));
  assert.ok(db.statements.every((s) => !s.sql.includes("INSERT")), "no second action may stack");
});

test("runTextCheck: the desk kill switch stops the check before the fetch", async () => {
  const db = fakeDb({ "FROM site_settings": { value: "1" } });
  let fetched = 0;
  await runTextCheck({ FORUM_DB: db, OPENAI_API_KEY: "k" }, {
    kind: "post", entityId: 1, userId: 1, text: "awful things",
  }, async () => { fetched += 1; return { ok: true, json: async () => moderationResponse(true) }; });
  assert.equal(fetched, 0);
  assert.ok(db.statements.every((s) => !s.sql.includes("INSERT")), "nothing may be recorded or removed");
});

test("runTextCheck: a classifier error fails open — content untouched, no row", async () => {
  const db = fakeDb();
  await runTextCheck({ FORUM_DB: db, OPENAI_API_KEY: "k" }, {
    kind: "post", entityId: 1, userId: 1, text: "some text",
  }, async () => ({ ok: false, status: 500 }));
  assert.ok(db.statements.every((s) => !s.sql.includes("INSERT")), "no action, no removal, no verdict row");
});

test("scheduleTextCheck: no-op when unconfigured, rides ctx.waitUntil when configured", async () => {
  const calls = [];
  const ctx = { waitUntil: (task) => calls.push(task) };
  scheduleTextCheck(ctx, {}, { kind: "post", entityId: 1, userId: 1, text: "hi" });
  assert.equal(calls.length, 0);
  scheduleTextCheck(ctx, { OPENAI_API_KEY: "k" }, { kind: "post", entityId: 1, userId: 1, text: "" });
  assert.equal(calls.length, 0);
  scheduleTextCheck(ctx, { OPENAI_API_KEY: "k" }, { kind: "post", entityId: 1, userId: 1, text: "hi" });
  assert.equal(calls.length, 1);
  // No ctx (tests, non-Worker callers): the promise still runs best-effort.
  // A kill-switched db keeps it hermetic — the task exits before any fetch.
  let ran = false;
  scheduleTextCheck(null, {
    OPENAI_API_KEY: "k",
    FORUM_DB: fakeDb({ "FROM site_settings": { value: "1" } }),
  }, {
    kind: "post", entityId: 1, userId: 1, text: "hi",
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  ran = true;
  assert.ok(ran);
});

test("evaluateExtractedText: a filtered word embedded in the image trips WITHOUT the moderation key", async () => {
  const verdict = await evaluateExtractedText({ FILTERED_WORDS: "badword" }, "innocent backdrop with badword in pixels");
  assert.deepEqual(verdict, {
    tripped: true,
    reason: "Auto-mod removed this image (filtered word embedded in the image text).",
  });
});

test("evaluateExtractedText: a flagged text trip needs the moderation key and reports the categories", async () => {
  let seen;
  const verdict = await evaluateExtractedText(
    { OPENAI_API_KEY: "k", FORUM_DB: fakeDb() },
    "awful things in pixels",
    async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => moderationResponse(true, { hate: true }) };
    },
  );
  assert.equal(verdict.tripped, true);
  assert.match(verdict.reason, /OpenAI moderation on embedded text: hate 0\.99/);
  assert.equal(seen.init.headers.Authorization, "Bearer k");
});

test("evaluateExtractedText: empty text, no key, kill switch, and errors never trip", async () => {
  assert.deepEqual(await evaluateExtractedText({ OPENAI_API_KEY: "k", FORUM_DB: fakeDb() }, "   "), { tripped: false });
  const noKey = await evaluateExtractedText({ FORUM_DB: fakeDb() }, "perfectly fine words only");
  assert.equal(noKey.tripped, false);
  const killed = await evaluateExtractedText({
    OPENAI_API_KEY: "k",
    FORUM_DB: fakeDb({ "FROM site_settings": { value: "1" } }),
  }, "awful things");
  assert.equal(killed.tripped, false);
  const error = await evaluateExtractedText({ OPENAI_API_KEY: "k", FORUM_DB: fakeDb() }, "words", async () => ({ ok: false, status: 503 }));
  assert.equal(error.tripped, false);
  const unflagged = await evaluateExtractedText({ OPENAI_API_KEY: "k", FORUM_DB: fakeDb() }, "friendly words", async () => ({
    ok: true, json: async () => moderationResponse(false),
  }));
  assert.equal(unflagged.tripped, false);
});
