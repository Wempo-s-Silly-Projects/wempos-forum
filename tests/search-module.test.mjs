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

// The search module (migration 0097, api/full-search.mjs): off is gone (404,
// no page, no UI); the visibility law on every result (hidden, banned,
// blocked both ways, non-viewable ancestors); FTS5 syntax can't be injected;
// the index follows create / edit / delete and the read follows hide /
// unhide / ban; the bind budget at a full page with a blocking viewer; the
// cursor walks; spoilers stay masked in excerpts; the owner's backfill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../worker.mjs";
import { makeAssets, makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import {
  D1_MAX_BOUND_PARAMS, FEED_PAGE_SIZE, SEARCH_FTS_BACKFILL_BATCH, SEARCH_FTS_MAX_TERMS, SEARCH_FTS_QUERY_MAX_CHARS,
} from "../constants.mjs";
import { moduleForPath } from "../api/core/modules.mjs";
import { matchExpression, searchExcerpt, searchTerms } from "../api/full-search.mjs";
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

const storeModule = (env, on) => env.__sqlite
  .prepare("INSERT OR REPLACE INTO instance_modules (id, enabled, updated_at, updated_by) VALUES ('search', ?, 1, NULL)")
  .run(on ? 1 : 0);

function onEnv(overrides = {}) {
  const env = makeEnv({ ASSETS: shellAssets(), HUMAN_CHECK: "off", ...overrides });
  storeModule(env, true);
  return env;
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

// ------------------------------------------------------------- module off

test("module off (the default): /api/search/full and the backfill answer 404, the classic search stays", async () => {
  const env = makeEnv({ ASSETS: shellAssets(), HUMAN_CHECK: "off" });
  const owner = await member(env, "admin");
  seedPost(env.__sqlite, { authorId: owner.id, body: "zebra crossing" });
  const read = await call(env, "/api/search/full?q=zebra");
  assert.equal(read.status, 404);
  assert.equal((await read.json()).code, "not_found");
  const backfill = await call(env, "/api/search/backfill", { method: "POST", session: owner.session, body: {} });
  assert.equal(backfill.status, 404);
  const classic = await call(env, "/api/search?q=zebra");
  assert.equal(classic.status, 200);
  assert.equal((await classic.json()).posts.length, 1);
  assert.equal(moduleForPath("/api/search"), null);
  assert.equal(moduleForPath("/api/search/full"), "search");
});

test("module off: /search is the honest not-found page and the meta lists search; on, it is a 200 page", async () => {
  const env = makeEnv({ ASSETS: shellAssets(), HUMAN_CHECK: "off" });
  const off = await worker.fetch(new Request(ORIGIN + "/search?q=cats"), env, {});
  assert.equal(off.status, 404);
  assert.match(await off.text(), /<meta name="site-modules-off" content="[^"]*\bsearch\b[^"]*">/);
  // The classic search page is core: not a 404 while the module is off.
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

// ------------------------------------------------------------- basics

test("on: matches every word (AND), diacritic-insensitive, replies link to their thread", async () => {
  const env = onEnv();
  const author = await member(env);
  const root = seedPost(env.__sqlite, { authorId: author.id, body: "Our Café opens on Monday" });
  const reply = seedPost(env.__sqlite, { authorId: author.id, body: "the cafe has great tea", parentId: root });
  const deep = seedPost(env.__sqlite, { authorId: author.id, body: "tea and cafe again", parentId: reply });
  seedPost(env.__sqlite, { authorId: author.id, body: "only tea here" });
  const result = await search(env, "CAFE tea");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.terms, ["cafe", "tea"]);
  assert.deepEqual(ids(result), [reply, deep]);
  for (const post of result.body.posts) assert.equal(post.threadId, root);
  const accents = await search(env, "café");
  assert.deepEqual(ids(accents), [root, reply, deep]);
  assert.deepEqual(Object.keys(result.body.posts[0]).sort(),
    ["author", "board", "createdAt", "excerpt", "id", "parentId", "threadId"]);
  const empty = await search(env, "   ");
  assert.deepEqual(empty.body, { terms: [], posts: [], nextCursor: null });
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

// ------------------------------------------------------------- visibility law

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
  return { env, W, posts, viewer, admin, blocker, blockee };
}

test("visibility: guests never get hidden, banned-author or non-viewable-ancestor posts", async () => {
  const { env, W, posts } = await visibilityWorld();
  const result = await search(env, W);
  assert.deepEqual(ids(result), [posts.visible, posts.lapsed, posts.byBlocker, posts.byBlockee, posts.underBlocker]
    .sort((a, b) => a - b));
});

test("visibility: a signed-in viewer loses block-paired authors and ancestors in BOTH directions", async () => {
  const { env, W, posts, viewer } = await visibilityWorld();
  const result = await search(env, W, { session: viewer.session });
  assert.deepEqual(ids(result), [posts.visible, posts.lapsed]);
});

test("visibility: each side of a block pair loses the other's posts", async () => {
  const { env, W, posts, blocker, blockee } = await visibilityWorld();
  // The blocker blocked the viewer only: the blocker still sees everything else.
  const blockerView = ids(await search(env, W, { session: blocker.session }));
  assert.ok(blockerView.includes(posts.byBlockee));
  assert.ok(blockerView.includes(posts.byBlocker));
  const blockeeView = ids(await search(env, W, { session: blockee.session }));
  assert.ok(blockeeView.includes(posts.byBlocker));
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
  // Operators are plain words: "cats OR dogs" needs all three words.
  assert.deepEqual(ids(await search(env, "cats OR dogs")), [both]);
  assert.deepEqual(ids(await search(env, "(cats OR dogs)")), [both]);
  // "-dogs" is not an exclusion, "^cats" not an anchor, "body:" not a column filter.
  assert.deepEqual(ids(await search(env, "-dogs")), [dogs, both]);
  assert.deepEqual(ids(await search(env, "^cats")), [cats, both]);
  assert.deepEqual(ids(await search(env, "body:cats")), []);
  // "*" never becomes a prefix query.
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

// ------------------------------------------------------------- index sync

test("sync: a post created through the API is found; an edit swaps old words for new; a delete removes it", async () => {
  const env = onEnv();
  const author = await member(env);
  const created = await call(env, "/api/posts", {
    method: "POST", session: author.session, body: { body: "wombat burrows are cubic", board: "general" },
  });
  assert.equal(created.status, 201);
  const id = Number((await created.json()).id);
  assert.deepEqual(ids(await search(env, "wombat")), [id]);
  const edited = await call(env, `/api/posts/${id}`, {
    method: "PATCH", session: author.session, body: { body: "platypus lays eggs" },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(ids(await search(env, "wombat")), []);
  assert.deepEqual(ids(await search(env, "platypus")), [id]);
  const deleted = await call(env, `/api/posts/${id}`, { method: "DELETE", session: author.session });
  assert.equal(deleted.status, 200);
  assert.deepEqual(ids(await search(env, "platypus")), []);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM post_search WHERE rowid = ?").get(id).n, 0);
});

test("sync: hide and unhide through the desk drop and restore the result; a cascade delete clears the index", async () => {
  const env = onEnv();
  const admin = await member(env, "moderator");
  const author = await member(env);
  const id = seedPost(env.__sqlite, { authorId: author.id, body: "narwhal tusks spiral" });
  assert.deepEqual(ids(await search(env, "narwhal")), [id]);
  const hide = await call(env, `/api/admin/users/${author.id}/hide-recent`, {
    method: "POST", session: admin.session, body: { count: 1 },
  });
  assert.equal(hide.status, 200);
  assert.deepEqual(ids(await search(env, "narwhal")), []);
  const unhide = await call(env, "/api/admin/posts/unhide", { method: "POST", session: admin.session, body: { ids: [id] } });
  assert.equal(unhide.status, 200);
  assert.deepEqual(ids(await search(env, "narwhal")), [id]);
  env.__sqlite.prepare("DELETE FROM users WHERE id = ?").run(author.id);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM post_search WHERE rowid = ?").get(id).n, 0);
});

// ------------------------------------------------------------- spoilers

test("spoilers: excerpts are masked before they are cut, and a hit inside a spoiler is never revealed", async () => {
  const env = onEnv();
  const author = await member(env);
  const filler = "lorem ipsum ".repeat(30);
  seedPost(env.__sqlite, { authorId: author.id, body: `${filler} the ending: ||the butler did it|| says the axolotl` });
  seedPost(env.__sqlite, { authorId: author.id, body: "||secret axolotl plot twist||" });
  // A spoiler longer than the excerpt lead, right before the hit: a window
  // computed on the raw body would start inside it and cut its opening ||.
  seedPost(env.__sqlite, {
    authorId: author.id, body: `${filler} ||it was in the library with a candlestick, sadly|| axolotl`,
  });
  const result = await search(env, "axolotl");
  assert.equal(result.body.posts.length, 3);
  for (const post of result.body.posts) {
    assert.doesNotMatch(post.excerpt, /butler|secret|plot twist|library|candlestick|sadly/);
  }
  const long = result.body.posts.find((post) => post.excerpt.includes("axolotl"));
  assert.ok(long, "the window moves to the visible hit");
  assert.ok(long.excerpt.startsWith("…"));
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

test("bind budget: a full page for a blocking viewer binds at most 10 values; the cursor walks every page once", async () => {
  const env = onEnv();
  const viewer = await member(env);
  const authors = [];
  for (let i = 0; i < 4; i++) authors.push(await member(env));
  block(env, viewer.id, authors[3].id);
  const visible = [];
  for (let i = 0; i < FEED_PAGE_SIZE * 2 + 5; i++) {
    const author = authors[i % 3];
    const repeats = " ibis".repeat(1 + (i % 4));
    const root = seedPost(env.__sqlite, { authorId: author.id, body: `post ${i}${repeats}` });
    visible.push(root);
    seedPost(env.__sqlite, { authorId: authors[3].id, body: `blocked ${i} ibis` });
  }
  const binds = [];
  const prepare = env.FORUM_DB.prepare.bind(env.FORUM_DB);
  env.FORUM_DB.prepare = (sql) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => { binds.push({ sql, count: values.length }); return bind(...values); };
    return statement;
  };
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
    } while (cursor && pages < 10);
    assert.equal(pages, 3, sort);
    assert.deepEqual([...seen].sort((a, b) => a - b), visible, sort);
    assert.equal(new Set(seen).size, seen.length, sort);
  }
  const searchBinds = binds.filter((entry) => /post_search MATCH/.test(entry.sql));
  assert.ok(searchBinds.length >= 6);
  assert.ok(searchBinds.every((entry) => entry.count <= 10 && entry.count < D1_MAX_BOUND_PARAMS),
    JSON.stringify(searchBinds.map((entry) => entry.count)));
});

// ------------------------------------------------------------- backfill

test("backfill: owner only, batched, idempotent, and it indexes posts written before the index", async () => {
  const env = onEnv();
  const owner = await member(env, "admin");
  const admin = await member(env, "moderator");
  const author = await member(env);
  for (let i = 0; i < SEARCH_FTS_BACKFILL_BATCH + 1; i++) {
    seedPost(env.__sqlite, { authorId: author.id, body: `old post ${i} kakapo` });
  }
  // Simulate posts that predate migration 0097: an empty index.
  env.__sqlite.prepare("DELETE FROM post_search").run();
  assert.deepEqual(ids(await search(env, "kakapo")), []);
  const backfill = (session, body = {}) => call(env, "/api/search/backfill", { method: "POST", session, body });
  // A guest is refused (the same-origin/CSRF gate answers before sign-in).
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
  const again = await (await backfill(owner.session)).json();
  assert.equal(again.indexed, 0);
  const count = env.__sqlite.prepare("SELECT COUNT(*) AS n FROM post_search").get().n;
  assert.equal(count, SEARCH_FTS_BACKFILL_BATCH + 1);
  assert.equal((await search(env, "kakapo")).body.posts.length, FEED_PAGE_SIZE);
  // A GET on the backfill path is refused.
  assert.equal((await call(env, "/api/search/backfill", { session: owner.session })).status, 405);
});

// ------------------------------------------------------------- migration shape

test("migration 0097 is CREATE-only: an FTS5 table with unicode61 remove_diacritics 2 and posts triggers", () => {
  const sql = read("migrations/0097_search.sql").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(ALTER|DROP)\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+posts\b|\bINSERT\s+INTO\s+posts\b|\bDELETE\s+FROM\s+posts\b/i);
  assert.match(sql, /CREATE VIRTUAL TABLE IF NOT EXISTS post_search USING fts5\(/);
  assert.match(sql, /tokenize = 'unicode61 remove_diacritics 2'/);
  assert.equal((sql.match(/CREATE TRIGGER IF NOT EXISTS/g) || []).length, 3);
});

test("strings: the module's label, description and page strings exist in every locale and are translated", () => {
  const keys = ["modules.label.search", "modules.desc.search", "search.fullLabel", "search.fullHint", "search.fullEmpty",
    "search.fullClassic", "search.fullBuild", "search.fullBuilding", "search.fullBuilt"];
  const en = JSON.parse(read("public/locales/en.json"));
  const dir = new URL("public/locales/", ROOT);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 66);
  for (const file of files) {
    const table = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    for (const key of keys) assert.ok(typeof table[key] === "string" && table[key].trim(), `${file} ${key}`);
    if (file !== "en.json") {
      const same = keys.filter((key) => table[key] === en[key]);
      assert.deepEqual(same, [], `${file} copies English`);
    }
  }
});
