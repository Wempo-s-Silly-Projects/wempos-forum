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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// The search module (api/full-search.mjs, api/search-index.mjs; the index in
// its own SEARCH_DB database, migrations-search/): off is gone (404, no page,
// no UI), including when SEARCH_DB is missing; nothing search-related lives in
// the shared database's migrations; the visibility law on every result
// (hidden, banned, blocked both ways, non-viewable ancestors) even when the
// index is stale; FTS5 syntax can't be injected; write-path sync is
// best-effort and never fails a write; spoilers are masked in the index and
// in excerpts; the bind budget; the cursor walks; the owner's rebuild prunes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker.mjs";
import { D1Database, makeAssets, makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, makeRequest, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import {
  D1_MAX_BOUND_PARAMS, FEED_PAGE_SIZE, SEARCH_FTS_BACKFILL_BATCH, SEARCH_FTS_CANDIDATES, SEARCH_FTS_MAX_TERMS,
  SEARCH_FTS_QUERY_MAX_CHARS,
} from "../constants.mjs";
import { moduleForPath } from "../api/core/modules.mjs";
import { assemblePage, matchExpression, searchExcerpt, searchTerms } from "../api/full-search.mjs";
import { syncSearchPosts } from "../api/search-index.mjs";
import { ROUTE_MODULE_LOADERS, ROUTE_OWNERS } from "../public/js/route-modules.js";
import { routeForPath, routeModuleId } from "../public/js/router.js";
import { fullSearchPagePath } from "../public/js/search-filters.js";
import { highlightTerms } from "../public/js/search-highlight.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const shellAssets = () => makeAssets(async () => new Response(
  "<!doctype html><html><head><title>t</title></head><body>shell</body></html>",
  { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
));

// A fresh SEARCH_DB: node:sqlite with migrations-search/ applied.
function makeSearchDb() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("migrations-search/", ROOT)).sort()) {
    sqlite.exec(read("migrations-search/" + file));
  }
  return { db: new D1Database(sqlite), sqlite };
}

const storeModule = (env, on) => env.__sqlite
  .prepare("INSERT OR REPLACE INTO instance_modules (id, enabled, updated_at, updated_by) VALUES ('search', ?, 1, NULL)")
  .run(on ? 1 : 0);

function onEnv(overrides = {}) {
  const search = makeSearchDb();
  const env = makeEnv({ ASSETS: shellAssets(), HUMAN_CHECK: "off", SEARCH_DB: search.db, ...overrides });
  env.__search = search.sqlite;
  storeModule(env, true);
  return env;
}

// Index every post's RAW body, whatever its visibility: a deliberately stale
// index, so the read path's own visibility check is what is under test.
function indexRaw(env) {
  const insert = env.__search.prepare("INSERT OR REPLACE INTO post_search (rowid, body) VALUES (?, ?)");
  for (const row of env.__sqlite.prepare("SELECT id, body FROM posts").all()) insert.run(row.id, row.body);
}
const indexed = (env, id) => env.__search.prepare("SELECT COUNT(*) AS n FROM post_search WHERE rowid = ?").get(id).n;

// A worker call whose waitUntil work is awaited before returning.
async function callSettled(env, path, options) {
  const pending = [];
  const response = await worker.fetch(makeRequest(path, options), env, { waitUntil: (task) => pending.push(task) });
  await Promise.all(pending);
  return response;
}

// Stored roles: 'admin' is the public owner, 'moderator' the public admin.
let serial = 0;
async function member(env, role = "member") {
  serial += 1;
  const username = `fs${role}${serial}`;
  const id = await seedUser(env.__sqlite, { username, role });
  return { id, username, session: forgeSession(env.__sqlite, id) };
}

const block = (env, blockerId, blockedId) => env.__sqlite
  .prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(blockerId, blockedId, now());

const search = async (env, q, { session, sort, cursor } = {}) => {
  const params = new URLSearchParams({ q });
  if (sort) params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
  const response = await call(env, "/api/search/full?" + params.toString(), { session });
  return { status: response.status, body: await response.json() };
};
const ids = (result) => result.body.posts.map((post) => post.id).sort((a, b) => a - b);
const rebuild = async (env, session) => {
  let after = 0;
  for (let round = 0; round < 50; round++) {
    const step = await (await call(env, "/api/search/backfill", { method: "POST", session, body: { after } })).json();
    after = step.after;
    if (step.done) return;
  }
  throw new Error("rebuild did not finish");
};

// ------------------------------------------------------------- module off / setup

test("module off (the default): /api/search/full and the backfill answer 404, the classic search stays", async () => {
  const env = makeEnv({ ASSETS: shellAssets(), HUMAN_CHECK: "off", SEARCH_DB: makeSearchDb().db });
  const owner = await member(env, "admin");
  seedPost(env.__sqlite, { authorId: owner.id, body: "zebra crossing" });
  const response = await call(env, "/api/search/full?q=zebra");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "not_found");
  const backfill = await call(env, "/api/search/backfill", { method: "POST", session: owner.session, body: {} });
  assert.equal(backfill.status, 404);
  const classic = await call(env, "/api/search?q=zebra");
  assert.equal(classic.status, 200);
  assert.equal((await classic.json()).posts.length, 1);
  assert.equal(moduleForPath("/api/search"), null);
  assert.equal(moduleForPath("/api/search/full"), "search");
});

test("setup: without the SEARCH_DB binding the module stays off even when the owner stored it on", async () => {
  const env = makeEnv({ ASSETS: shellAssets(), HUMAN_CHECK: "off" });
  storeModule(env, true);
  assert.equal((await call(env, "/api/search/full?q=zebra")).status, 404);
  const page = await worker.fetch(new Request(ORIGIN + "/search?q=zebra"), env, {});
  assert.equal(page.status, 404);
  // A post write with no SEARCH_DB does nothing search-related and succeeds.
  const author = await member(env);
  const created = await callSettled(env, "/api/posts", {
    method: "POST", session: author.session, body: { body: "no index here", board: "general" },
  });
  assert.equal(created.status, 201);
});

test("module off: /search is the honest not-found page and the meta lists search; on, it is a 200 page", async () => {
  const env = makeEnv({ ASSETS: shellAssets(), HUMAN_CHECK: "off", SEARCH_DB: makeSearchDb().db });
  const off = await worker.fetch(new Request(ORIGIN + "/search?q=cats"), env, {});
  assert.equal(off.status, 404);
  assert.match(await off.text(), /<meta name="site-modules-off" content="[^"]*\bsearch\b[^"]*">/);
  const classic = await worker.fetch(new Request(ORIGIN + "/?q=cats"), env, {});
  assert.equal(classic.status, 200);
  storeModule(env, true);
  const on = await worker.fetch(new Request(ORIGIN + "/search?q=cats"), env, {});
  assert.equal(on.status, 200);
  assert.doesNotMatch(await on.text(), /<meta name="site-modules-off" content="[^"]*\bsearch\b/);
});

test("browser: /search routes to the lazy full-search page; off, app.js paints not-found; the header box opens it only when on", () => {
  assert.deepEqual(routeForPath("/search", "?q=cats"), { name: "full-search", query: "cats" });
  assert.deepEqual(routeForPath("/search", "?q=cats&sort=new"), { name: "full-search", query: "cats", sort: "new" });
  assert.deepEqual(routeForPath("/search", ""), { name: "full-search", query: "" });
  assert.equal(routeForPath("/", "?q=cats").name, "search");
  assert.equal(routeModuleId("full-search"), "search");
  assert.equal(routeModuleId("search"), null);
  assert.equal(ROUTE_OWNERS["full-search"], "full-search");
  assert.equal(typeof ROUTE_MODULE_LOADERS["full-search"], "function");
  assert.doesNotMatch(read("public/js/app.js"), /routes\/full-search\.js/);
  assert.match(read("public/js/app.js"), /if \(pageModule && !siteModuleOn\(pageModule\)\) return renderRoute\(\{ name: "not-found" \}\)/);
  assert.match(read("public/js/routes/pages.js"),
    /siteModuleOn\("search"\) \? fullSearchPagePath\(query\) : searchPagePath\(query\)/);
  assert.equal(fullSearchPagePath("a b"), "/search?q=a+b");
  assert.equal(fullSearchPagePath("a", "new"), "/search?q=a&sort=new");
});

// ------------------------------------------------------------- the shared database stays clean

test("shared database: no virtual table, fts5 or trigger for search in migrations/; the index has its own dir", () => {
  for (const file of readdirSync(new URL("migrations/", ROOT))) {
    const sql = read("migrations/" + file).replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /VIRTUAL\s+TABLE|fts5|post_search/i, file);
  }
  const files = readdirSync(new URL("migrations-search/", ROOT));
  assert.deepEqual(files, ["0001_search_index.sql"]);
  const sql = read("migrations-search/0001_search_index.sql").replace(/--.*$/gm, "");
  assert.match(sql, /CREATE VIRTUAL TABLE IF NOT EXISTS post_search USING fts5\(/);
  assert.match(sql, /tokenize = 'unicode61 remove_diacritics 2'/);
  assert.doesNotMatch(sql, /\b(TRIGGER|ALTER|DROP)\b/i);
  const toml = read("wrangler.toml");
  assert.match(toml, /binding = "SEARCH_DB"\ndatabase_name = "wempo-forum-search"\ndatabase_id = "ecf80a34-60c5-4151-94c5-b6490cdd7de2"\nmigrations_dir = "migrations-search"/);
  assert.match(read("wrangler.example.toml"), /# binding = "SEARCH_DB"/);
});

// ------------------------------------------------------------- basics

test("on: matches every word (AND), diacritic-insensitive, replies link to their thread", async () => {
  const env = onEnv();
  const author = await member(env);
  const root = seedPost(env.__sqlite, { authorId: author.id, body: "Our Café opens on Monday" });
  const reply = seedPost(env.__sqlite, { authorId: author.id, body: "the cafe has great tea", parentId: root });
  const deep = seedPost(env.__sqlite, { authorId: author.id, body: "tea and cafe again", parentId: reply });
  seedPost(env.__sqlite, { authorId: author.id, body: "only tea here" });
  indexRaw(env);
  const result = await search(env, "CAFE tea");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.terms, ["cafe", "tea"]);
  assert.deepEqual(ids(result), [reply, deep]);
  for (const post of result.body.posts) assert.equal(post.threadId, root);
  assert.deepEqual(ids(await search(env, "café")), [root, reply, deep]);
  assert.deepEqual(Object.keys(result.body.posts[0]).sort(),
    ["author", "board", "createdAt", "excerpt", "id", "parentId", "threadId"]);
  assert.deepEqual((await search(env, "   ")).body, { terms: [], posts: [], nextCursor: null });
});

test("limits: query length cap, term cap, bad sort, bad cursor, rate limit", async () => {
  const env = onEnv();
  assert.equal((await search(env, "a".repeat(SEARCH_FTS_QUERY_MAX_CHARS + 1))).status, 400);
  const many = Array.from({ length: SEARCH_FTS_MAX_TERMS + 1 }, (_, i) => "w" + i).join(" ");
  assert.equal((await search(env, many)).status, 400);
  const enough = Array.from({ length: SEARCH_FTS_MAX_TERMS }, (_, i) => "w" + i).join(" ");
  assert.equal((await search(env, enough)).status, 200);
  assert.equal((await search(env, "x", { sort: "oldest" })).status, 400);
  for (const cursor of ["abc", "0", "1_2_3", "-1.5", "x_5"]) {
    assert.equal((await search(env, "x", { cursor })).status, 400, cursor);
  }
  assert.equal((await search(env, "x", { sort: "new", cursor: "1.5_3" })).status, 400);
  const limited = onEnv({ READ_RATE_LIMITER: makeLimiters(false).limiter });
  assert.equal((await search(limited, "x")).status, 429);
});

// ------------------------------------------------------------- visibility law (stale index)

async function visibilityWorld() {
  const env = onEnv();
  const author = await member(env);
  const banned = await member(env);
  const lapsed = await member(env);
  const viewer = await member(env);
  const blocker = await member(env);
  const blockee = await member(env);
  const admin = await member(env, "moderator");
  const W = "quokka";
  const posts = {
    visible: seedPost(env.__sqlite, { authorId: author.id, body: `${W} visible root` }),
    hidden: seedPost(env.__sqlite, { authorId: author.id, body: `${W} hidden root`, visibility: "hidden" }),
    banned: seedPost(env.__sqlite, { authorId: banned.id, body: `${W} by a banned member` }),
    lapsed: seedPost(env.__sqlite, { authorId: lapsed.id, body: `${W} by an expired ban` }),
    byBlocker: seedPost(env.__sqlite, { authorId: blocker.id, body: `${W} by someone who blocked the viewer` }),
    byBlockee: seedPost(env.__sqlite, { authorId: blockee.id, body: `${W} by someone the viewer blocked` }),
  };
  const hiddenRoot = seedPost(env.__sqlite, { authorId: author.id, body: "plain hidden root", visibility: "hidden" });
  posts.underHidden = seedPost(env.__sqlite, { authorId: author.id, body: `${W} reply under hidden`, parentId: hiddenRoot });
  posts.deepUnderHidden = seedPost(env.__sqlite, {
    authorId: author.id, body: `${W} level-2 under hidden`, parentId: posts.underHidden,
  });
  const bannedRoot = seedPost(env.__sqlite, { authorId: banned.id, body: "plain banned root" });
  posts.underBanned = seedPost(env.__sqlite, { authorId: author.id, body: `${W} reply under banned`, parentId: bannedRoot });
  const blockerRoot = seedPost(env.__sqlite, { authorId: blocker.id, body: "plain blocker root" });
  posts.underBlocker = seedPost(env.__sqlite, { authorId: author.id, body: `${W} reply under blocker`, parentId: blockerRoot });
  seedBan(env.__sqlite, banned.id);
  seedBan(env.__sqlite, lapsed.id, -60);
  block(env, blocker.id, viewer.id);
  block(env, viewer.id, blockee.id);
  indexRaw(env);
  return { env, W, posts, viewer, admin, blocker, blockee };
}

test("visibility: guests never get hidden, banned-author or non-viewable-ancestor posts, even from a stale index", async () => {
  const { env, W, posts } = await visibilityWorld();
  assert.deepEqual(ids(await search(env, W)),
    [posts.visible, posts.lapsed, posts.byBlocker, posts.byBlockee, posts.underBlocker].sort((a, b) => a - b));
});

test("visibility: a signed-in viewer loses block-paired authors and ancestors in BOTH directions", async () => {
  const { env, W, posts, viewer } = await visibilityWorld();
  assert.deepEqual(ids(await search(env, W, { session: viewer.session })), [posts.visible, posts.lapsed]);
});

test("visibility: each side of a block pair loses the other's posts, and nobody else's", async () => {
  const { env, W, posts, blocker, blockee } = await visibilityWorld();
  const blockerView = ids(await search(env, W, { session: blocker.session }));
  assert.ok(blockerView.includes(posts.byBlockee));
  assert.ok(blockerView.includes(posts.byBlocker));
  assert.ok(ids(await search(env, W, { session: blockee.session })).includes(posts.byBlocker));
});

test("visibility: staff get the public face (no hidden or banned posts), without the member block filter", async () => {
  const { env, W, posts, admin } = await visibilityWorld();
  const result = ids(await search(env, W, { session: admin.session }));
  for (const key of ["hidden", "banned", "underHidden", "deepUnderHidden", "underBanned"]) {
    assert.ok(!result.includes(posts[key]), key);
  }
  assert.ok(result.includes(posts.visible));
});

test("visibility: an unban restores results with no index write", async () => {
  const { env, W, posts } = await visibilityWorld();
  env.__sqlite.prepare("UPDATE bans SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at IS NULL").run(now());
  const result = ids(await search(env, W));
  assert.ok(result.includes(posts.banned));
  assert.ok(result.includes(posts.underBanned));
});

// ------------------------------------------------------------- FTS5 syntax injection

test("syntax: user text never reaches MATCH as syntax (quotes, *, NEAR, OR, NOT, -, :, ^, parentheses)", async () => {
  const env = onEnv();
  const author = await member(env);
  const cats = seedPost(env.__sqlite, { authorId: author.id, body: "cats sleep all day" });
  const dogs = seedPost(env.__sqlite, { authorId: author.id, body: "dogs bark at night" });
  const both = seedPost(env.__sqlite, { authorId: author.id, body: "cats or dogs, near or far, not both" });
  indexRaw(env);
  const hostile = [
    "\"", "\"\"\"", "cats\"", "\"cats", "*", "cat*", "NEAR", "NEAR(cats dogs)", "cats NEAR dogs", "OR", "cats OR dogs",
    "NOT", "cats NOT dogs", "AND", "-", "-dogs", "cats -dogs", ":", "body:cats", "rowid:1", "^", "^cats", "(", ")",
    "(cats OR dogs)", "{body}: cats", "cats + dogs", "\\", "'", "'; DROP TABLE posts; --", "\u0000cats", "c\"a\"t\"s",
  ];
  for (const q of hostile) {
    const result = await search(env, q);
    assert.equal(result.status, 200, q);
    for (const term of result.body.terms) assert.doesNotMatch(term, /["*:^()-]/, q);
  }
  assert.deepEqual(ids(await search(env, "cats OR dogs")), [both]);
  assert.deepEqual(ids(await search(env, "(cats OR dogs)")), [both]);
  assert.deepEqual(ids(await search(env, "-dogs")), [dogs, both]);
  assert.deepEqual(ids(await search(env, "^cats")), [cats, both]);
  assert.deepEqual(ids(await search(env, "body:cats")), []);
  assert.deepEqual(ids(await search(env, "cat*")), []);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 3);
});

test("syntax: searchTerms keeps letter/digit/mark runs only; matchExpression quotes every term", () => {
  assert.deepEqual(searchTerms("Hello, \"World\"! NEAR(a b) x:y ^z -w o*"), ["hello", "world", "near", "a", "b", "x", "y", "z", "w", "o"]);
  assert.deepEqual(searchTerms("Café 東京 ١٢٣"), ["café", "東京", "١٢٣"]);
  assert.deepEqual(searchTerms("same Same SAME"), ["same"]);
  assert.equal(matchExpression(["near", "or"]), "\"near\" \"or\"");
  for (const raw of ["\"", "a\"b", "\"\"\"\"", "x\" OR \"y"]) {
    for (const term of searchTerms(raw)) assert.ok(!term.includes("\""), raw);
  }
});

// ------------------------------------------------------------- write-path sync

test("sync: create through the API indexes; an edit swaps old words for new; a delete removes it", async () => {
  const env = onEnv();
  const author = await member(env);
  const created = await callSettled(env, "/api/posts", {
    method: "POST", session: author.session, body: { body: "wombat burrows are cubic", board: "general" },
  });
  assert.equal(created.status, 201);
  const id = Number((await created.json()).id);
  assert.deepEqual(ids(await search(env, "wombat")), [id]);
  const reply = await callSettled(env, `/api/posts/${id}/replies`, {
    method: "POST", session: author.session, body: { body: "a wombat reply" },
  });
  assert.equal(reply.status, 201);
  assert.equal(ids(await search(env, "wombat")).length, 2);
  const edited = await callSettled(env, `/api/posts/${id}`, {
    method: "PATCH", session: author.session, body: { body: "platypus lays eggs" },
  });
  assert.equal(edited.status, 200);
  assert.equal(ids(await search(env, "burrows")).length, 0);
  assert.deepEqual(ids(await search(env, "platypus")), [id]);
  const deleted = await callSettled(env, `/api/posts/${id}`, { method: "DELETE", session: author.session });
  assert.equal(deleted.status, 200);
  assert.deepEqual(ids(await search(env, "platypus")), []);
  assert.equal(indexed(env, id), 0);
});

test("sync: hide and unhide through the desk remove and restore the index row", async () => {
  const env = onEnv();
  const admin = await member(env, "moderator");
  const author = await member(env);
  const created = await callSettled(env, "/api/posts", {
    method: "POST", session: author.session, body: { body: "narwhal tusks spiral", board: "general" },
  });
  const id = Number((await created.json()).id);
  assert.equal(indexed(env, id), 1);
  const hide = await callSettled(env, `/api/admin/users/${author.id}/hide-recent`, {
    method: "POST", session: admin.session, body: { count: 1 },
  });
  assert.equal(hide.status, 200);
  assert.equal(indexed(env, id), 0);
  assert.deepEqual(ids(await search(env, "narwhal")), []);
  const unhide = await callSettled(env, "/api/admin/posts/unhide", { method: "POST", session: admin.session, body: { ids: [id] } });
  assert.equal(unhide.status, 200);
  assert.equal(indexed(env, id), 1);
  assert.deepEqual(ids(await search(env, "narwhal")), [id]);
});

test("sync is non-blocking: a broken SEARCH_DB never fails a post write, and errors are swallowed", async () => {
  const throwing = {
    prepare() { throw new Error("search db down"); },
    async batch() { throw new Error("search db down"); },
  };
  const env = onEnv({ SEARCH_DB: throwing });
  const author = await member(env);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    const created = await callSettled(env, "/api/posts", {
      method: "POST", session: author.session, body: { body: "still posts fine", board: "general" },
    });
    assert.equal(created.status, 201);
    const id = Number((await created.json()).id);
    const edited = await callSettled(env, `/api/posts/${id}`, {
      method: "PATCH", session: author.session, body: { body: "still edits fine" },
    });
    assert.equal(edited.status, 200);
    const deleted = await callSettled(env, `/api/posts/${id}`, { method: "DELETE", session: author.session });
    assert.equal(deleted.status, 200);
    // Direct call: resolves (never rejects) and never throws synchronously.
    await syncSearchPosts(env, new Request(ORIGIN + "/"), [1]);
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((line) => /Search index sync failed/.test(line)), errors.join("\n"));
});

test("sync: the write returns before the index is written (the work is handed to waitUntil)", async () => {
  const env = onEnv();
  const author = await member(env);
  const pending = [];
  const response = await worker.fetch(makeRequest("/api/posts", {
    method: "POST", session: author.session, body: { body: "deferred dugong", board: "general" },
  }), env, { waitUntil: (task) => pending.push(task) });
  assert.equal(response.status, 201);
  assert.equal(pending.length, 1);
  await Promise.all(pending);
  assert.equal(ids(await search(env, "dugong")).length, 1);
});

// ------------------------------------------------------------- spoilers

test("spoilers: the index holds masked text (no spoiler word matches) and excerpts are masked before the cut", async () => {
  const env = onEnv();
  const owner = await member(env, "admin");
  const author = await member(env);
  const filler = "lorem ipsum ".repeat(30);
  seedPost(env.__sqlite, { authorId: author.id, body: `${filler} the ending: ||the butler did it|| says the axolotl` });
  const secret = seedPost(env.__sqlite, { authorId: author.id, body: "||secret axolotl plot twist|| nothing else" });
  seedPost(env.__sqlite, {
    authorId: author.id, body: `${filler} ||it was in the library with a candlestick, sadly|| axolotl`,
  });
  await rebuild(env, owner.session);
  const result = await search(env, "axolotl");
  assert.equal(result.body.posts.length, 2);
  assert.ok(!ids(result).includes(secret));
  assert.deepEqual(ids(await search(env, "butler")), []);
  assert.deepEqual(ids(await search(env, "candlestick")), []);
  for (const post of result.body.posts) {
    assert.doesNotMatch(post.excerpt, /butler|secret|plot twist|library|candlestick|sadly/);
    assert.ok(post.excerpt.startsWith("…"));
  }
  // A stale raw index: the post matches, but the excerpt still never shows it.
  indexRaw(env);
  const stale = await search(env, "axolotl");
  for (const post of stale.body.posts) assert.doesNotMatch(post.excerpt, /butler|secret|plot twist|library|candlestick|sadly/);
  assert.doesNotMatch(searchExcerpt("a ||hidden|| b", ["hidden"]), /hidden/);
  assert.doesNotMatch(read("api/full-search.mjs").replace(/\/\/.*$/gm, ""), /\b(?:snippet|highlight)\s*\(/);
});

test("client: every term is marked with text runs only", () => {
  assert.deepEqual(highlightTerms("Cats and DOGS", ["cats", "dogs"]), [
    { text: "Cats", hit: true }, { text: " and ", hit: false }, { text: "DOGS", hit: true },
  ]);
  assert.deepEqual(highlightTerms("", ["x"]), []);
});

// ------------------------------------------------------------- bind budget + paging

function recordBinds(db, sink, label) {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => { sink.push({ label, sql, count: values.length }); return bind(...values); };
    return statement;
  };
}

test("bind budget: a full page for a blocking viewer stays far under the bind cap; the cursor walks every visible post once", async () => {
  const env = onEnv();
  const viewer = await member(env);
  const authors = [];
  for (let i = 0; i < 4; i++) authors.push(await member(env));
  block(env, viewer.id, authors[3].id);
  const visible = [];
  for (let i = 0; i < FEED_PAGE_SIZE * 3 + 5; i++) {
    const repeats = " ibis".repeat(1 + (i % 4));
    visible.push(seedPost(env.__sqlite, { authorId: authors[i % 3].id, body: `post ${i}${repeats}` }));
    seedPost(env.__sqlite, { authorId: authors[3].id, body: `blocked ${i} ibis` });
  }
  indexRaw(env);
  const binds = [];
  recordBinds(env.FORUM_DB, binds, "forum");
  recordBinds(env.SEARCH_DB, binds, "search");
  for (const sort of ["relevant", "new"]) {
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const result = await search(env, "ibis", { session: viewer.session, sort, cursor });
      assert.equal(result.status, 200);
      assert.ok(result.body.posts.length <= FEED_PAGE_SIZE);
      seen.push(...result.body.posts.map((post) => post.id));
      cursor = result.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    assert.ok(pages >= 4 && pages < 20, sort + " pages " + pages);
    assert.deepEqual([...seen].sort((a, b) => a - b), visible, sort);
    assert.equal(new Set(seen).size, seen.length, sort);
  }
  const lookups = binds.filter((entry) => entry.label === "forum" && /json_each\(\?\) j JOIN posts/.test(entry.sql));
  const ranked = binds.filter((entry) => entry.label === "search" && /post_search MATCH/.test(entry.sql));
  assert.ok(lookups.length >= 8 && ranked.length >= 8);
  assert.ok(lookups.every((entry) => entry.count === 7), JSON.stringify(lookups.map((entry) => entry.count)));
  assert.ok(ranked.every((entry) => entry.count <= 4));
  assert.ok(binds.every((entry) => entry.count < D1_MAX_BOUND_PARAMS));
});

test("paging: a short page keeps a cursor while candidates remain; no candidates, no cursor", () => {
  const candidates = Array.from({ length: SEARCH_FTS_CANDIDATES }, (_, i) => ({ id: 1000 - i, score: -1 }));
  const none = assemblePage(candidates, new Map(), "new");
  assert.deepEqual(none.page, []);
  assert.equal(none.nextCursor, String(1000 - SEARCH_FTS_CANDIDATES + 1));
  const few = assemblePage(candidates.slice(0, 5), new Map([[1000, { id: 1000 }]]), "new");
  assert.equal(few.page.length, 1);
  assert.equal(few.nextCursor, null);
  const all = new Map(candidates.map((row) => [row.id, { id: row.id }]));
  const full = assemblePage(candidates, all, "relevant");
  assert.equal(full.page.length, FEED_PAGE_SIZE);
  assert.equal(full.nextCursor, "-1_" + String(1000 - FEED_PAGE_SIZE + 1));
});

// ------------------------------------------------------------- rebuild

test("rebuild: owner only, batched, idempotent; indexes old posts, masks spoilers, prunes deleted and hidden ids", async () => {
  const env = onEnv();
  const owner = await member(env, "admin");
  const admin = await member(env, "moderator");
  const author = await member(env);
  for (let i = 0; i < SEARCH_FTS_BACKFILL_BATCH + 1; i++) {
    seedPost(env.__sqlite, { authorId: author.id, body: `old post ${i} kakapo` });
  }
  const hidden = seedPost(env.__sqlite, { authorId: author.id, body: "hidden kakapo", visibility: "hidden" });
  assert.deepEqual(ids(await search(env, "kakapo")), []);
  const backfill = (session, body = {}) => call(env, "/api/search/backfill", { method: "POST", session, body });
  assert.ok([401, 403].includes((await call(env, "/api/search/backfill", { method: "POST", body: {} })).status));
  assert.equal((await backfill(author.session)).status, 403);
  assert.equal((await backfill(admin.session)).status, 403);
  assert.equal((await backfill(owner.session, { after: -1 })).status, 400);
  assert.equal((await backfill(owner.session, { after: "1" })).status, 400);
  const first = await (await backfill(owner.session)).json();
  assert.equal(first.indexed, SEARCH_FTS_BACKFILL_BATCH);
  assert.equal(first.done, false);
  const second = await (await backfill(owner.session, { after: first.after })).json();
  assert.equal(second.indexed, 1);
  assert.equal(second.done, true);
  const count = () => env.__search.prepare("SELECT COUNT(*) AS n FROM post_search").get().n;
  assert.equal(count(), SEARCH_FTS_BACKFILL_BATCH + 1);
  assert.equal(indexed(env, hidden), 0);
  // An index row above the newest post (a post deleted since) is pruned by
  // the rebuild's last batch while other posts remain.
  env.__search.prepare("INSERT INTO post_search (rowid, body) VALUES (888888, 'gone kakapo')").run();
  await rebuild(env, owner.session);
  assert.equal(indexed(env, 888888), 0);
  assert.equal(count(), SEARCH_FTS_BACKFILL_BATCH + 1);
  // Stale rows (a deleted account's posts, a hidden post, ids past the end)
  // are pruned by the next rebuild.
  indexRaw(env);
  env.__search.prepare("INSERT INTO post_search (rowid, body) VALUES (999999, 'ghost kakapo')").run();
  env.__sqlite.prepare("DELETE FROM users WHERE id = ?").run(author.id);
  assert.deepEqual(ids(await search(env, "kakapo")), []);
  await rebuild(env, owner.session);
  assert.equal(count(), 0);
  assert.equal((await call(env, "/api/search/backfill", { session: owner.session })).status, 405);
});

// ------------------------------------------------------------- strings

test("strings: the module's label, description and page strings exist in every locale and are translated", () => {
  const keys = ["modules.label.search", "modules.desc.search", "search.fullLabel", "search.fullHint", "search.fullEmpty",
    "search.fullClassic", "search.fullBuild", "search.fullBuilding", "search.fullBuilt"];
  const en = JSON.parse(read("public/locales/en.json"));
  const dir = new URL("public/locales/", ROOT);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 74);
  for (const file of files) {
    const table = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    for (const key of keys) assert.ok(typeof table[key] === "string" && table[key].trim(), `${file} ${key}`);
    if (file !== "en.json") {
      assert.deepEqual(keys.filter((key) => table[key] === en[key]), [], `${file} copies English`);
    }
  }
});
