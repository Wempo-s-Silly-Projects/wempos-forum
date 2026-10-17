// Pinning (C5): admin pin/unpin endpoints (moderators or admin, desk idiom),
// the home feed's pinned-first ordering, the payload's pinnedAt, and the
// card's Pinned chip + moderator pin controls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import forumWorker from "../worker.mjs";
import { listRootPosts } from "../api/posts.mjs";

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

// --- the admin endpoints --------------------------------------------------------

const threadRoute = (post) => ({
  sql: /^SELECT id, parent_id, pinned_at, title FROM posts WHERE id = \? LIMIT 1$|^SELECT id, parent_id, pinned_at FROM posts WHERE id = \? LIMIT 1$/,
  result: () => post,
});
const pinUpdate = (changes = 1) => ({ sql: /UPDATE posts SET pinned_at/, runMeta: { meta: { changes } } });
const unpinUpdate = (changes = 1) => ({ sql: /UPDATE posts SET pinned_at = NULL/, runMeta: { meta: { changes } } });

test("a moderator pins and unpins a thread root", async () => {
  const moderator = mockDb([
    sessionRoute({ role: "moderator" }),
    banCheckRoute,
    threadRoute({ id: 5, parent_id: null, pinned_at: null }),
    pinUpdate(),
  ]);
  const pin = await forumWorker.fetch(
    requestFor("https://forum.example/api/admin/threads/5/pin", "POST"),
    envFor(moderator.db),
  );
  assert.equal(pin.status, 200, await pin.clone().text());
  const update = moderator.calls.find((call) => /UPDATE posts SET pinned_at/.test(call.sql));
  assert.ok(update, "the pin update runs (desk idiom: changes-checked)");
  assert.deepEqual(update.values.slice(1), [5], "the ROOT id only");
  assert.ok(update.sql.includes("pinned_at IS NULL"), "the SQL guard refuses a re-pin");

  const unpinned = mockDb([
    sessionRoute({ role: "admin" }),
    banCheckRoute,
    threadRoute({ id: 5, parent_id: null, pinned_at: 1700000000 }),
    unpinUpdate(),
  ]);
  const unpin = await forumWorker.fetch(
    requestFor("https://forum.example/api/admin/threads/5/unpin", "POST"),
    envFor(unpinned.db),
  );
  assert.equal(unpin.status, 200);
});

test("pin gates: member 403, guest 401, unknown thread 404, non-root 400, double pin 409", async () => {
  const root = { id: 5, parent_id: null, pinned_at: null };
  // Member (not moderator) → 403.
  const member = mockDb([sessionRoute({ role: "member" }), root]);
  const memberResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/admin/threads/5/pin", "POST"),
    envFor(member.db),
  );
  assert.equal(memberResponse.status, 403);
  assert.equal(member.calls.length, 1, "no database read beyond the session check");

  // Guest (GET-style no session) → 401.
  const guest = mockDb([{ sql: /./ }]);
  const guestResponse = await forumWorker.fetch(
    new Request("https://forum.example/api/admin/threads/5/pin", {
      method: "POST",
      headers: { Origin: "https://forum.example", "Content-Type": "application/json" },
      body: "{}",
    }),
    envFor(guest.db),
  );
  assert.equal(guestResponse.status, 401);

  // Unknown thread → 404.
  const unknown = mockDb([
    sessionRoute({ role: "moderator" }),
    banCheckRoute,
    threadRoute(null),
  ]);
  const unknownResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/admin/threads/9/pin", "POST"),
    envFor(unknown.db),
  );
  assert.equal(unknownResponse.status, 404);

  // A level-1 reply cannot be pinned.
  const reply = mockDb([
    sessionRoute({ role: "moderator" }),
    banCheckRoute,
    threadRoute({ id: 6, parent_id: 5, pinned_at: null }),
    pinUpdate(),
  ]);
  const replyResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/admin/threads/6/pin", "POST"),
    envFor(reply.db),
  );
  assert.equal(replyResponse.status, 400);
  assert.equal(reply.calls.some((call) => /UPDATE posts/.test(call.sql)), false);

  // Already-pinned → 409 (the 0-change ambiguity re-reads: the thread still exists).
  const twice = mockDb([
    sessionRoute({ role: "moderator" }),
    banCheckRoute,
    threadRoute({ id: 5, parent_id: null, pinned_at: 1700000000 }),
    pinUpdate(0),
    { sql: /SELECT id FROM posts WHERE id = \? LIMIT 1/, result: () => ({ id: 5 }) },
  ]);
  const twiceResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/admin/threads/5/pin", "POST"),
    envFor(twice.db),
  );
  assert.equal(twiceResponse.status, 409);

  // Unpin of an un-pinned thread → 409.
  const notPinned = mockDb([
    sessionRoute({ role: "moderator" }),
    banCheckRoute,
    threadRoute({ id: 5, parent_id: null, pinned_at: null }),
    unpinUpdate(0),
    { sql: /SELECT id FROM posts WHERE id = \? LIMIT 1/, result: () => ({ id: 5 }) },
  ]);
  const notPinnedResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/admin/threads/5/unpin", "POST"),
    envFor(notPinned.db),
  );
  assert.equal(notPinnedResponse.status, 409);

  // A thread DELETED between the read and the write is a 404, never a 409
  // (fix round 1: the dead ternary became an honest re-read).
  const vanished = mockDb([
    sessionRoute({ role: "moderator" }),
    banCheckRoute,
    threadRoute({ id: 5, parent_id: null, pinned_at: null }),
    pinUpdate(0),
    { sql: /SELECT id FROM posts WHERE id = \? LIMIT 1/, result: () => null },
  ]);
  const vanishedResponse = await forumWorker.fetch(
    requestFor("https://forum.example/api/admin/threads/5/pin", "POST"),
    envFor(vanished.db),
  );
  assert.equal(vanishedResponse.status, 404);
});

// --- the feed order ----------------------------------------------------------------

const postRow = (overrides = {}) => ({
  id: "1",
  author_id: "3",
  parent_id: "null",
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

test("the home feed orders pinned-first, then activity (cursor unchanged)", async () => {
  const mock = mockDb([
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/posts", { headers: { Cookie: "wempo_session=" + "s".repeat(43) } }),
    envFor(mock.db),
  );
  assert.equal(response.status, 200);
  const feedCall = mock.calls.find((call) => call.sql.startsWith("SELECT p.id"));
  // The pinned dimension sorts FIRST; the composite keyset then activity.
  assert.match(feedCall.sql, /ORDER BY \(p\.pinned_at IS NULL\) ASC, p\.last_activity_at DESC, p\.id DESC LIMIT 21/);
  // A cursor page rides the same unchanged (seconds, id) cursor.
  const cursorMock = mockDb([
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  await forumWorker.fetch(
    new Request("https://forum.example/api/posts?before=1700000100_5", { headers: { Cookie: "wempo_session=" + "s".repeat(43) } }),
    envFor(cursorMock.db),
  );
  const cursorCall = cursorMock.calls.find((call) => call.sql.startsWith("SELECT p.id"));
  assert.match(cursorCall.sql, /p\.last_activity_at < \? OR \(p\.last_activity_at = \? AND p\.id < \?\)/);
  assert.deepEqual(cursorCall.values, [-1, 1700000100, 1700000100, 5]);
});

test("the payload carries pinnedAt (ISO or null) and cards render the pinned chip", async () => {
  const { createPostCard } = await import("../public/js/render.js");
  const mockDocument = () => {
    function make(tag) {
      const node = {
        tagName: tag.toUpperCase(), children: [], className: "", textContent: "",
        dataset: {}, attributes: {}, style: {},
        append(...nodes) { for (const child of nodes) this.children.push(child); },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    replaceChildren(...kept) { for (const child of kept) if (child) this.children.push(child); },
      };
      return node;
    }
    return {
      createElement: (tag) => make(tag),
      createElementNS: (_ns, tag) => make(tag),
      createTextNode: (text) => { const node = make("#text"); node.textContent = text; return node; },
    };
  };
  function* walk(node) {
    yield node;
    for (const child of node.children ?? []) yield* walk(child);
  }
  const pinned = { id: 1, author: { username: "alice" }, createdAt: "2026-10-16T00:00:00.000Z", body: "x", pinnedAt: "2026-10-16T01:00:00.000Z" };
  const card = createPostCard(pinned, mockDocument(), null);
  const chip = [...walk(card)].find((node) => node.className?.includes("post-pinned"));
  assert.ok(chip, "the pinned chip renders");
  const chipText = [...walk(chip)].map((node) => node.textContent ?? "").join("");
  assert.match(chipText, /Pinned/);
  // Not-pinned (or pre-migration) rows render no chip.
  const plain = createPostCard({ ...pinned, pinnedAt: null }, mockDocument(), null);
  assert.equal([...walk(plain)].some((node) => node.className?.includes("post-pinned")), false);
  const undecorated = createPostCard(
    { id: 1, author: { username: "alice" }, createdAt: "2026-10-16T00:00:00.000Z", body: "x" },
    mockDocument(), null,
  );
  assert.equal([...walk(undecorated)].some((node) => node.className?.includes("post-pinned")), false);
});

test("moderators get the pin/unpin controls on root cards; members never do", async () => {
  const { createPostCard } = await import("../public/js/render.js");
  const mockDocument = () => {
    function make(tag) {
      const node = {
        tagName: tag.toUpperCase(), children: [], className: "", textContent: "",
        dataset: {}, attributes: {}, style: {},
        append(...nodes) { for (const child of nodes) this.children.push(child); },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
        replaceChildren(...kept) { for (const child of kept) if (child) this.children.push(child); },
      };
      return node;
    }
    return {
      createElement: (tag) => make(tag),
      createElementNS: (_ns, tag) => make(tag),
      createTextNode: (text) => { const node = make("#text"); node.textContent = text; return node; },
    };
  };
  function* walk(node) {
    yield node;
    for (const child of node.children ?? []) yield* walk(child);
  }
  const post = (overrides = {}) => ({
    id: 1, author: { username: "alice" }, createdAt: "2026-10-16T00:00:00.000Z",
    body: "x", publicLevel: 0, ...overrides,
  });
  const unpinControls = (card) => [...walk(card)].filter((node) =>
    node.dataset?.action === "thread-pin" || node.dataset?.action === "thread-unpin");
  const root = createPostCard(post(), mockDocument(), { id: 9, username: "mod", role: "moderator" });
  const buttons = unpinControls(root);
  assert.ok(buttons.length === 1, "a root card shows ONE control (pin or unpin)");
  assert.equal(buttons[0].dataset.action, "thread-pin");
  const pinnedRoot = createPostCard(post({ pinnedAt: "2026-10-16T01:00:00.000Z" }), mockDocument(), { id: 9, username: "mod", role: "moderator" });
  const pinnedControls = unpinControls(pinnedRoot);
  assert.equal(pinnedControls[0].dataset.action, "thread-unpin");
  // A member (or a guest, or a moderator looking at a reply) never gets one.
  assert.equal(unpinControls(createPostCard(post(), mockDocument(), { id: 7, role: "member" })).length, 0);
  assert.equal(unpinControls(createPostCard(post(), mockDocument(), null)).length, 0);
  const reply = createPostCard(
    { ...post(), publicLevel: 1, parent: { id: 1 } }, mockDocument(), { id: 9, role: "moderator" },
  );
  assert.equal(unpinControls(reply).length, 0, "only thread roots carry pin controls");
});

// --- app.js wiring (source pins — node-unimportable) --------------------------------

test("app.js wires thread-pin/thread-unpin behind the shared click delegation", () => {
  const appJs = readFileSync(path.join(repoRoot, "public", "js", "app.js"), "utf8");
  assert.match(appJs, /api\("\/api\/admin\/threads\/" \+ button\.dataset\.postId \+ "\/pin"/);
  assert.match(appJs, /api\("\/api\/admin\/threads\/" \+ button\.dataset\.postId \+ "\/unpin"/);
  assert.match(appJs, /"thread-pin": async/);
  assert.match(appJs, /"thread-unpin": async/);
});
// --- fix round 1: POST_SELECT projects pinned_at --------------------------------

test("POST_SELECT explicitly projects p.pinned_at and publicPost maps it to pinnedAt", async () => {
  const { POST_SELECT, publicPost } = await import("../api/shared.mjs");
  // CRITICAL 2 regression pin: without the column, publicPost's pinnedAt was
  // permanently null — the chip never rendered and mods saw a stale Pin button
  // that 409'd server-side.
  assert.match(POST_SELECT, /p\.pinned_at, /);
  const stamped = publicPost({ id: "1", author_id: "3", pinned_at: 1700000000,
    body: "x", created_at: 1700000000, last_activity_at: 1700000005 }, 0);
  assert.equal(stamped.pinnedAt, new Date(1700000000 * 1000).toISOString());
  // Honest mapping: rows without the projected column (pre-migration fixtures)
  // normalize to null, never undefined.
  const unstamped = publicPost({ id: "1", author_id: "3", body: "x", created_at: 1 }, 0);
  assert.equal(unstamped.pinnedAt, null);
});
