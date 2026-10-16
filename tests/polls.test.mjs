// Polls (C3): creation on a thread root (author-only, ≤4 non-empty unique
// options), one changeable vote per member per poll, the detail payload's
// poll shape (results always visible), and the result-bars render.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import forumWorker from "../worker.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mockDb(routes, { batchMeta = null, throwOnSql = null } = {}) {
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
      if (throwOnSql && statements.some((statement) => throwOnSql.test(statement.sql))) {
        throw new Error("simulated batch failure");
      }
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
  author_id: "7",
  parent_id: null,
  body: "root body",
  visibility: "public",
  created_at: 1700000000,
  last_activity_at: 1700000005,
  author_username: "test_user",
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

const POLL_OPTION_COUNTS_SQL = /FROM polls p JOIN poll_options o ON o\.poll_id = p\.id/;
const POLL_LOOKUP_SQL = /SELECT id, closed_at FROM polls WHERE post_id = \? LIMIT 1/;
const VIEWER_OPTION_SQL = /SELECT option_id FROM poll_votes WHERE poll_id = \? AND user_id = \?/;
const POLL_EXISTS_SQL = /FROM polls WHERE post_id = \? LIMIT 1/;
const POLL_INSERT_SQL = /^INSERT INTO polls \(post_id/;

const createRoutes = (root, { pollExists = false } = {}) => [
  sessionRoute(),
  banCheckRoute,
  { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
  banViewRouteOff,
  { sql: POLL_EXISTS_SQL, result: pollExists ? { id: 2 } : null },
  { sql: /./ },
];

test("a root's author creates a poll with filtered question and options (one atomic batch)", async () => {
  const root = postRow({ id: "1", author_id: "7" });
  const mock = mockDb(createRoutes(root));
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/poll", "POST", {
      question: "Best snack?", options: ["biscuits", "beans", "beans on toast"],
    }),
    envFor(mock.db),
  );
  assert.equal(response.status, 201, await response.clone().text());
  const pollBatch = mock.calls.filter((call) => /INSERT INTO polls/.test(call.sql));
  assert.ok(pollBatch.length, "the poll insert runs");
  const optionBatch = mock.calls.filter((call) => /INSERT INTO poll_options/.test(call.sql));
  assert.equal(optionBatch.length, 3, "one option insert per option");
  // The word filter ran (no-op with an empty secret; the SQL path is shared).
  assert.equal(optionBatch[0].values[1], "biscuits");
  assert.equal(optionBatch[0].values[2], 1, "options carry their 1-based position");
});

test("poll create 400s: too many options, empty option, duplicate option, bad body", async () => {
  const root = postRow({ id: "1", author_id: "7" });
  for (const [body, expected] of [
    [{ question: "q", options: ["a", "b", "c", "d", "e"] }, /2 to 4/i],
    [{ question: "q", options: ["a", ""] }, /between 1 and 80/i],
    [{ question: "q", options: ["same", "same"] }, /duplicate/i],
    [{ question: "", options: ["a", "b"] }, /question/i],
    [{ question: "q", options: "nope" }, /options/i],
  ]) {
    const mock = mockDb(createRoutes(root));
    const response = await forumWorker.fetch(
      requestFor("https://forum.example/api/posts/1/poll", "POST", body),
      envFor(mock.db),
    );
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, expected, JSON.stringify(body));
    assert.equal(mock.calls.some((call) => /INSERT INTO polls/.test(call.sql)), false,
      "no poll write for " + JSON.stringify(body));
  }
});

test("poll create gates: member 401, non-author 403, reply target 400, existing poll 409", async () => {
  // Guest.
  const guest = mockDb([{ sql: /./ }]);
  const guestResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1/poll", {
      method: "POST",
      headers: { Origin: "https://forum.example", "Content-Type": "application/json" },
      body: "{}",
    }),
    envFor(guest.db),
  );
  assert.equal(guestResponse.status, 401);

  // Non-author.
  const root = postRow({ id: "1", author_id: "3" });
  const wrongAuthor = mockDb(createRoutes(root));
  const forbidden = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/poll", "POST", { question: "q", options: ["a", "b"] }),
    envFor(wrongAuthor.db),
  );
  assert.equal(forbidden.status, 403);

  // A level-1 reply cannot carry a poll.
  const threadRoot = postRow({ id: "1", author_id: "7" });
  const reply = postRow({ id: "4", parent_id: "1", author_id: "7" });
  const rootReply = mockDb([
    sessionRoute(), banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => reply }, banViewRouteOff,
    { sql: /FROM posts WHERE id = \? LIMIT 1/, result: () => threadRoot },
    { sql: /./ },
  ]);
  const replyResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/4/poll", "POST", { question: "q", options: ["a", "b"] }),
    envFor(rootReply.db),
  );
  assert.equal(replyResponse.status, 400);

  // A second poll on the same thread is a 409.
  const ownThread = postRow({ id: "1", author_id: "7" });
  const twice = mockDb(createRoutes(ownThread, { pollExists: true }));
  const duplicate = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/poll", "POST", { question: "q", options: ["a", "b"] }),
    envFor(twice.db),
  );
  assert.equal(duplicate.status, 409);
});

test("voting: one vote upserted per member; re-voting changes the option; gate shapes", async () => {
  const root = postRow({ id: "1", author_id: "3" });
  const voteRoutes = (optionId) => [
    sessionRoute(), banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root }, banViewRouteOff,
    { sql: POLL_LOOKUP_SQL, result: { id: 2 } },
    // The chosen option must belong to this poll (guard SELECT binds poll id).
    { sql: /SELECT id FROM poll_options WHERE id = \? AND poll_id = \? LIMIT 1/,
      result: (values) => (values[0] === optionId && values[1] === 2 ? { id: optionId } : null) },
    { sql: /INSERT INTO poll_votes/, runMeta: { meta: { changes: 1 } } },
    { sql: /./ },
  ];
  const mock = mockDb(voteRoutes(3));
  const response = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/poll", "PUT", { optionId: 3 }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const upsert = mock.calls.find((call) => /INSERT INTO poll_votes/.test(call.sql));
  assert.match(upsert.sql, /ON CONFLICT\(poll_id, user_id\) DO UPDATE/, "the vote is CHANGEABLE");
  assert.deepEqual(upsert.values, [2, 7, 3, upsert.values[3]], "poll, member, option, now");

  // Re-vote on another option is the same upsert path.
  const revote = mockDb(voteRoutes(4));
  const revoteResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/poll", "PUT", { optionId: 4 }),
    envFor(revote.db),
  );
  assert.equal(revoteResponse.status, 200);
  assert.equal(revote.calls.find((call) => /INSERT INTO poll_votes/.test(call.sql)).values[2], 4);

  // Voting for an option outside the poll is a 400.
  const foreign = mockDb(voteRoutes(0));
  const foreignResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/poll", "PUT", { optionId: 99 }),
    envFor(foreign.db),
  );
  assert.equal(foreignResponse.status, 400);
  assert.equal(foreign.calls.some((call) => /INSERT INTO poll_votes/.test(call.sql)), false);

  // Voting on a poll-less thread is a 404.
  const none = mockDb([
    sessionRoute(), banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root }, banViewRouteOff,
    { sql: POLL_LOOKUP_SQL, result: null },
    { sql: /./ },
  ]);
  const noneResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/poll", "PUT", { optionId: 3 }),
    envFor(none.db),
  );
  assert.equal(noneResponse.status, 404);

  // Guests 401.
  const guest = mockDb([{ sql: /./ }]);
  const guestResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1/poll", {
      method: "PUT",
      headers: { Origin: "https://forum.example", "Content-Type": "application/json" },
      body: "{}",
    }),
    envFor(guest.db),
  );
  assert.equal(guestResponse.status, 401);
});

test("the detail payload carries the poll with counts, total, and the viewer's option", async () => {
  const root = postRow({ id: "1", author_id: "3" });
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    { sql: POLL_LOOKUP_SQL, result: { id: 2, question: "Best snack?" } },
    {
      sql: POLL_OPTION_COUNTS_SQL,
      rows: [
        { id: 30, label: "biscuits", position: 0, vote_count: 3 },
        { id: 31, label: "beans", position: 1, vote_count: 1 },
      ],
    },
    { sql: VIEWER_OPTION_SQL, result: { option_id: 31 } },
    { sql: /./ },
  ]);
  const detail = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1", {
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(mock.db),
  );
  assert.equal(detail.status, 200);
  const post = await detail.json();
  assert.deepEqual(post.poll, {
    question: "Best snack?",
    options: [
      { id: 30, label: "biscuits", count: 3 },
      { id: 31, label: "beans", count: 1 },
    ],
    totalVotes: 4,
    viewerOption: 31,
  });
});

test("a thread without a poll leaves the payload's poll field absent", async () => {
  const root = postRow({ id: "1", author_id: "3" });
  const mock = mockDb([
    sessionRoute(),
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: () => root },
    { sql: /SELECT 1 FROM bans b WHERE b\.user_id = \?/, result: null },
    { sql: POLL_LOOKUP_SQL, result: null },
    { sql: /./ },
  ]);
  const detail = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1"),
    envFor(mock.db),
  );
  assert.equal(detail.status, 200);
  assert.equal("poll" in (await detail.json()), false);
});

// --- the render ---------------------------------------------------------------

function mockDocument() {
  function make(tag) {
    const node = {
      tagName: tag.toUpperCase(), children: [], className: "", textContent: "",
      dataset: {}, attributes: {}, hidden: false, style: {},
      append(...nodes) { for (const child of nodes) this.children.push(child); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    };
    return node;
  }
  return {
    createElement: (tag) => make(tag),
    createElementNS: (_ns, tag) => make(tag),
    createTextNode: (text) => { const node = make("#text"); node.textContent = text; return node; },
  };
}

function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

const POLL = {
  question: "Best snack?",
  options: [
    { id: 30, label: "biscuits", count: 3 },
    { id: 31, label: "beans", count: 1 },
  ],
  totalVotes: 4,
  viewerOption: 31,
};

test("the detail card renders poll result bars for everyone, with vote buttons for members", async () => {
  const { createPostCard } = await import("../public/js/render.js");
  const card = createPostCard({
    id: 1, publicLevel: 0, author: { username: "alice" },
    createdAt: "2026-10-16T00:00:00.000Z", body: "hi", poll: POLL,
  }, mockDocument(), { id: 7 });
  const block = [...walk(card)].find((node) => node.className.includes("post-poll"));
  assert.ok(block, "the poll block renders");
  assert.match([...walk(block)].map((node) => node.textContent ?? "").join(""), /Best snack\?/);
  const fills = [...walk(block)].filter((node) => node.className.includes("poll-bar-fill"));
  assert.equal(fills.length, 2);
  // Width percentages: 3/4 = 75%, 1/4 = 25%.
  assert.equal(fills[0].style.width, "75%");
  assert.equal(fills[1].style.width, "25%");
  const buttons = [...walk(block)].filter((node) => node.dataset?.action === "poll-vote");
  assert.equal(buttons.length, 2, "one vote button per option for members");
  assert.equal(buttons[1].dataset.optionId, "31");
  assert.equal(buttons[1].getAttribute("aria-pressed"), "true", "the viewer's option is marked");
  assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
});

test("guests see the poll bars but no vote buttons; polls without votes render 0-width bars", async () => {
  const { createPostCard } = await import("../public/js/render.js");
  const card = createPostCard({
    id: 1, publicLevel: 0, author: { username: "alice" },
    createdAt: "2026-10-16T00:00:00.000Z", body: "hi",
    poll: { question: "q", options: [{ id: 30, label: "a", count: 0 }, { id: 31, label: "b", count: 0 }], totalVotes: 0, viewerOption: null },
  }, mockDocument(), null);
  const block = [...walk(card)].find((node) => node.className.includes("post-poll"));
  const buttons = [...walk(block)].filter((node) => node.dataset?.action === "poll-vote");
  assert.equal(buttons.length, 0, "guests get no vote buttons");
  const fills = [...walk(block)].filter((node) => node.className.includes("poll-bar-fill"));
  assert.equal(fills[0].style.width, "0%", "an unvoted poll reads 0%");

  const noPoll = createPostCard({
    id: 1, publicLevel: 0, author: { username: "alice" },
    createdAt: "2026-10-16T00:00:00.000Z", body: "hi",
  }, mockDocument(), null);
  assert.equal([...walk(noPoll)].some((node) => node.className.includes("post-poll")), false);
});

// --- the composer dialog (app.js source pins — node-unimportable) ---------------

test("the composer Poll button, dialog inputs, and vote handler are wired in app.js", () => {
  const appJs = readFileSync(path.join(repoRoot, "public", "js", "app.js"), "utf8");
  const indexHtml = readFileSync(path.join(repoRoot, "public", "index.html"), "utf8");
  // A Poll button rides the root composer's attachment row.
  assert.match(appJs, /"open-poll-dialog"/);
  assert.match(indexHtml, /id="poll-dialog"/);
  assert.match(indexHtml, /id="poll-question"/);
  // The confirmation reads the question and up to four options and stashes
  // them on the form; the post-create submit path sends POST /api/posts/:id/poll.
  assert.match(appJs, /composerPoll/);
  assert.match(appJs, /\/api\/posts\/" \+ postId \+ "\/poll"/);
  // The vote handler PUTts the chosen option and re-renders the route.
  assert.match(appJs, /"poll-vote": async/);
  assert.match(appJs, /method: "PUT"/);
});