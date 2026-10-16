// Bookmarks (C4): PUT/DELETE /api/posts/:id/bookmark (idempotent, any visible
// post) and the PRIVATE list at GET /api/me/bookmarks (own rows only, newest
// first). Cards carry the viewer's bookmark state when a member is asking.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import forumWorker from "../worker.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const bookmarkRoutes = (post) => [
  sessionRoute(),
  banCheckRoute,
  { sql: /WHERE p\.id = \? LIMIT 1/, result: () => post },
  banViewRouteOff,
  { sql: /./ },
];

test("PUT/DELETE bookmark round-trips and stays idempotent", async () => {
  const post = postRow({ id: "8" });
  const put = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/8/bookmark", "PUT"),
    envFor(mockDb(bookmarkRoutes(post)).db),
  );
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { ok: true, bookmarked: true });
  const insert = mockDb(bookmarkRoutes(post)).calls.find(() => false) ?? null;
  // The insert carries the guard (idempotent) and the (member, post, now) trio.
  const putAgain = mockDb(bookmarkRoutes(post));
  await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/8/bookmark", "PUT"),
    envFor(putAgain.db),
  );
  const insertCall = putAgain.calls.find((call) => /INSERT INTO bookmarks/.test(call.sql));
  assert.ok(insertCall, "a PUT inserts");
  assert.match(insertCall.sql, /WHERE NOT EXISTS/, "the bookmark insert is a guarded, idempotent insert");
  assert.deepEqual(insertCall.values.slice(0, 2), [7, 8]);

  const destroy = mockDb(bookmarkRoutes(post));
  const del = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/8/bookmark", "DELETE"),
    envFor(destroy.db),
  );
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { ok: true, bookmarked: false });
  const deleteCall = destroy.calls.find((call) => /DELETE FROM bookmarks/.test(call.sql));
  assert.deepEqual(deleteCall.values, [7, 8], "own rows only");
});

test("bookmark gates: guest 401, hidden post 404, wrong method 405", async () => {
  const guest = mockDb([{ sql: /./ }]);
  const guestResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/posts/1/bookmark", {
      method: "PUT",
      headers: { Origin: "https://forum.example", "Content-Type": "application/json" },
      body: "{}",
    }),
    envFor(guest.db),
  );
  assert.equal(guestResponse.status, 401);

  const hidden = mockDb(bookmarkRoutes(postRow({ id: "1", visibility: "hidden" })));
  const hiddenResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/bookmark", "PUT"),
    envFor(hidden.db),
  );
  assert.equal(hiddenResponse.status, 404);

  const wrong = mockDb([{ sql: /./ }]);
  const wrongResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/posts/1/bookmark", "PATCH"),
    envFor(wrong.db),
  );
  assert.equal(wrongResponse.status, 405);
  assert.equal(wrong.calls.length, 0);
});

test("GET /api/me/bookmarks is the member's own list, newest first; guests 401", async () => {
  const routes = mockDb([
    sessionRoute(),
    {
      sql: /JOIN bookmarks b ON b\.post_id = p\.id/,
      rows: [
        postRow({ id: "12", created_at: 1700000200 }),
        postRow({ id: "5", created_at: 1700000100 }),
      ],
    },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/me/bookmarks", {
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(routes.db),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.bookmarks.length, 2);
  assert.deepEqual(body.bookmarks.map((post) => post.id), [12, 5], "newest first (bookmark order)");
  assert.equal(
    routes.calls.find((call) => /JOIN bookmarks b ON/.test(call.sql)).values[0],
    7,
    "the list reads the session's own rows",
  );

  const guest = mockDb([{ sql: /./ }]);
  const guestResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/me/bookmarks"),
    envFor(guest.db),
  );
  assert.equal(guestResponse.status, 401);
  assert.equal(guest.calls.length, 0, "no database access before the membership gate");
});

test("the feed decorates the viewer's bookmark state; guests skip the query entirely", async () => {
  const member = mockDb([
    sessionRoute(),
    { sql: /FROM posts p JOIN users u/, rows: [postRow({ id: "1" })] },
    { sql: /SELECT post_id FROM bookmarks/, rows: [{ post_id: "1" }] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts", {
      headers: { Cookie: "wempo_session=" + "s".repeat(43) },
    }),
    envFor(member.db),
  );
  assert.equal(response.status, 200);
  const feed = (await response.json());
  assert.equal(feed.posts[0].viewerBookmarked, true);
  const decorated = member.calls.find((call) => /SELECT post_id FROM bookmarks/.test(call.sql));
  assert.deepEqual(decorated.values.slice(0, 2), [7, 1], "(member, post ids) decorate in one query");

  const guestMock = mockDb([
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  const guestResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/posts"),
    envFor(guestMock.db),
  );
  assert.equal((await guestResponse.json()).posts.length, 0);
  assert.equal(
    guestMock.calls.some((call) => /SELECT post_id FROM bookmarks/.test(call.sql)),
    false,
    "no bookmark query for guests",
  );
});

// --- the render ----------------------------------------------------------------

function mockDocument() {
  function make(tag) {
    const node = {
      tagName: tag.toUpperCase(), children: [], className: "", textContent: "",
      dataset: {}, attributes: {}, style: {},
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

const fixturePost = (overrides = {}) => ({
  id: 10,
  publicLevel: 0,
  author: { username: "alice" },
  createdAt: "2026-10-16T00:00:00.000Z",
  body: "save me",
  ...overrides,
});

test("cards render a bookmark toggle button for signed-in viewers, state-driven", async () => {
  const { createPostCard } = await import("../public/js/render.js");
  const member = { id: 7 };
  const card = createPostCard(fixturePost({ viewerBookmarked: true }), mockDocument(), member);
  const button = [...walk(card)].find((node) => node.dataset?.action === "toggle-bookmark");
  assert.ok(button, "members get the toggle");
  assert.equal(button.dataset.postId, "10");
  assert.equal(button.getAttribute("aria-pressed"), "true", "the saved state is marked");
  assert.ok([...walk(button)].some((node) => node.tagName === "SVG"), "a bookmark glyph rides the button");
  const unsaved = createPostCard(fixturePost({ viewerBookmarked: false }), mockDocument(), member);
  const off = [...walk(unsaved)].find((node) => node.dataset?.action === "toggle-bookmark");
  assert.equal(off.getAttribute("aria-pressed"), "false");
  // Un-decorated feed payloads (guests' rows, stale) render the toggle inert or
  // absent — absent for guests (the renderer gets no session user).
  const guest = createPostCard(fixturePost(), mockDocument(), null);
  assert.equal(
    [...walk(guest)].some((node) => node.dataset?.action === "toggle-bookmark"),
    false, "guests never get the toggle",
  );
});

// --- app.js + router wiring (source pins — node-unimportable) -------------------

test("app.js and the router wire the bookmarks route, nav link, and toggle handler", () => {
  const appJs = readFileSync(path.join(repoRoot, "public", "js", "app.js"), "utf8");
  const routerJs = readFileSync(path.join(repoRoot, "public", "js", "router.js"), "utf8");
  assert.match(routerJs, /pathname === "\/bookmarks"\) return \{ name: "bookmarks" \}/);
  assert.match(appJs, /api\("\/api\/me\/bookmarks"\)/);
  // The toggle handler sends PUT to save and DELETE to unsave, then re-renders.
  assert.match(appJs, /"toggle-bookmark": async/);
  assert.match(appJs, /\/api\/posts\/" \+ button\.dataset\.postId \+ "\/bookmark"/);
  // A bookmark nav entry renders for signed-in members only.
  assert.match(appJs, /dataset: { href: "\/bookmarks" }/);
});