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

// Wave 2026-11-21-13: three profile-side features — "Member since" on every
// profile, a member's recent threads (visibility law: hidden, banned and
// block-paired content never shows), and inline formatting + spoilers on
// profile wall posts.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { createRecentThreads, formatJoinedDate, threadExcerpt, THREAD_EXCERPT_MAX } from "../public/js/profile-extras.js";
import { findByClass, countByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

let env;
let db;
const u = {};
const s = {};

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const name of ["author", "reader", "staff", "other"]) {
    u[name] = await seedUser(db, { username: name, role: name === "staff" ? "admin" : "member" });
    s[name] = forgeSession(db, u[name]);
  }
});

beforeEach(() => {
  db.prepare("DELETE FROM blocks").run();
  db.prepare("DELETE FROM bans").run();
  db.prepare("DELETE FROM posts").run();
});

const block = (blocker, blocked) =>
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(u[blocker], u[blocked], now());
const threads = (who, id = u.author) => call(env, `/api/users/${id}/threads`, who ? { session: s[who] } : {});

// --- F1: Member since --------------------------------------------------------

test("profile: joinedAt is the account's creation time as ISO", async () => {
  const created = Number(db.prepare("SELECT created_at FROM users WHERE id = ?").get(u.author).created_at);
  const response = await call(env, "/api/users/author");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.joinedAt, new Date(created * 1000).toISOString());
});

test("profile: a block pair's unavailable payload carries no joinedAt", async () => {
  block("author", "reader");
  const body = await (await call(env, "/api/users/author", { session: s.reader })).json();
  assert.equal(body.unavailable, true);
  assert.equal("joinedAt" in body, false);
});

test("member since: the date renders in the reader's locale, '' when unparseable", () => {
  const iso = "2026-03-05T12:00:00.000Z";
  assert.match(formatJoinedDate(iso, "en"), /2026/);
  assert.match(formatJoinedDate(iso, "en"), /March/);
  assert.match(formatJoinedDate(iso, "de"), /März/);
  assert.equal(formatJoinedDate("nope", "en"), "");
  assert.equal(formatJoinedDate(null, "en"), "");
  assert.match(formatJoinedDate(iso, "not a locale!!"), /2026/, "a refused locale falls back");
});

// --- F2: recent threads (visibility law) ---------------------------------------

test("threads: a guest sees the author's public roots, newest first, at most five", async () => {
  for (let i = 1; i <= 7; i += 1) seedPost(db, { authorId: u.author, body: "thread " + i });
  const root = seedPost(db, { authorId: u.other, body: "someone else's" });
  seedPost(db, { authorId: u.author, body: "a reply, not a thread", parentId: root });
  const response = await threads(null);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.threads.map((row) => row.body), ["thread 7", "thread 6", "thread 5", "thread 4", "thread 3"]);
});

test("threads: hidden roots never show — not to guests, members, staff or the author", async () => {
  seedPost(db, { authorId: u.author, body: "visible" });
  seedPost(db, { authorId: u.author, body: "hidden", visibility: "hidden" });
  for (const who of [null, "reader", "staff", "author"]) {
    const body = await (await threads(who)).json();
    assert.deepEqual(body.threads.map((row) => row.body), ["visible"], String(who));
  }
});

test("threads: an actively banned author's threads vanish; an expired ban restores them", async () => {
  seedPost(db, { authorId: u.author, body: "before the ban" });
  seedBan(db, u.author, null);
  for (const who of [null, "reader"]) {
    const body = await (await threads(who)).json();
    assert.deepEqual(body.threads, [], String(who));
  }
  db.prepare("DELETE FROM bans").run();
  seedBan(db, u.author, -60);
  const body = await (await threads(null)).json();
  assert.equal(body.threads.length, 1);
});

test("threads: a block pair refuses the list in both directions; staff are exempt", async () => {
  seedPost(db, { authorId: u.author, body: "x" });
  block("author", "reader");
  assert.equal((await threads("reader")).status, 403);
  db.prepare("DELETE FROM blocks").run();
  block("reader", "author");
  assert.equal((await threads("reader")).status, 403);
  block("author", "staff");
  assert.equal((await threads("staff")).status, 200);
  assert.equal((await threads("other")).status, 200, "an unrelated member still reads it");
});

test("threads: rows carry only id, body, board and createdAt — no private fields", async () => {
  seedPost(db, { authorId: u.author, body: "shape", board: "suggestions" });
  const body = await (await threads(null)).json();
  assert.deepEqual(Object.keys(body.threads[0]).sort(), ["board", "body", "createdAt", "id"]);
  assert.equal(body.threads[0].board, "suggestions");
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /password|salt|email|ip/i);
});

test("threads: unknown member is 404; a malformed id never reaches the handler", async () => {
  assert.equal((await threads(null, 999999)).status, 404);
  assert.equal((await call(env, "/api/users/abc/threads")).status, 404);
});

// --- F2 client: the recent-threads panel ---------------------------------------

test("thread excerpt: spoilers are masked before truncation, whitespace collapsed", () => {
  assert.equal(threadExcerpt("hello\n\n  world"), "hello world");
  assert.doesNotMatch(threadExcerpt("the end ||Bruce dies|| ok"), /Bruce/);
  const long = "a".repeat(THREAD_EXCERPT_MAX + 50);
  const cut = threadExcerpt(long);
  assert.equal(cut.length, THREAD_EXCERPT_MAX + 1);
  assert.ok(cut.endsWith("…"));
  const straddle = "x".repeat(THREAD_EXCERPT_MAX - 5) + " ||secret words here||";
  assert.doesNotMatch(threadExcerpt(straddle), /secret/, "a spoiler cut by truncation stays masked");
});

test("recent threads panel: one link per thread to /posts/:id, empty state otherwise", () => {
  const list = createRecentThreads(fakeDocument, [
    { id: 4, body: "first", board: "general", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: 9, body: "second", board: "general", createdAt: "2026-01-02T00:00:00.000Z" },
  ], "en");
  assert.equal(countByClass(list, "recent-thread-link"), 2);
  const link = findByClass(list, "recent-thread-link");
  assert.equal(link.href ?? link.attributes.href, "/posts/4");
  assert.equal(link.attributes["data-app-link"], "");
  assert.equal(link.textContent, "first");
  const empty = createRecentThreads(fakeDocument, [], "en");
  assert.equal(countByClass(empty, "recent-thread-link"), 0);
  assert.ok(findByClass(empty, "empty-state"));
});

test("profile route wires member since and recent threads", () => {
  const route = read("public/js/routes/profile.js");
  assert.match(route, /formatJoinedDate\(profile\.joinedAt/);
  assert.match(route, /renderRecentThreads\(profile\)/);
});

// --- F3: wall posts get inline formatting + spoilers ---------------------------

// Wave 24 moved the wall onto the post page's per-block renderer (which runs
// parseInline on every block); behavior pinned in tests/wave24-fixes.test.mjs.
test("wall: post bodies render through the block renderer (formatting + click-to-reveal spoilers)", () => {
  const wall = read("public/js/wall.js");
  assert.match(wall, /import \{ renderBodyBlocks \} from "\.\/render\.js";/);
  assert.match(wall, /renderBodyBlocks\(\{ body: text \}, document, body\)/);
  assert.doesNotMatch(wall, /element\("p", "wall-post-body", post\.body\)/);
});

// --- Strings -------------------------------------------------------------------

test("strings: the five new keys exist in every locale, translated, placeholders intact", async () => {
  const { readdirSync } = await import("node:fs");
  const keys = ["profile.joined", "profile.threadsTitle", "profile.threadsEmpty", "profile.threadsLoadFailed", "profile.threadUntitled"];
  const en = JSON.parse(read("public/locales/en.json"));
  const files = readdirSync(new URL("../public/locales/", import.meta.url)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 21);
  for (const file of files) {
    const bundle = JSON.parse(read("public/locales/" + file));
    for (const key of keys) {
      assert.equal(typeof bundle[key], "string", file + " " + key);
      if (file !== "en.json") assert.notEqual(bundle[key], en[key], file + " " + key + " left in English");
    }
    assert.match(bundle["profile.joined"], /\{date\}/, file);
  }
});
