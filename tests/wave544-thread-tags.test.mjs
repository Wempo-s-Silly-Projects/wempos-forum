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

// v5.44.0 thread tags (migration 0070, forum_tags + thread_tags): staff
// create and delete up to TAG_TOTAL_MAX tags (word-filtered labels); a
// thread's author or staff set up to THREAD_TAG_MAX tags on a ROOT; the
// public tag listing GET /api/tags/:slug/posts pages FEED_PAGE_SIZE roots on
// the bare-id cursor under the visibility law (hidden, banned-author and
// block-paired threads never listed). Auth (anon/member/staff), CSRF, rate
// limits, the caps, root-only, pagination, the page head and every cascade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { FEED_PAGE_SIZE } from "../constants.mjs";
import { TAG_LABEL_MAX, TAG_SLUG_PATTERN, TAG_TOTAL_MAX, THREAD_TAG_MAX } from "../api/tags.mjs";

async function world(overrides = {}) {
  const env = makeEnv(overrides);
  const db = env.__sqlite;
  const id = {
    boss: await seedUser(db, { username: "boss", role: "admin" }),
    alice: await seedUser(db, { username: "alice" }),
    bob: await seedUser(db, { username: "bob" }),
  };
  const root = seedPost(db, { authorId: id.alice, body: "alice's tagged thread" });
  const reply = seedPost(db, { authorId: id.bob, body: "bob replies", parentId: root });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, root, reply, session };
}

const count = (db, sql, ...args) => Number(db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n);
const allowUserDeletes = (db) =>
  db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");
const createTag = (w, slug, label, name = "boss") =>
  call(w.env, "/api/admin/tags", { method: "POST", body: { slug, label }, session: w.session(name) });
const insertTag = (w, slug, label = slug) => Number(w.db.prepare(
  "INSERT INTO forum_tags (slug, label, created_by, created_at) VALUES (?, ?, ?, ?)",
).run(slug, label, w.id.boss, now()).lastInsertRowid);
const setTags = (w, postId, tagIds, name) =>
  call(w.env, "/api/posts/" + postId + "/tags", { method: "PUT", body: { tagIds }, session: w.session(name) });
const tagOf = (w, postId, tagId) =>
  w.db.prepare("INSERT INTO thread_tags (post_id, tag_id) VALUES (?, ?)").run(postId, tagId);

test("the caps and the slug shape are the brief's numbers", () => {
  assert.equal(TAG_TOTAL_MAX, 50);
  assert.equal(THREAD_TAG_MAX, 3);
  assert.equal(TAG_LABEL_MAX, 24);
  for (const ok of ["ab", "news", "a-1", "x".repeat(24)]) assert.match(ok, TAG_SLUG_PATTERN, ok);
  for (const bad of ["a", "x".repeat(25), "Has Caps", "under_score", "émoji", "a b", ""]) {
    assert.doesNotMatch(bad, TAG_SLUG_PATTERN, bad);
  }
});

// ---------------------------------------------------------------- staff CRUD

test("GET /api/tags is public; staff create and delete; anon 401 and members 403", async () => {
  const w = await world();
  const origin = { Origin: "https://wempos-forum.com" };
  assert.equal((await call(w.env, "/api/admin/tags", { method: "POST", body: { slug: "news", label: "News" }, headers: origin })).status, 401);
  assert.equal((await createTag(w, "news", "News", "alice")).status, 403);
  const created = await createTag(w, "news", "News");
  assert.equal(created.status, 201);
  const tag = (await created.json()).tag;
  assert.deepEqual({ slug: tag.slug, label: tag.label }, { slug: "news", label: "News" });
  const guest = await call(w.env, "/api/tags");
  assert.equal(guest.status, 200);
  assert.deepEqual((await guest.json()).tags.map((row) => row.slug), ["news"]);
  const path = "/api/admin/tags/" + tag.id;
  assert.equal((await call(w.env, path, { method: "DELETE", headers: origin })).status, 401);
  assert.equal((await call(w.env, path, { method: "DELETE", session: w.session("alice") })).status, 403);
  assert.equal((await call(w.env, path, { method: "DELETE", session: w.session("boss") })).status, 200);
  assert.equal((await call(w.env, path, { method: "DELETE", session: w.session("boss") })).status, 404);
  assert.equal(count(w.db, "forum_tags"), 0);
});

test("tag creation validates the slug and label, refuses duplicates and filtered words", async () => {
  const w = await world();
  w.db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('filtered_words', 'badword', ?)").run(now());
  for (const [slug, label] of [["A", "ok"], ["no spaces", "ok"], ["ok", ""], ["ok", "   "], ["ok", "x".repeat(25)],
    [null, "ok"], ["ok", 5], ["badword", "Fine"], ["fine", "so badword here"]]) {
    assert.equal((await createTag(w, slug, label)).status, 400, JSON.stringify([slug, label]));
  }
  assert.equal(count(w.db, "forum_tags"), 0);
  assert.equal((await createTag(w, "news", "  News  ")).status, 201);
  assert.equal(w.db.prepare("SELECT label FROM forum_tags").get().label, "News");
  assert.equal((await createTag(w, "news", "Other")).status, 409);
});

test("the site holds at most TAG_TOTAL_MAX tags", async () => {
  const w = await world();
  for (let i = 0; i < TAG_TOTAL_MAX - 1; i += 1) insertTag(w, "tag-" + i);
  assert.equal((await createTag(w, "last-one", "Last")).status, 201);
  assert.equal((await createTag(w, "one-more", "More")).status, 409);
  assert.equal(count(w.db, "forum_tags"), TAG_TOTAL_MAX);
});

test("staff tag writes demand same-origin + X-CSRF-Token and are rate limited", async () => {
  const w = await world();
  const boss = w.session("boss");
  const badToken = await call(w.env, "/api/admin/tags", { method: "POST", body: { slug: "news", label: "News" },
    session: { cookie: boss.cookie, csrf: "wrong-token" } });
  assert.equal(badToken.status, 403);
  const crossSite = await call(w.env, "/api/admin/tags", { method: "POST", body: { slug: "news", label: "News" },
    headers: { Cookie: boss.cookie, "X-CSRF-Token": boss.csrf, Origin: "https://evil.example" } });
  assert.equal(crossSite.status, 403);
  assert.equal(count(w.db, "forum_tags"), 0);
  const limited = await world({ ...makeLimiters(false).bindings });
  assert.equal((await createTag(limited, "news", "News")).status, 429);
  const tagId = insertTag(limited, "news");
  assert.equal((await call(limited.env, "/api/admin/tags/" + tagId, { method: "DELETE", session: limited.session("boss") })).status, 429);
});

// ---------------------------------------------------------------- set a thread's tags

test("the author or staff set up to THREAD_TAG_MAX tags on a root; others are refused", async () => {
  const w = await world();
  const [a, b, c, d] = ["alpha", "beta", "gamma", "delta"].map((slug) => insertTag(w, slug));
  const origin = { Origin: "https://wempos-forum.com" };
  assert.equal((await call(w.env, "/api/posts/" + w.root + "/tags", { method: "PUT", body: { tagIds: [a] }, headers: origin })).status, 401);
  assert.equal((await setTags(w, w.root, [a], "bob")).status, 403);
  const ok = await setTags(w, w.root, [a, b, c], "alice");
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).tags.map((tag) => tag.slug).sort(), ["alpha", "beta", "gamma"]);
  assert.equal((await setTags(w, w.root, [a, b, c, d], "alice")).status, 400, "more than three");
  assert.equal((await setTags(w, w.root, [d], "boss")).status, 200, "staff may retag");
  assert.deepEqual(w.db.prepare("SELECT tag_id FROM thread_tags WHERE post_id = ?").all(w.root).map((row) => Number(row.tag_id)), [d]);
  assert.equal((await setTags(w, w.root, [], "alice")).status, 200, "an empty list clears");
  assert.equal(count(w.db, "thread_tags"), 0);
});

test("root-only, known tags only, well-formed ids only; hidden threads are 404 to members", async () => {
  const w = await world();
  const a = insertTag(w, "alpha");
  assert.equal((await setTags(w, w.reply, [a], "bob")).status, 400, "a reply is not a thread root");
  for (const tagIds of [[999], [a, a], ["1"], [0], [-1], [1.5], "1", null, undefined]) {
    assert.equal((await setTags(w, w.root, tagIds, "alice")).status, 400, JSON.stringify(tagIds));
  }
  assert.equal((await setTags(w, 999999, [a], "alice")).status, 404);
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "hidden", visibility: "hidden" });
  assert.equal((await setTags(w, hidden, [a], "alice")).status, 404);
  assert.equal((await setTags(w, hidden, [a], "boss")).status, 200, "staff still reach hidden threads");
  assert.equal(count(w.db, "thread_tags WHERE post_id = ?", w.root), 0);
});

test("a banned author cannot tag; tag writes need CSRF and are rate limited", async () => {
  const w = await world();
  const a = insertTag(w, "alpha");
  const alice = w.session("alice");
  const badToken = await call(w.env, "/api/posts/" + w.root + "/tags", { method: "PUT", body: { tagIds: [a] },
    session: { cookie: alice.cookie, csrf: "wrong-token" } });
  assert.equal(badToken.status, 403);
  seedBan(w.db, w.id.alice);
  assert.equal((await setTags(w, w.root, [a], "alice")).status, 403);
  assert.equal(count(w.db, "thread_tags"), 0);
  const limited = await world({ ...makeLimiters(false).bindings });
  const b = insertTag(limited, "beta");
  assert.equal((await setTags(limited, limited.root, [b], "alice")).status, 429);
});

test("GET /api/posts/:id/tags shows a visible thread's chips; hidden and blocked threads 404", async () => {
  const w = await world();
  const a = insertTag(w, "alpha", "Alpha");
  tagOf(w, w.root, a);
  const guest = await call(w.env, "/api/posts/" + w.root + "/tags");
  assert.equal(guest.status, 200);
  assert.deepEqual((await guest.json()).tags, [{ id: a, slug: "alpha", label: "Alpha" }]);
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "hidden", visibility: "hidden" });
  tagOf(w, hidden, a);
  assert.equal((await call(w.env, "/api/posts/" + hidden + "/tags")).status, 404);
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.bob, w.id.alice, now());
  assert.equal((await call(w.env, "/api/posts/" + w.root + "/tags", { session: w.session("bob") })).status, 404);
});

// ---------------------------------------------------------------- the tag listing

test("the tag listing: unknown or malformed slug 404; FEED_PAGE_SIZE pages on the bare-id cursor", async () => {
  const w = await world();
  assert.equal((await call(w.env, "/api/tags/nope/posts")).status, 404);
  assert.equal((await call(w.env, "/api/tags/BAD_SLUG/posts")).status, 404);
  const a = insertTag(w, "alpha", "Alpha");
  const ids = [];
  for (let i = 0; i < FEED_PAGE_SIZE + 5; i += 1) {
    const post = seedPost(w.db, { authorId: w.id.alice, body: "tagged " + i });
    tagOf(w, post, a);
    ids.push(post);
  }
  const first = await call(w.env, "/api/tags/alpha/posts");
  assert.equal(first.status, 200);
  const page1 = await first.json();
  assert.deepEqual(page1.tag, { id: a, slug: "alpha", label: "Alpha" });
  assert.equal(page1.threads.length, FEED_PAGE_SIZE);
  assert.equal(page1.threads[0].id, ids[ids.length - 1], "newest first");
  assert.equal(page1.nextBefore, page1.threads[FEED_PAGE_SIZE - 1].id);
  const second = await (await call(w.env, "/api/tags/alpha/posts?before=" + page1.nextBefore)).json();
  assert.equal(second.threads.length, 5);
  assert.equal(second.nextBefore, null);
  const seen = new Set([...page1.threads, ...second.threads].map((thread) => thread.id));
  assert.equal(seen.size, FEED_PAGE_SIZE + 5);
  for (const bad of ["x", "-1", "1e3", "9".repeat(16)]) {
    assert.equal((await call(w.env, "/api/tags/alpha/posts?before=" + bad)).status, 400, bad);
  }
  assert.equal((await call(w.env, "/api/tags/alpha/posts?limit=500")).status, 200, "no caller-supplied size");
});

test("the tag listing hides hidden, banned-author and block-paired threads (staff bypass blocks only)", async () => {
  const w = await world();
  const carol = await seedUser(w.db, { username: "carol" });
  const a = insertTag(w, "alpha");
  const visible = seedPost(w.db, { authorId: w.id.alice, body: "VISIBLETAG" });
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "HIDDENTAG", visibility: "hidden" });
  const banned = seedPost(w.db, { authorId: carol, body: "BANNEDTAG" });
  const bobs = seedPost(w.db, { authorId: w.id.bob, body: "BLOCKEDTAG" });
  for (const post of [visible, hidden, banned, bobs]) tagOf(w, post, a);
  seedBan(w.db, carol);
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.alice, w.id.bob, now());
  const bodies = async (session) => JSON.stringify(await (await call(w.env, "/api/tags/alpha/posts", { session })).json());
  for (const [who, session] of [["guest", undefined], ["alice", w.session("alice")], ["bob", w.session("bob")], ["boss", w.session("boss")]]) {
    const text = await bodies(session);
    assert.doesNotMatch(text, /HIDDENTAG|BANNEDTAG|carol/, who);
  }
  assert.doesNotMatch(await bodies(w.session("alice")), /BLOCKEDTAG/, "blocker");
  assert.doesNotMatch(await bodies(w.session("bob")), /VISIBLETAG/, "blocked side");
  assert.match(await bodies(undefined), /BLOCKEDTAG/, "guests have no block pair");
  assert.match(await bodies(w.session("boss")), /BLOCKEDTAG/, "staff bypass the block filter");
});

test("tag listing previews are masked before the cut", async () => {
  const w = await world();
  const a = insertTag(w, "alpha");
  const post = seedPost(w.db, { authorId: w.id.alice, body: "intro ||SECRETSPOILER|| tail" });
  tagOf(w, post, a);
  const text = JSON.stringify(await (await call(w.env, "/api/tags/alpha/posts")).json());
  assert.doesNotMatch(text, /SECRETSPOILER/);
});

test("the /tag/:slug page head names a known tag and noindexes an unknown one", async () => {
  const w = await world();
  insertTag(w, "alpha", "Alpha Things");
  const known = await (await call(w.env, "/tag/alpha")).text();
  assert.match(known, /<title>Alpha Things/);
  assert.match(known, /rel="canonical" href="https:\/\/wempos-forum\.com\/tag\/alpha"/);
  assert.doesNotMatch(known, /name="robots" content="noindex"/);
  const unknown = await (await call(w.env, "/tag/nope")).text();
  assert.match(unknown, /name="robots" content="noindex"/);
  assert.doesNotMatch(unknown, /nope —/);
});

// ---------------------------------------------------------------- cascades + migration

test("cascades: removing the tag, the thread or the tag's creator removes the rows", async () => {
  const w = await world();
  allowUserDeletes(w.db);
  const a = insertTag(w, "alpha");
  tagOf(w, w.root, a);
  w.db.prepare("DELETE FROM forum_tags WHERE id = ?").run(a);
  assert.equal(count(w.db, "thread_tags"), 0, "tag removal");
  const b = insertTag(w, "beta");
  tagOf(w, w.root, b);
  w.db.prepare("DELETE FROM posts WHERE id = ?").run(w.root);
  assert.equal(count(w.db, "thread_tags"), 0, "thread removal");
  const other = seedPost(w.db, { authorId: w.id.bob, body: "other" });
  tagOf(w, other, b);
  w.db.prepare("DELETE FROM users WHERE id = ?").run(w.id.boss);
  assert.equal(count(w.db, "forum_tags"), 0, "creator removal takes the tag");
  assert.equal(count(w.db, "thread_tags"), 0, "…and its thread rows");
});

test("cascades: the author's own thread delete route takes its tag rows", async () => {
  const w = await world();
  const a = insertTag(w, "alpha");
  tagOf(w, w.root, a);
  const res = await call(w.env, "/api/posts/" + w.root, { method: "DELETE", session: w.session("alice") });
  assert.equal(res.status, 200);
  assert.equal(count(w.db, "thread_tags"), 0);
  assert.equal(count(w.db, "forum_tags"), 1, "the tag itself stays");
});

test("migration 0070 is CREATE-only and every reference cascades", () => {
  const sql = readFileSync(new URL("../migrations/0070_reactions_tags.sql", import.meta.url), "utf8");
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code.replace(/ON DELETE CASCADE/g, ""), /\b(ALTER|DROP|DELETE|UPDATE|INSERT)\b/i);
  const references = code.match(/REFERENCES\s+\w+\(\w+\)[^,\n]*/g) || [];
  assert.equal(references.length, 5);
  for (const ref of references) assert.match(ref, /ON DELETE CASCADE/, ref);
  const creates = code.match(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)[^(]*/gi) || [];
  assert.ok(creates.length >= 3);
  for (const statement of creates) assert.match(statement, /IF NOT EXISTS/i, statement);
  for (const table of ["dm_message_reactions", "forum_tags", "thread_tags"]) assert.match(code, new RegExp("CREATE TABLE IF NOT EXISTS " + table));
});
