// @mentions (C2): token scan on post/reply CREATE (after the word filter),
// resolution against users by username_key, deduped notification fan-out, and
// the markdown render of @name as a same-origin /users/<name> anchor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import forumWorker from "../worker.mjs";
import {
  MENTION_SCAN_PATTERN,
  scanMentions,
  mentionFanOutStatements,
  MAX_MENTIONS_PER_BODY,
} from "../api/mentions.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- the scan ----------------------------------------------------------------

test("the scan matches the brief's exact token pattern", () => {
  assert.equal(MENTION_SCAN_PATTERN.source, "(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]+)");
});

test("scanMentions finds bracketed, mid-sentence, and line-start tokens; dedupes case-insensitively", () => {
  assert.deepEqual(scanMentions("hey @alice and (@Bob) and @ALICE again"), ["alice", "bob"]);
  assert.deepEqual(scanMentions("@first\n@second_!trailing-dot"), ["first", "second_"]);
  assert.deepEqual(scanMentions(""), []);
  assert.deepEqual(scanMentions(null), []);
});

test("an address-like suffix is not a mention (word char before @ blocks the match)", () => {
  assert.deepEqual(scanMentions("mail me at hello@example.com"), []);
  assert.deepEqual(scanMentions("mail me at hello@ example.com"), []);
});

test("the scan caps at 10 unique mentions", () => {
  const body = Array.from({ length: 14 }, (_v, i) => "@user" + i).join(" ");
  const found = scanMentions(body);
  assert.equal(found.length, MAX_MENTIONS_PER_BODY);
  assert.equal(found[0], "user0");
  assert.equal(found[9], "user9");
});

// --- the fan-out -------------------------------------------------------------

function recordingDb() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return { bind: (...values) => { statements.push({ sql, values }); return { sql, values }; } };
    },
  };
}

test("unknown names are a silent no-op; the mention never notifies the author", async () => {
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              // Only "wempo" resolves (id 3); everything else is unknown.
              return values[0] === "wempo" ? { id: 3, username: "wempo" } : null;
            },
          };
        },
      };
    },
  };
  const statements = await mentionFanOutStatements(db, "hey @wempo and @nobody_ok and @WEMPO", {
    actorId: 3, targetPostId: 1, replyId: null, now: 1700000000, excludeIds: [],
  });
  assert.equal(statements.length, 0, "unknown names are no-ops and self-mentions never notify");
});

test("a mention of a real member builds the guarded insert with the actor's target thread", async () => {
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            get sql() { return sql; },
            get values() { return values; },
            async first() {
              return values[0] === "wempo" ? { id: 3, username: "wempo" } : null;
            },
          };
        },
      };
    },
  };
  const statements = await mentionFanOutStatements(db, "ping @wempo", {
    actorId: 7, targetPostId: 1, replyId: 500, now: 1700000000, excludeIds: [],
  });
  assert.equal(statements.length, 2, "insert + prune");
  assert.match(statements[0].sql, /INSERT INTO notifications/);
  assert.match(statements[0].sql, /WHERE NOT EXISTS/, "the dedupe guard mirrors the reply fan-out");
  assert.deepEqual(statements[0].values, [3, 1, 500, 1700000000, 3, 500]);
  assert.match(statements[1].sql, /DELETE FROM notifications/);
});

test("the mention dedupes against the ordinary reply target and other exclusion ids", async () => {
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            sql,
            values,
            async first() {
              return values[0] === "wempo" ? { id: 3, username: "wempo" } : null;
            },
          };
        },
      };
    },
  };
  const statements = await mentionFanOutStatements(db, "@wempo", {
    actorId: 7, targetPostId: 1, replyId: 500, now: 1700000000, excludeIds: [3],
  });
  assert.equal(statements.length, 0, "the already-notified reply target is skipped");
});

// --- route-level wiring ------------------------------------------------------

function mockDb(routes, { batchMeta = null } = {}) {
  const calls = [];
  const batches = [];
  const db = {
    prepare(sql) {
      const route = routes.find((candidate) => candidate.sql.test(sql)) ||
        routes[routes.length - 1];
      if (!route) throw new Error("Unexpected SQL: " + sql);
      return {
        bind(...values) {
          const bound = { sql, values };
          calls.push(bound);
          return {
            sql,
            values,
            async first() {
              return typeof route.result === "function" ? route.result(values) : (route.result ?? null);
            },
            async all() {
              return { results: route.rows === undefined ? [] : route.rows };
            },
            async run() {
              return route.runMeta === undefined ? { meta: { changes: 1 } } : route.runMeta;
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((_s, index) => (batchMeta && batchMeta[index]) || { meta: { changes: 1 } });
    },
  };
  return { db, calls, batches };
}

const sessionRow = (overrides = {}) => ({
  token_hash: "a".repeat(64),
  user_id: 7,
  csrf_token: "expected-csrf-token",
  expires_at: Math.floor(Date.now() / 1000) + 60,
  username: "test_user",
  role: "member",
  bio: "",
  ...overrides,
});
const sessionRoute = (overrides) => ({ sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow(overrides) });
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };
const banViewRouteOff = { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null };
const successLimiter = () => ({ async limit() { return { success: true }; } });
const envFor = (db, overrides = {}) => ({
  FORUM_DB: db,
  READ_RATE_LIMITER: successLimiter(),
  WRITE_RATE_LIMITER: successLimiter(),
  POST_WRITE_RATE_LIMITER: successLimiter(),
  GUEST_SESSION_RATE_LIMITER: successLimiter(),
  TURNSTILE_SECRET: "t", TURNSTILE_HOSTNAMES: "forum.example", FILTERED_WORDS: "",
  IMAGE_UPLOAD_RATE_LIMITER: successLimiter(),
  ...overrides,
});

const postRow = (overrides = {}) => ({
  id: "1",
  author_id: "3",
  parent_id: null,
  body: "root body",
  visibility: "public",
  created_at: 1700000000,
  last_activity_at: 1700000005,
  author_username: "rootauthor",
  avatar_mime: null,
  avatar_updated_at: null,
  avatar_version: null,
  parent_body: null,
  like_count: 0,
  dislike_count: 0,
  viewer_reaction: null,
  ...overrides,
});

function requestFor(url, method, body) {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
}

async function withSiteverify(action, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action, hostname: "forum.example" }), { status: 200 });
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a root post mentioning a member fans out a notification for that member", async () => {
  const postRow2 = postRow({ id: "1" });
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    // post-create's pre-insert ban check reads posts-less; the create INSERT
    // is a run. The create INSERT is a plain run, and the mention resolution
    // SELECT id FROM users WHERE username_key = ? resolves wempo (id 3).
    { sql: /^SELECT id, username FROM users WHERE username_key = \? LIMIT 1$/, result: { id: 3, username: "wempo" } },
    { sql: /./, runMeta: { meta: { changes: 1, last_row_id: 900 } } },
  ], {
    batchMeta: [{ meta: { changes: 1, last_row_id: 900 } }],
  });
  const response = await withSiteverify("post", () => forumWorker.fetch(
    requestFor("https://forum.example/api/posts", "POST", { body: "tagging @wempo here", "cf-turnstile-response": "turnstile-token-fixture" }),
    envFor(mock.db),
  ));
  assert.equal(response.status, 201, await response.clone().text());
  const mentionInserts = mock.batches
    .flat()
    .filter((statement) => /INSERT INTO notifications/.test(statement.sql));
  assert.ok(mentionInserts.length >= 1, "a mention insert runs");
  assert.deepEqual(mentionInserts[0].values.slice(0, 3), [3, 900, null],
    "the mention targets the fresh root with no reply id (replyId null)");
});

test("a reply mentioning a member who is ALSO the reply target notifies them exactly once", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: () => root },
    banViewRouteOff,
    // The mention scan resolves wempo (id 3 == the reply target).
    { sql: /^SELECT id, username FROM users WHERE username_key = \? LIMIT 1$/, result: { id: 3, username: "wempo" } },
    { sql: /SELECT user_id FROM thread_subscriptions/, rows: [] },
    { sql: /./ },
  ], {
    batchMeta: [{ meta: { changes: 1, last_row_id: 600 } }],
  });
  await withSiteverify("reply", () => forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/replies", "POST", {
      body: "cc @wempo",
      "cf-turnstile-response": "turnstile-token-fixture",
    }),
    envFor(mock.db),
  ));
  const fanoutBatch = mock.batches[1];
  const inserts = fanoutBatch.filter((statement) => /INSERT INTO notifications/.test(statement.sql));
  const recipients = inserts.map((statement) => Number(statement.values[0]));
  assert.deepEqual(recipients, [3], "one notification for the target-mention collision");
});

test("an unknown mention in a reply is a silent no-op (no insert, reply still lands)", async () => {
  const root = postRow({ id: "1", author_id: "3", parent_id: null });
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: () => root },
    banViewRouteOff,
    { sql: /^SELECT id, username FROM users WHERE username_key = \? LIMIT 1$/, result: null },
    { sql: /SELECT user_id FROM thread_subscriptions/, rows: [] },
    { sql: /./ },
  ], {
    batchMeta: [{ meta: { changes: 1, last_row_id: 600 } }],
  });
  const response = await withSiteverify("reply", () => forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/replies", "POST", {
      body: "cc @nobody_at_all",
      "cf-turnstile-response": "turnstile-token-fixture",
    }),
    envFor(mock.db),
  ));
  assert.equal(response.status, 201);
  const fanoutBatch = mock.batches[1];
  const inserts = fanoutBatch.filter((statement) => /INSERT INTO notifications/.test(statement.sql));
  assert.equal(inserts.length, 1, "only the ordinary root-author notification");
  assert.equal(inserts[0].values[0], 3);
});

// --- the markdown render -----------------------------------------------------

function stubDocument() {
  const make = (tag, ns) => ({
    tagName: tag.toUpperCase(), namespaceURI: ns || null,
    attributes: {}, dataset: {}, children: [],
    textContent: "",
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    append(child) { this.children.push(child); },
  });
  return {
    createElement: (tag) => make(tag),
    createElementNS: (_ns, tag) => make(tag, ns),
    createTextNode: (text) => {
      const node = make("#text");
      node.textContent = text;
      return node;
    },
  };
}

function* walkDoc(node) {
  yield node;
  for (const child of node.children ?? []) yield* walkDoc(child);
}

function textOfDoc(node) {
  if (node.tagName === "#TEXT") return node.textContent;
  if (!node.children?.length) return node.textContent ?? "";
  return [...node.children].map(textOfDoc).join("");
}

test("@name renders as a same-origin /users/<name> anchor; other text stays literal", async () => {
  const { parseInline } = await import("../public/js/markdown.js");
  const doc = stubDocument();
  const nodes = parseInline(doc, "hey @wempo and @bob_1!");
  const anchors = [...walkDoc({ children: nodes })].filter((node) => node.tagName === "A");
  assert.equal(anchors.length, 2);
  assert.equal(textOfDoc(anchors[0]), "@wempo");
  assert.equal(anchors[0].href, "/users/wempo");
  assert.equal(textOfDoc(anchors[1]), "@bob_1");
  assert.equal(anchors[1].href, "/users/bob_1");
  const plain = [...walkDoc({ children: nodes })].filter((node) => node.tagName === "#TEXT").map((node) => node.textContent ?? "").join("");
  assert.equal(plain, "hey  and !");
});

test("an email-shaped token is NOT a mention render; HTML stays literal", async () => {
  const { parseInline } = await import("../public/js/markdown.js");
  const doc = stubDocument();
  const nodes = parseInline(doc, "mail hello@example.com <script>x</script>");
  const html = nodes.map(textOfDoc).join("");
  assert.equal(html, "mail hello@example.com <script>x</script>");
  assert.equal(nodes.some((node) => node.tagName === "A"), false);
});