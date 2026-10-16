// Suggestions board (v2.4.1): migration-0006-backed feed, create, and reply
// inheritance pins. The board is a root-only dimension ('general' by default,
// 'suggestions' for the subforum); this file pins the handler-layer whitelist,
// the suggestions feed's score sort and composite cursor, the unchanged
// general feed SQL, and the header nav wiring that /suggestions rides on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import forumWorker from "../worker.mjs";
import { THREAD_REPLY_INSERT_SQL } from "../constants.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// D1 mock: routes are { sql: RegExp, result?, rows?, runMeta? }, matched in
// order (last route is the fallback). Same fixture machinery as
// threading.test.mjs — these tests reuse its shape deliberately.
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
              return typeof route.result === "function"
                ? route.result(values)
                : (route.result === undefined ? null : route.result);
            },
            async all() {
              return { results: route.rows === undefined ? [] : route.rows };
            },
            async run() {
              return route.runMeta === undefined
                ? { meta: { changes: 1 } }
                : (typeof route.runMeta === "function" ? route.runMeta(values) : route.runMeta);
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((statement, index) => batchMeta?.[index] || { meta: { changes: 1 } });
    },
  };
  return { db, calls, batches };
}

function successLimiter() {
  return { async limit() { return { success: true }; } };
}

function envFor(db, overrides = {}) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: successLimiter(),
    WRITE_RATE_LIMITER: successLimiter(),
    POST_WRITE_RATE_LIMITER: successLimiter(),
    REACTION_RATE_LIMITER: successLimiter(),
    TURNSTILE_SECRET: "turnstile-secret-fixture",
    TURNSTILE_HOSTNAMES: "forum.example",
    FILTERED_WORDS: "",
    ...overrides,
  };
}

function signedInSessionRow(overrides = {}) {
  return {
    token_hash: "a".repeat(64),
    user_id: 7,
    csrf_token: "expected-csrf-token",
    expires_at: Math.floor(Date.now() / 1000) + 60,
    username: "test_user",
    role: "member",
    bio: "",
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
    ...overrides,
  };
}

// POST_SELECT rows carry the serialized like/dislike tallies the suggestions
// cursor reads back, so the feed fixtures carry both.
function postRow(overrides = {}) {
  return {
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
  };
}

function requestFor(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function route(request, env) {
  return forumWorker.fetch(request, env);
}

const sessionRoute = { sql: /FROM sessions s LEFT JOIN users u/, result: signedInSessionRow() };
const banCheckRoute = { sql: /^SELECT id FROM bans WHERE user_id = \?/, result: null };

function suggestionFeedRoutes(rows, { session = sessionRoute } = {}) {
  // Same decorator shape as the activity-feed mocks: the board-filtered feed
  // SELECT, then the batched reply-count/latest-replies decoration queries,
  // then a catch-all that also answers the attachments lookup with no rows.
  return [
    session,
    { sql: /FROM posts p JOIN users u/, rows },
    { sql: /AS reply_count/, rows: [] },
    { sql: /ROW_NUMBER/, rows: [] },
    { sql: /./ },
  ];
}

// --- Feed: the general board keeps its byte-identical SQL --------------------

test("a missing board param keeps the general feed SQL unchanged (pin)", async () => {
  const mock = mockDb(suggestionFeedRoutes([]));
  const response = await route(
    new Request("https://forum.example/api/posts", { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.posts, []);
  const feedCall = mock.calls.find((call) => call.sql.includes("FROM posts p JOIN"));
  assert.ok(feedCall, "the feed query runs exactly as before");
  // Cursor/order clauses untouched: no board filter clause, no score
  // expression. (post.board in the SELECT list is additive serialization —
  // POST_SELECT exposes the column; the general feed never FILTERS on it.)
  assert.equal(feedCall.sql.includes("p.board = "), false);
  assert.equal(feedCall.sql.includes("AND p.board"), false);
  assert.equal(feedCall.sql.includes("SUM(CASE"), false, "no score expression");
  assert.match(feedCall.sql, /WHERE p\.parent_id IS NULL AND p\.visibility = 'public' /);
  assert.match(feedCall.sql, /ORDER BY p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  assert.deepEqual(feedCall.values, [-1]);
  assert.equal(body.nextBefore, null);
});

test("an explicit board=general rides the same unchanged general feed SQL", async () => {
  const mock = mockDb(suggestionFeedRoutes([]));
  const response = await route(
    new Request("https://forum.example/api/posts?board=general",
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const feedCall = mock.calls.find((call) => call.sql.includes("FROM posts p JOIN"));
  assert.equal(feedCall.sql.includes("p.board = "), false);
  assert.equal(feedCall.sql.includes("SUM(CASE"), false);
  assert.deepEqual(feedCall.values, [-1]);
  // The general feed also keeps its strictly non-negative cursor format.
  const rejected = mockDb(suggestionFeedRoutes([]));
  const failResponse = await route(
    new Request("https://forum.example/api/posts?board=general&before=-2_5",
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(rejected.db),
  );
  assert.equal(failResponse.status, 400);
  assert.deepEqual(await failResponse.json(), { error: "That page cursor is invalid." });
  assert.equal(rejected.calls.filter((call) => call.sql.includes("FROM posts p JOIN")).length, 0);
});

test("an unknown board value is rejected before any database work", async () => {
  for (const board of ["weird", "Suggestions", "suggestion", "general, suggestions"]) {
    const mock = mockDb(suggestionFeedRoutes([]));
    const response = await route(
      new Request("https://forum.example/api/posts?board=" + encodeURIComponent(board),
        { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
      envFor(mock.db),
    );
    assert.equal(response.status, 400, JSON.stringify(board));
    assert.deepEqual(await response.json(), { error: "That board is not available." });
    assert.equal(mock.calls.filter((call) => call.sql.includes("FROM posts p JOIN")).length, 0,
      "no feed query may run for an unknown board");
  }
});

// --- Feed: the suggestions board's score sort and composite cursor ----------

test("the suggestions feed filters the board and orders by net reaction score", async () => {
  // Fixtures in the order the score-sorted SQL would return them: root 7 sits
  // at +2 (3 likes, 1 dislike); root 9 at -3 (1 like, 4 dislikes).
  const rows = [
    postRow({ id: "7", board: "suggestions", like_count: 3, dislike_count: 1, body: "two plus" }),
    postRow({ id: "9", board: "suggestions", like_count: 1, dislike_count: 4, body: "net negative" }),
  ];
  const mock = mockDb(suggestionFeedRoutes(rows));
  const response = await route(
    new Request("https://forum.example/api/posts?board=suggestions",
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  const feedCall = mock.calls.find((call) => call.sql.includes("FROM posts p JOIN"));
  assert.ok(feedCall.sql.includes("p.board = 'suggestions'"), "the board filter clause");
  assert.equal(feedCall.sql.includes("p.board = 'general'"), false, "general is implicit");
  // Score sort: net (likes − dislikes) DESC, then id DESC — the established
  // composite-tiebreak direction. No activity ordering may remain.
  assert.match(feedCall.sql,
    /ORDER BY \(SELECT COALESCE\(SUM\(CASE r\.value WHEN 'like' THEN 1 ELSE -1 END\), 0\) FROM reactions r WHERE r\.post_id = p\.id\) DESC, p\.id DESC LIMIT 21/);
  assert.equal(feedCall.sql.includes("last_activity_at DESC"), false);
  assert.deepEqual(feedCall.values, [-1], "only the viewer-reaction bind");

  // Decorators ride unchanged: publicLevel, replyCount, latestReplies, and the
  // attachments array all land on board-filtered cards.
  assert.equal(body.posts.length, 2);
  assert.deepEqual(body.posts.map((post) => post.id), [7, 9]);
  for (const post of body.posts) {
    assert.equal(post.board, "suggestions");
    assert.equal(post.publicLevel, 0);
    assert.equal(post.replyCount, 0);
    assert.deepEqual(post.latestReplies, []);
    assert.deepEqual(post.attachments, []);
  }
  // Two rows never paginate: the cursor-emission shape (score_id, including
  // a negative score half) is pinned by the >20-row page test below.
  assert.equal(body.nextBefore, null);
});

test("the suggestions cursor walks the composite score_id keyset", async () => {
  const mock = mockDb(suggestionFeedRoutes([]));
  const response = await route(
    new Request("https://forum.example/api/posts?board=suggestions&before=2_9",
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const feedCall = mock.calls.find((call) => call.sql.includes("FROM posts p JOIN"));
  // Same keyset shape as the activity feed, with the score in place of the
  // seconds: strictly less, or equal score with the id below the cursor's id.
  assert.match(feedCall.sql,
    /AND \(\(SELECT COALESCE\(SUM\(CASE r\.value WHEN 'like' THEN 1 ELSE -1 END\), 0\) FROM reactions r WHERE r\.post_id = p\.id\) < \? OR \(\(SELECT COALESCE\(SUM\(CASE r\.value WHEN 'like' THEN 1 ELSE -1 END\), 0\) FROM reactions r WHERE r\.post_id = p\.id\) = \? AND p\.id < \?\)\)/);
  assert.deepEqual(feedCall.values, [-1, 2, 2, 9]);

  // A negative score half is a legal cursor for a below-zero thread.
  const negative = mockDb(suggestionFeedRoutes([]));
  const negativeResponse = await route(
    new Request("https://forum.example/api/posts?board=suggestions&before=" + encodeURIComponent("-3_9"),
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(negative.db),
  );
  assert.equal(negativeResponse.status, 200);
  assert.deepEqual(
    negative.calls.find((call) => call.sql.includes("FROM posts p JOIN")).values,
    [-1, -3, -3, 9],
  );
});

test("malformed suggestions cursors are rejected with 400 like general ones", async () => {
  for (const invalid of ["12", "1_2_3", "x_2", "1_x", "1_2x", "", "-1_2_3",
    "99999999999_1", "1_99999999999", "1_2_", "--1_2"]) {
    const mock = mockDb(suggestionFeedRoutes([]));
    const response = await route(
      new Request("https://forum.example/api/posts?board=suggestions&before=" +
        encodeURIComponent(invalid),
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
      envFor(mock.db),
    );
    assert.equal(response.status, 400, "cursor " + JSON.stringify(invalid));
    assert.deepEqual(await response.json(), { error: "That page cursor is invalid." });
    assert.equal(mock.calls.filter((call) => call.sql.includes("FROM posts p JOIN")).length, 0);
  }
});

test("an empty suggestions board returns an empty decorated page", async () => {
  const mock = mockDb(suggestionFeedRoutes([]));
  const response = await route(
    new Request("https://forum.example/api/posts?board=suggestions",
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.posts, []);
  assert.equal(body.nextBefore, null);
});

test("more than 20 suggestions paginate one page of 20 with a cursor", async () => {
  const rows = [];
  for (let i = 0; i < 21; i++) {
    rows.push(postRow({
      id: String(100 - i),
      // Descending-score order: 18 positive rows, then the tail dips below
      // zero so the emitted cursor exercises a negative score half.
      like_count: i < 19 ? Math.floor(i / 2) : 0,
      dislike_count: i < 19 ? 0 : i === 19 ? 3 : 5,
      created_at: 1700000000 + i,
      last_activity_at: 1700000000 + i,
    }));
  }
  const mock = mockDb(suggestionFeedRoutes(rows));
  const response = await route(
    new Request("https://forum.example/api/posts?board=suggestions",
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.posts.length, 20);
  // The 20th shown row (i = 19): score 0 − 3 = −3, id 81.
  assert.equal(body.nextBefore, "-3_81");
});

// --- Create: the board field -------------------------------------------------

const postInsertRoute = {
  sql: /INSERT INTO posts/,
  runMeta: { meta: { changes: 1, last_row_id: 900 } },
};
const postCreateRoutes = [sessionRoute, banCheckRoute, postInsertRoute, { sql: /./ }];

async function createPost(mock, payload) {
  const siteverifyPayload = { success: true, action: "post", hostname: "forum.example" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(siteverifyPayload), { status: 200 });
  try {
    return await route(
      requestFor("https://forum.example/api/posts", "POST", {
        body: "a suggestion post",
        "cf-turnstile-response": "turnstile-token-fixture",
        ...payload,
      }),
      envFor(mock.db),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a create with board=suggestions writes the board column value", async () => {
  const mock = mockDb(postCreateRoutes);
  const response = await createPost(mock, { board: "suggestions" });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 900 });
  const insert = mock.calls.find((call) => /INSERT INTO posts/.test(call.sql));
  assert.ok(insert.sql.includes(
    "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board)",
  ));
  // Bind order: author, body, created, last_activity, BOARD, ban user, now.
  assert.equal(insert.values[0], 7);
  assert.equal(insert.values[1], "a suggestion post");
  assert.equal(insert.values[4], "suggestions", "the composer-chosen board lands on the root");
  assert.equal(insert.values[5], 7);
  assert.equal(insert.values[6], insert.values[2], "the ban check's now matches the stamps");
  return null;
});

test("a create without a board field defaults to 'general'", async () => {
  const mock = mockDb(postCreateRoutes);
  const response = await createPost(mock, {});
  assert.equal(response.status, 201);
  const insert = mock.calls.find((call) => /INSERT INTO posts/.test(call.sql));
  assert.equal(insert.values[4], "general");
});

test("an invalid board value on create is a 400 and never inserts", async () => {
  // "" and null deliberately DEFAULT to 'general' (same as absent), so the
  // invalid set is only non-string junk and out-of-whitelist strings.
  for (const board of ["weird", 5, ["suggestions"], "Suggestions", true]) {
    const mock = mockDb(postCreateRoutes);
    const response = await createPost(mock, { board });
    assert.equal(response.status, 400, JSON.stringify(board));
    assert.deepEqual(await response.json(), { error: "That board is not available." });
    assert.equal(mock.calls.filter((call) => /INSERT INTO posts/.test(call.sql)).length, 0,
      "no insert may run for an invalid board");
  }
});

test("an empty-string board field defaults to 'general', never errors", async () => {
  const mock = mockDb(postCreateRoutes);
  const response = await createPost(mock, { board: "" });
  assert.equal(response.status, 201);
  const insert = mock.calls.find((call) => /INSERT INTO posts/.test(call.sql));
  assert.equal(insert.values[4], "general");
});

// --- Replies: the board inherits the thread root -----------------------------

const replyInsertResult = { meta: { changes: 1, last_row_id: 500 } };

test("a reply to a suggestions root carries the root's board", async () => {
  const root = postRow({ id: "1", board: "suggestions" });
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    { sql: /WHERE p\.id = \? LIMIT 1/, result: (values) => (values[1] === 1 ? root : null) },
    { sql: /./ },
  ], { batchMeta: [replyInsertResult] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: true, action: "reply", hostname: "forum.example" }),
      { status: 200 });
  try {
    const response = await route(
      requestFor("https://forum.example/api/posts/1/replies", "POST", {
        body: "a reply in the suggestions thread",
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
    assert.equal(response.status, 201);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const [replyInsert] = mock.batches[0];
  assert.equal(replyInsert.sql, THREAD_REPLY_INSERT_SQL);
  // Board sits after the timestamps, before the guard binds.
  assert.equal(replyInsert.values[5], "suggestions", "replies inherit the root's board");
  assert.equal(replyInsert.values[6], 1, "guard checks the root target itself");
});

test("a reply to a level-1 comment of a suggestions thread inherits the thread root's board", async () => {
  // root 1 ('suggestions') <- level-1 reply 2. The route resolves the ROOT
  // through the level-1 parent, mirroring the bump logic.
  const root = postRow({ id: "1", board: "suggestions" });
  const level1 = postRow({
    id: "2", author_id: "5", parent_id: "1", body: "level one",
    board: "suggestions", parent_body: "root body",
  });
  const mock = mockDb([
    sessionRoute,
    banCheckRoute,
    {
      sql: /WHERE p\.id = \? LIMIT 1/,
      result: (values) => (values[1] === 1 ? root : values[1] === 2 ? level1 : null),
    },
    { sql: /./ },
  ], { batchMeta: [replyInsertResult] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: true, action: "reply", hostname: "forum.example" }),
      { status: 200 });
  try {
    const response = await route(
      requestFor("https://forum.example/api/posts/2/replies", "POST", {
        body: "a sub-reply",
        "cf-turnstile-response": "turnstile-token-fixture",
      }),
      envFor(mock.db),
    );
    assert.equal(response.status, 201);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const [replyInsert] = mock.batches[0];
  assert.equal(replyInsert.values[5], "suggestions",
    "the level-1 target's own row carries the root board, and the write uses it");
});

// --- Frontend glue: /suggestions exists in the registry and the header -------
// app.js's route renderer is DOM-bound (untestable under node --test), so the
// route/nav pins here cover the registry, the static header anchor, and the
// composer payload boundary (buildComposerBody board field, in
// frontend-glue.test.mjs) that together wire theSuggestions composer.

test("the frontend wires the Suggestions route, header link, composer board, and empty state", () => {
  // app.js's renderers are DOM-bound, so the route/nav glue pins live at the
  // source level: the registry entry, the header nav anchor (rendered next to
  // the existing account/section links by renderAccountNavigation), the
  // composer's board dataset flag, and the board's empty-state copy.
  const appJs = readFileSync(path.join(repoRoot, "public", "js", "app.js"), "utf8");
  // The header link exists for guests and members alike.
  assert.match(appJs, /suggestions\.href = "\/suggestions";/);
  assert.match(appJs, /createComposer\(\s*"post-create",[\s\S]*?SUGGESTIONS_BOARD,\s*\)/);
  // The route renderer fetches the board feed WRAPPED in the exact
  // { feed: ... } shape renderHomeRoute builds (api() returns the body
  // unwrapped: {posts, nextBefore}) and rides the same load-more action with
  // the board tag.
  assert.match(appJs, /\{ feed: await api\("\/api\/posts\?board=suggestions"\) \}/);
  assert.match(appJs, /older\.dataset\.board = SUGGESTIONS_BOARD;/);
  // loadMorePosts propagates the board onto the follow-up cursor button.
  assert.match(appJs, /if \(board\) next\.dataset\.board = board;/);
  assert.match(appJs, /SUGGESTIONS_EMPTY_TEXT = "No suggestions yet — be the first!";/);
  // The payload boundary: submitNewPost is the only post-create submit path
  // and always forwards the form's board dataset to buildComposerBody.
  assert.match(appJs, /board: form\.dataset\.board,/);
  // The router registry knows the path.
  const routerJs = readFileSync(path.join(repoRoot, "public", "js", "router.js"), "utf8");
  assert.match(routerJs, /pathname === "\/suggestions"\) return \{ name: "suggestions" \}/);
  // The account nav renders the link for signed-out viewers too.
  assert.match(appJs, /accountActions\.append\(suggestions\);\s*\n\s*if \(!user\)/);
});
test("a shared score across a page boundary skips or duplicates no rows", async () => {
  // Every fixture thread ties at score 0 (zero reactions on all of them): the
  // id half of the composite key is the only tiebreak, so the cursor must
  // carry the last SHOWN row's id and the keyset must be strictly exclusive
  // on (score, id) — mirroring the equal-activity pins the general feed has.
  const tiedRows = [];
  for (let i = 0; i < 21; i++) {
    tiedRows.push(postRow({
      id: String(100 - i),
      board: "suggestions",
      body: "tied suggestion " + i,
      created_at: 1700000000 + i,
      last_activity_at: 1700000000 + i,
    }));
  }

  // Page 1 (no cursor): ids 100..81 shown, cursor = (score 0, id 81).
  const pageOne = mockDb(suggestionFeedRoutes(tiedRows));
  const pageOneResponse = await route(
    new Request("https://forum.example/api/posts?board=suggestions",
      { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(pageOne.db),
  );
  assert.equal(pageOneResponse.status, 200);
  const pageOneBody = await pageOneResponse.json();
  assert.equal(pageOneBody.posts.length, 20);
  assert.equal(pageOneBody.nextBefore, "0_81",
    "the cursor must carry the last SHOWN row's (score, id) at a shared score");

  // Page 2 walks strictly below (0, 81): the keyset binds exclude the shown
  // boundary row and every row above it, so the tied page-one ids can neither
  // repeat nor hide the continuation.
  const pageTwo = mockDb(suggestionFeedRoutes(tiedRows.slice(20)));
  const pageTwoResponse = await route(
    new Request("https://forum.example/api/posts?board=suggestions&before=" +
      encodeURIComponent(pageOneBody.nextBefore),
    { headers: { "CF-Connecting-IP": "192.0.2.9" } }),
    envFor(pageTwo.db),
  );
  assert.equal(pageTwoResponse.status, 200);
  const pageTwoBody = await pageTwoResponse.json();
  const pageTwoFeedCall = pageTwo.calls.find((call) => call.sql.includes("FROM posts p JOIN"));
  assert.deepEqual(pageTwoFeedCall.values, [-1, 0, 0, 81],
    "the keyset binds carry the cursor's score twice and the boundary id once");
  const pageTwoIds = pageTwoBody.posts.map((post) => post.id);
  assert.deepEqual(pageTwoIds, [80]);
  assert.deepEqual(
    pageOneBody.posts.map((post) => post.id).filter((id) => pageTwoIds.includes(id)),
    [],
    "no row may repeat across the page turn",
  );
  assert.equal(pageOneBody.posts.length + pageTwoBody.posts.length, 21,
    "every tied row appears exactly once across the walk");
});
