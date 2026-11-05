// Vision middleman + auto-mod (v3.1): the pure decision surfaces — enable
// gates, SafeSearch parsing, auto-mod thresholds, base64 — plus the full
// background check against a recording fake db and fetch stub. The appeal
// ROUTES stay covered by the owner's local smoke pass (they need the full
// request/session harness).
import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_MOD_THRESHOLDS,
  base64Bytes,
  fetchVisionVerdict,
  isVisionConfigured,
  isVisionEnabled,
  isVisionKilled,
  likelihoodScore,
  parseSafeSearch,
  parseEmbeddedText,
  runReportVisionRecheck,
  runVisionCheck,
  scheduleReportVisionRecheck,
  scheduleVisionCheck,
  tripsAutoMod,
} from "../api/vision.mjs";
import { publicRole, ROLE_ADMIN_DB, ROLE_OWNER_DB } from "../api/shared.mjs";

// A recording db: prepare().bind() captures (sql, params); first() answers
// from a per-SQL-substring table; batch() returns the always-changes shape.
// allAnswers answers .all() selects the same substring way (for the report
// re-check's target and byte queries).
function fakeDb(sqlAnswers = {}, allAnswers = {}) {
  const statements = [];
  const answer = (sql) => {
    for (const [needle, value] of Object.entries(sqlAnswers)) {
      if (sql.includes(needle)) return typeof value === "function" ? value() : value;
    }
    return null;
  };
  const answerAll = (sql) => {
    for (const [needle, value] of Object.entries(allAnswers)) {
      if (sql.includes(needle)) return typeof value === "function" ? value() : value;
    }
    return { results: [] };
  };
  const mk = (sql, params) => {
    statements.push({ sql, params });
    return {
      first: async () => answer(sql),
      all: async () => answerAll(sql),
      run: async () => ({ meta: { changes: 1, last_row_id: statements.length } }),
    };
  };
  return {
    statements,
    prepare: (sql) => ({
      // Real D1 allows parameterless .first()/.all() without .bind(); the
      // kill-switch read uses exactly that shape.
      first: async () => answer(sql),
      all: async () => answerAll(sql),
      bind: (...params) => mk(sql, params),
    }),
    batch: async (stmts) => stmts.map((_, index) => ({ meta: { changes: 1, last_row_id: index + 1 } })),
  };
}

const visionResponse = (annotation, ocrText) => ({
  responses: [{
    safeSearchAnnotation: annotation,
    ...(ocrText !== undefined ? { fullTextAnnotation: { text: ocrText } } : {}),
  }],
});
const SAFE = { adult: "VERY_UNLIKELY", medical: "VERY_UNLIKELY", spoof: "VERY_UNLIKELY", violence: "VERY_UNLIKELY", racy: "VERY_UNLIKELY" };

test("publicRole maps the frozen stored vocabulary to the public one", () => {
  assert.equal(publicRole(ROLE_OWNER_DB), "owner"); // stored 'admin' → owner
  assert.equal(publicRole(ROLE_ADMIN_DB), "admin"); // stored 'moderator' → admin
  assert.equal(publicRole("member"), "member");
  assert.equal(publicRole(null), null);
});

test("enable gates: the API key configures; the panel kill switch disables", async () => {
  const db = fakeDb();
  assert.equal(isVisionConfigured({}), false);
  assert.equal(isVisionConfigured({ GOOGLE_VISION_API_KEY: "k" }), true);
  assert.equal(await isVisionEnabled(db, { GOOGLE_VISION_API_KEY: "k" }), true);
  const killed = fakeDb({ "FROM site_settings": { value: "1" } });
  assert.equal(await isVisionKilled(killed), true);
  assert.equal(await isVisionEnabled(killed, { GOOGLE_VISION_API_KEY: "k" }), false);
});

test("parseSafeSearch: canonical values survive, junk and UNKNOWN become null", () => {
  assert.deepEqual(
    parseSafeSearch(visionResponse({ adult: "LIKELY", violence: "POSSIBLE", racy: "VERY_LIKELY", medical: "UNKNOWN", spoof: "garbage" })),
    { adult: "LIKELY", medical: null, spoof: null, violence: "POSSIBLE", racy: "VERY_LIKELY" },
  );
  assert.equal(parseSafeSearch({ responses: [] }), null);
  assert.equal(parseSafeSearch({ responses: [{ otherAnnotation: {} }] }), null);
  assert.equal(parseSafeSearch(null), null);
});

test("auto-mod thresholds: adult/violence at LIKELY+ trip, lesser scores never do", () => {
  assert.equal(AUTO_MOD_THRESHOLDS.adult, 3);
  assert.equal(likelihoodScore("LIKELY"), 3);
  assert.equal(likelihoodScore("VERY_LIKELY"), 4);
  assert.equal(likelihoodScore("UNKNOWN"), -1);
  assert.equal(likelihoodScore("nonsense"), -1);
  assert.equal(tripsAutoMod({ ...SAFE, adult: "LIKELY" }), true);
  assert.equal(tripsAutoMod({ ...SAFE, adult: "VERY_LIKELY", violence: "VERY_LIKELY" }), true);
  assert.equal(tripsAutoMod({ ...SAFE, adult: "POSSIBLE" }), false);
  assert.equal(tripsAutoMod({ ...SAFE, racy: "VERY_LIKELY" }), false); // racy is display-only
  assert.equal(tripsAutoMod({ ...SAFE, spoof: "VERY_LIKELY" }), false);
  assert.equal(tripsAutoMod(null), false);
});

test("base64Bytes matches btoa on binary bytes", () => {
  const bytes = new Uint8Array(70000).map((_, index) => (index * 7 + 13) % 256);
  assert.equal(base64Bytes(bytes), btoa(String.fromCharCode(...bytes.subarray(0, 0x8000)) + String.fromCharCode(...bytes.subarray(0x8000))));
});

test("fetchVisionVerdict: sends the key in a header, parses the annotation", async () => {
  let seen;
  const verdict = await fetchVisionVerdict(
    { GOOGLE_VISION_API_KEY: "test-key" },
    new Uint8Array([137, 80, 78, 71]),
    async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => visionResponse(SAFE) };
    },
  );
  assert.deepEqual(verdict.verdicts.adult, "VERY_UNLIKELY");
  assert.equal(seen.init.headers["x-goog-api-key"], "test-key");
  assert.ok(!seen.url.includes("test-key"), "the key must never ride the URL");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
});

test("fetchVisionVerdict: non-200 and transport failures return errors", async () => {
  const http = await fetchVisionVerdict({ GOOGLE_VISION_API_KEY: "k" }, new Uint8Array([1]), async () => ({ ok: false, status: 403 }));
  assert.match(http.error, /HTTP 403/);
  const boom = await fetchVisionVerdict({ GOOGLE_VISION_API_KEY: "k" }, new Uint8Array([1]), async () => { throw new Error("network down"); });
  assert.match(boom.error, /Vision check failed/);
});

test("runVisionCheck: a clean verdict stores exactly one verdict row", async () => {
  const db = fakeDb();
  await runVisionCheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, {
    kind: "attachment", entityId: "a-1", bytes: new Uint8Array([1]), hash: "h1", userId: 7,
  }, async () => ({ ok: true, json: async () => visionResponse(SAFE) }));
  const verdictStatements = db.statements.filter((s) => s.sql.includes("INSERT INTO vision_verdicts"));
  assert.equal(verdictStatements.length, 1);
  assert.equal(db.statements.filter((s) => s.sql.includes("moderation_actions")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("DELETE FROM attachments")).length, 0);
});

test("runVisionCheck: a LIKELY-adult verdict auto-removes the pending item, records the action, notifies", async () => {
  const db = fakeDb();
  await runVisionCheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, {
    kind: "attachment", entityId: "a-2", bytes: new Uint8Array([1]), hash: "h2", userId: 9,
  }, async () => ({ ok: true, json: async () => visionResponse({ ...SAFE, adult: "LIKELY" }) }));
  assert.ok(db.statements.some((s) => s.sql.includes("DELETE FROM attachments WHERE id = ? AND status = 'pending'")));
  const action = db.statements.find((s) => s.sql.includes("INSERT INTO moderation_actions"));
  assert.ok(action, "the auto-mod action row must be recorded");
  assert.equal(action.params[0], 9);
  assert.match(action.params[4], /adult: LIKELY/);
  assert.ok(db.statements.some((s) => s.sql.includes("INSERT INTO notifications")));
});

test("runVisionCheck: an approved appeal's hash override prevents a second auto-removal", async () => {
  const db = fakeDb({ "auto_mod_overrides": {} });
  await runVisionCheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, {
    kind: "gif", entityId: "g-1", bytes: new Uint8Array([1]), hash: "appealed-hash", userId: 4,
  }, async () => ({ ok: true, json: async () => visionResponse({ ...SAFE, adult: "VERY_LIKELY" }) }));
  assert.equal(db.statements.filter((s) => s.sql.includes("DELETE FROM gifs")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO moderation_actions")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO vision_verdicts")).length, 1);
});

test("runVisionCheck: a Vision failure fails open — error row, no removal", async () => {
  const db = fakeDb();
  await runVisionCheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, {
    kind: "avatar", entityId: "3", bytes: new Uint8Array([1]), userId: 3,
  }, async () => ({ ok: false, status: 500 }));
  assert.ok(db.statements.some((s) => s.sql.includes("INSERT INTO vision_verdicts")));
  assert.equal(db.statements.filter((s) => s.sql.includes("moderation_actions")).length, 0);
});

test("runVisionCheck: the panel kill switch stops the check before the fetch", async () => {
  const db = fakeDb({ "FROM site_settings": { value: "1" } });
  let fetched = 0;
  await runVisionCheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, {
    kind: "attachment", entityId: "a-3", bytes: new Uint8Array([1]), userId: 1,
  }, async () => { fetched += 1; return { ok: true, json: async () => visionResponse(SAFE) }; });
  assert.equal(fetched, 0);
  assert.equal(db.statements.length, 0);
});

test("scheduleVisionCheck: rides ctx.waitUntil and is a no-op when unconfigured", async () => {
  let ran = null;
  const ctx = { waitUntil: (promise) => { ran = promise; } };
  scheduleVisionCheck(ctx, {}, { kind: "attachment", entityId: "x", bytes: new Uint8Array([1]) });
  assert.equal(ran, null, "no API key = nothing scheduled");
  scheduleVisionCheck(null, { GOOGLE_VISION_API_KEY: "k" }, { kind: "attachment", entityId: "x" });
  assert.equal(ran, null, "no bytes = nothing scheduled");
  scheduleVisionCheck(ctx, { GOOGLE_VISION_API_KEY: "k" }, { kind: "attachment", entityId: "x", bytes: new Uint8Array([1]) });
  assert.ok(ran instanceof Promise);
  await ran; // must never throw into the request path
});

// ---------------------------------------------------------------------------
// Report-triggered re-check (v3.1): a filed report sweeps EVERY image on the
// reported target — approved content included — with intake's exact policy.

// A post's attachment rows, answered for the re-check's target select. Every
// attachment shares one own-chunk byte set (the fake matches SQL by
// substring, and the byte queries carry ? placeholders, not literal ids).
function postSweepDb(attachmentRows, sqlAnswers = {}) {
  return fakeDb(sqlAnswers, {
    "FROM attachments WHERE post_id": { results: attachmentRows },
    "FROM attachment_chunks": { results: [{ data: new Uint8Array([1, 2, 3]) }] },
  });
}

test("runReportVisionRecheck: a tripping APPROVED image is removed and recorded; a clean twin is not", async () => {
  const db = postSweepDb([
    { id: "flagged", status: "approved", hash: "bad-hash", version: "v1", created_by: 7 },
    { id: "clean", status: "approved", hash: "ok-hash", version: "v2", created_by: 7 },
  ]);
  await runReportVisionRecheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, { postId: 42 }, async () => ({
    ok: true,
    json: async () => visionResponse({ ...SAFE, adult: "LIKELY" }),
  }));
  // Both were checked — the sweep covers approved content, not just pending.
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO vision_verdicts")).length, 2);
  // Only the flagged one is removed, and the DELETE carries its status guard.
  const removal = db.statements.find((s) => s.sql.includes("DELETE FROM attachments WHERE id = ? AND status = ?"));
  assert.ok(removal, "the approved tripping row must be removed");
  assert.equal(removal.params[0], "flagged");
  assert.equal(removal.params[1], "approved");
  const action = db.statements.find((s) => s.sql.includes("INSERT INTO moderation_actions"));
  assert.ok(action, "the removal must be a moderation action (appealable)");
  assert.equal(action.params[0], 7);
  assert.match(action.params[4], /after a member report/);
  assert.ok(db.statements.some((s) => s.sql.includes("INSERT INTO notifications")));
});

test("runReportVisionRecheck: dedup twins (same hash) share one Vision call", async () => {
  const db = postSweepDb([
    { id: "twin-a", status: "approved", hash: "same", version: "v1", created_by: 7 },
    { id: "twin-b", status: "approved", hash: "same", version: "v2", created_by: 7 },
  ]);
  let fetched = 0;
  await runReportVisionRecheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, { postId: 42 }, async () => {
    fetched += 1;
    return { ok: true, json: async () => visionResponse(SAFE) };
  });
  assert.equal(fetched, 1);
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO vision_verdicts")).length, 2);
});

test("runReportVisionRecheck: an appeal-approved hash is re-checked but never re-removed", async () => {
  const db = postSweepDb(
    [{ id: "spared", status: "approved", hash: "appealed", version: "v1", created_by: 7 }],
    { "auto_mod_overrides": {} },
  );
  await runReportVisionRecheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, { postId: 42 }, async () => ({
    ok: true,
    json: async () => visionResponse({ ...SAFE, adult: "VERY_LIKELY" }),
  }));
  assert.equal(db.statements.filter((s) => s.sql.includes("DELETE FROM attachments")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO moderation_actions")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO vision_verdicts")).length, 1);
});

test("runReportVisionRecheck: a Vision failure fails open and removes nothing", async () => {
  const db = postSweepDb([{ id: "row", status: "pending", hash: "h", version: "v1", created_by: 7 }]);
  await runReportVisionRecheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, { postId: 42 }, async () => ({ ok: false, status: 500 }));
  assert.ok(db.statements.some((s) => s.sql.includes("INSERT INTO vision_verdicts")));
  assert.equal(db.statements.filter((s) => s.sql.includes("DELETE FROM attachments")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO moderation_actions")).length, 0);
});

test("runReportVisionRecheck: the kill switch stops the sweep before any fetch", async () => {
  const db = postSweepDb([{ id: "row", status: "approved", hash: "h", version: "v1", created_by: 7 }],
    { "FROM site_settings": { value: "1" } });
  let fetched = 0;
  await runReportVisionRecheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, { postId: 42 }, async () => {
    fetched += 1;
    return { ok: true, json: async () => visionResponse(SAFE) };
  });
  assert.equal(fetched, 0);
  assert.equal(db.statements.length, 0);
});

test("runReportVisionRecheck: a profile report sweeps the APPROVED avatar and blanks it on a trip", async () => {
  const db = fakeDb(
    {
      // recheckAvatarBytes for the approved mirror (declared first — its SQL
      // also contains the user-row needle below).
      "avatar_data AS data": { data: new Uint8Array([1, 2]) },
      // The avatar-set read: both mirrors exist.
      "FROM users WHERE id = ? LIMIT 1": {
        id: 9, avatar_mime: "image/png", avatar_version: "v1",
        pending_avatar_mime: null, pending_avatar_version: null,
      },
    },
  );
  await runReportVisionRecheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, { userId: 9 }, async () => ({
    ok: true,
    json: async () => visionResponse({ ...SAFE, violence: "LIKELY" }),
  }));
  const clear = db.statements.find((s) => s.sql.includes("SET avatar_mime = NULL, avatar_data = NULL"));
  assert.ok(clear, "the live avatar must be blanked on a trip");
  assert.equal(clear.params[0], 9);
  const action = db.statements.find((s) => s.sql.includes("INSERT INTO moderation_actions"));
  assert.ok(action, "the removal must be a moderation action (appealable)");
  assert.equal(action.params[1], "avatar");
  assert.equal(action.params[2], "9");
});

test("runReportVisionRecheck: a byte-less row (vanished canonical) is skipped, not fetched", async () => {
  const db = fakeDb({}, { "FROM attachments WHERE post_id": { results: [
    { id: "empty", status: "approved", hash: null, version: "v1", created_by: 7 },
  ] } });
  let fetched = 0;
  await runReportVisionRecheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k" }, { postId: 42 }, async () => {
    fetched += 1;
    return { ok: true, json: async () => visionResponse(SAFE) };
  });
  assert.equal(fetched, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO vision_verdicts")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("moderation_actions")).length, 0);
});

test("scheduleReportVisionRecheck: no-op unconfigured, rides ctx.waitUntil when configured", async () => {
  let ran = null;
  const ctx = { waitUntil: (promise) => { ran = promise; } };
  scheduleReportVisionRecheck(ctx, {}, { postId: 1 });
  assert.equal(ran, null, "no API key = nothing scheduled");
  scheduleReportVisionRecheck(ctx, { GOOGLE_VISION_API_KEY: "k" }, { postId: 1 });
  assert.ok(ran instanceof Promise);
  await ran; // must never throw into the request path
});

// --- OCR (v3.1, owner's ask): embedded text judged like typed text --------

test('parseEmbeddedText: the aggregate text block survives; everything else is ""', () => {
  assert.equal(parseEmbeddedText({ responses: [{ fullTextAnnotation: { text: "hello" } }] }), "hello");
  assert.equal(parseEmbeddedText({ responses: [{ fullTextAnnotation: {} }] }), "");
  assert.equal(parseEmbeddedText({ responses: [{}] }), "");
  assert.equal(parseEmbeddedText({ responses: [] }), "");
  assert.equal(parseEmbeddedText(null), "");
});

test("fetchVisionVerdict: ONE annotate call carries SafeSearch AND TEXT_DETECTION; ocrText rides back", async () => {
  let body;
  const result = await fetchVisionVerdict({ GOOGLE_VISION_API_KEY: "k" }, new Uint8Array([1]), async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => visionResponse(SAFE, "words in pixels") };
  });
  assert.deepEqual(
    body.requests[0].features.map((feature) => feature.type).sort(),
    ["SAFE_SEARCH_DETECTION", "TEXT_DETECTION"],
  );
  assert.equal(result.verdicts.adult, "VERY_UNLIKELY");
  assert.equal(result.ocrText, "words in pixels");
});

test("runVisionCheck: a filtered word in the embedded text auto-removes — no moderation key needed", async () => {
  const db = fakeDb();
  await runVisionCheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k", FILTERED_WORDS: "badword" }, {
    kind: "attachment", entityId: "a-ocr", bytes: new Uint8Array([1]), hash: "h-ocr", userId: 6,
  }, async () => ({ ok: true, json: async () => visionResponse(SAFE, "cute cat photo with badword on it") }));
  assert.ok(db.statements.some((s) => s.sql.includes("DELETE FROM attachments WHERE id = ? AND status = 'pending'")));
  const action = db.statements.find((s) => s.sql.includes("INSERT INTO moderation_actions"));
  assert.ok(action, "the OCR removal must be a moderation action (appealable)");
  assert.match(action.params[4], /filtered word embedded/);
  assert.ok(db.statements.some((s) => s.sql.includes("INSERT INTO notifications")));
});

test("runVisionCheck: when BOTH SafeSearch and embedded text trip, the SafeSearch reason wins", async () => {
  const db = fakeDb();
  await runVisionCheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k", FILTERED_WORDS: "badword" }, {
    kind: "attachment", entityId: "a-both", bytes: new Uint8Array([1]), hash: "h-both", userId: 6,
  }, async () => ({ ok: true, json: async () => visionResponse({ ...SAFE, adult: "VERY_LIKELY" }, "badword") }));
  const action = db.statements.find((s) => s.sql.includes("INSERT INTO moderation_actions"));
  assert.match(action.params[4], /Google Vision: adult: VERY_LIKELY/);
});

test("runVisionCheck: clean embedded text changes nothing", async () => {
  const db = fakeDb();
  await runVisionCheck({ FORUM_DB: db, GOOGLE_VISION_API_KEY: "k", FILTERED_WORDS: "badword" }, {
    kind: "attachment", entityId: "a-clean", bytes: new Uint8Array([1]), hash: "h-clean", userId: 6,
  }, async () => ({ ok: true, json: async () => visionResponse(SAFE, "wholesome caption") }));
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO moderation_actions")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("DELETE FROM attachments")).length, 0);
  assert.equal(db.statements.filter((s) => s.sql.includes("INSERT INTO vision_verdicts")).length, 1);
});

test("runReportVisionRecheck: embedded filtered text in an APPROVED image is removed by the sweep", async () => {
  const db = postSweepDb([{ id: "slur-png", status: "approved", hash: "ocr-hash", version: "v1", created_by: 7 }]);
  await runReportVisionRecheck(
    { FORUM_DB: db, GOOGLE_VISION_API_KEY: "k", FILTERED_WORDS: "badword" },
    { postId: 42 },
    async () => ({ ok: true, json: async () => visionResponse(SAFE, "badword") }),
  );
  const removal = db.statements.find((s) => s.sql.includes("DELETE FROM attachments WHERE id = ? AND status = ?"));
  assert.ok(removal, "the live approved image must come down");
  assert.equal(removal.params[0], "slur-png");
  assert.equal(removal.params[1], "approved");
  const action = db.statements.find((s) => s.sql.includes("INSERT INTO moderation_actions"));
  assert.match(action.params[4], /filtered word embedded/);
});
