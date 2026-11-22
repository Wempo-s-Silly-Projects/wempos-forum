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

// v5.39.0 "organize & follow" (migration 0067): F1 private bookmark folders,
// F2 following a member with a notification when they start a new public
// thread. Writes are signed in + CSRF + not banned + rate limited; folder
// contents re-check the bookmarks list's visibility rule on every read; the
// follow fan-out skips banned and block-paired followers, is capped and runs
// as one bounded statement pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { D1_MAX_BOUND_PARAMS, FEED_PAGE_SIZE } from "../constants.mjs";
import { FOLDERS_MAX, FOLDER_NAME_MAX } from "../api/bookmark-folders.mjs";
import { FOLLOW_FANOUT_CAP, FOLLOWING_MAX, followThreadLabel } from "../api/follows.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "migrations/0067_folders_follows.sql";
const TABLES = ["bookmark_folders", "bookmark_folder_items", "user_follows"];
const FOLDERS = "/api/me/bookmark-folders";

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "carol", "dave", "erin"]) id[name] = await seedUser(db, { username: name });
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}

const count = (db, sql, ...args) => db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n;
const bookmark = (db, userId, postId, at = now()) =>
  db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(userId, postId, at);
const block = (db, blocker, blocked) =>
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(blocker, blocked, now());
const followRow = (db, follower, followee, at = now()) =>
  db.prepare("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(follower, followee, at);
const createFolder = async (w, session, name) => call(w.env, FOLDERS, { method: "POST", body: { name }, session });
async function folderId(w, session, name) {
  const res = await createFolder(w, session, name);
  assert.equal(res.status, 201, name);
  return (await res.json()).folder.id;
}
const items = async (w, session, id, query = "") => call(w.env, FOLDERS + "/" + id + "/items" + query, { session });
const follow = (w, session, name, method = "POST") => call(w.env, "/api/users/" + name + "/follow", { method, session });
const newThread = (w, session, body) => call(w.env, "/api/posts", { method: "POST", body: { body, board: "general" }, session });

// ---- migration --------------------------------------------------------------

test("migration 0067 is CREATE-only and every FK cascades", () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  for (const table of TABLES) assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + table));
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  const references = sql.match(/REFERENCES [^,\n]+/g) || [];
  assert.equal(references.length, 5);
  for (const reference of references) assert.match(reference, /ON DELETE CASCADE/, reference);
  const env = makeEnv();
  for (const table of TABLES) {
    const fks = env.__sqlite.prepare("PRAGMA foreign_key_list(" + table + ")").all();
    assert.ok(fks.length >= 1, table);
    for (const fk of fks) assert.equal(fk.on_delete, "CASCADE", table + "." + fk.from);
  }
});

// ---- F1 bookmark folders ----------------------------------------------------

test("F1 auth: no Origin 403, anon 401, bad CSRF 403, banned 403; guests can't list; nothing is written", async () => {
  const w = await world();
  const noOrigin = await call(w.env, FOLDERS, { method: "POST", body: { name: "x" } });
  assert.equal(noOrigin.status, 403);
  const anon = await call(w.env, FOLDERS, { method: "POST", body: { name: "x" },
    headers: { Origin: "https://wempos-forum.com", "X-CSRF-Token": "x" } });
  assert.equal(anon.status, 401);
  assert.equal((await call(w.env, FOLDERS)).status, 401);
  const s = w.session("alice");
  const badCsrf = await call(w.env, FOLDERS, { method: "POST", body: { name: "x" },
    session: { ...s, csrf: "wrong-token-wrong-token-wrong" } });
  assert.equal(badCsrf.status, 403);
  seedBan(w.db, w.id.alice);
  assert.equal((await createFolder(w, s, "x")).status, 403);
  assert.equal(count(w.db, "bookmark_folders"), 0);
});

test("F1 + F2 rate limit: the write tier refuses with 429", async () => {
  const env = makeEnv({ ...makeLimiters(false).bindings });
  const alice = await seedUser(env.__sqlite, { username: "alice" });
  await seedUser(env.__sqlite, { username: "bob" });
  const s = forgeSession(env.__sqlite, alice);
  assert.equal((await call(env, FOLDERS, { method: "POST", body: { name: "x" }, session: s })).status, 429);
  assert.equal((await call(env, "/api/users/bob/follow", { method: "POST", session: s })).status, 429);
  assert.equal(count(env.__sqlite, "bookmark_folders"), 0);
  assert.equal(count(env.__sqlite, "user_follows"), 0);
});

test("F1 validation: names are trimmed, 1-40 chars, no control chars, unique per member, at most 20 folders", async () => {
  const w = await world();
  const s = w.session("alice");
  for (const bad of ["", "   ", "x".repeat(FOLDER_NAME_MAX + 1), "tab\there", "new\nline", "nul\u0000", 42, null, ["a"]]) {
    assert.equal((await createFolder(w, s, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(FOLDER_NAME_MAX, 40);
  assert.equal(FOLDERS_MAX, 20);
  const res = await createFolder(w, s, "  Recipes  ");
  assert.equal(res.status, 201);
  const { folder } = await res.json();
  assert.equal(folder.name, "Recipes");
  assert.equal((await createFolder(w, s, "Recipes")).status, 409, "duplicate name");
  assert.equal((await createFolder(w, s, "é".repeat(FOLDER_NAME_MAX))).status, 201, "40 characters is fine");
  for (let i = 3; i <= FOLDERS_MAX; i++) assert.equal((await createFolder(w, s, "f" + i)).status, 201);
  assert.equal((await createFolder(w, s, "one too many")).status, 400);
  assert.equal(count(w.db, "bookmark_folders WHERE user_id = ?", w.id.alice), FOLDERS_MAX);
  // Another member's names don't collide.
  assert.equal((await createFolder(w, w.session("bob"), "Recipes")).status, 201);
  const list = await (await call(w.env, FOLDERS, { session: s })).json();
  assert.equal(list.folders.length, FOLDERS_MAX);
  assert.ok(list.folders.every((row) => Number.isSafeInteger(row.id) && typeof row.name === "string"));
});

test("F1 rename and delete: own folder only; rename validates and refuses a duplicate", async () => {
  const w = await world();
  const s = w.session("alice");
  const a = await folderId(w, s, "A");
  await folderId(w, s, "B");
  const rename = (id, name, session = s) => call(w.env, FOLDERS + "/" + id, { method: "PATCH", body: { name }, session });
  assert.equal((await rename(a, "")).status, 400);
  assert.equal((await rename(a, "B")).status, 409);
  const ok = await rename(a, " Renamed ");
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).folder.name, "Renamed");
  assert.equal((await call(w.env, FOLDERS + "/" + a, { method: "DELETE", session: s })).status, 200);
  assert.equal((await call(w.env, FOLDERS + "/" + a, { method: "DELETE", session: s })).status, 404);
  assert.equal((await rename(999999, "x")).status, 404);
  assert.equal((await call(w.env, FOLDERS + "/abc", { method: "DELETE", session: s })).status, 404);
});

test("F1 privacy: another member gets 404 on every folder route and never sees the folder", async () => {
  const w = await world();
  const alice = w.session("alice");
  const bob = w.session("bob");
  const post = seedPost(w.db, { authorId: w.id.carol, body: "PRIVATEFOLDERTXT" });
  bookmark(w.db, w.id.alice, post);
  bookmark(w.db, w.id.bob, post);
  const id = await folderId(w, alice, "Secret stash");
  assert.equal((await call(w.env, FOLDERS + "/" + id + "/items/" + post, { method: "PUT", session: alice })).status, 200);
  const attempts = [
    [FOLDERS + "/" + id + "/items", "GET"],
    [FOLDERS + "/" + id, "PATCH", { name: "pwned" }],
    [FOLDERS + "/" + id, "DELETE"],
    [FOLDERS + "/" + id + "/items/" + post, "PUT"],
    [FOLDERS + "/" + id + "/items/" + post, "DELETE"],
  ];
  for (const [path, method, body] of attempts) {
    for (const session of [bob, forgeSession(w.db, w.id.boss)]) {
      const res = await call(w.env, path, { method, body, session });
      assert.equal(res.status, 404, method + " " + path);
      assert.ok(!(await res.text()).includes("Secret stash"));
    }
  }
  const bobList = await (await call(w.env, FOLDERS, { session: bob })).text();
  assert.ok(!bobList.includes("Secret stash"));
  assert.equal(count(w.db, "bookmark_folder_items WHERE folder_id = ?", id), 1, "nothing changed");
  assert.equal(w.db.prepare("SELECT name FROM bookmark_folders WHERE id = ?").get(id).name, "Secret stash");
});

test("F1 items: only posts you bookmarked; idempotent; one post in several folders; remove", async () => {
  const w = await world();
  const s = w.session("alice");
  const saved = seedPost(w.db, { authorId: w.id.bob, body: "saved" });
  const unsaved = seedPost(w.db, { authorId: w.id.bob, body: "not saved" });
  bookmark(w.db, w.id.alice, saved);
  const a = await folderId(w, s, "A");
  const b = await folderId(w, s, "B");
  const put = (folder, post) => call(w.env, FOLDERS + "/" + folder + "/items/" + post, { method: "PUT", session: s });
  assert.equal((await put(a, unsaved)).status, 404, "not bookmarked");
  assert.equal((await put(a, 999999)).status, 404, "missing post");
  assert.equal((await put(a, saved)).status, 200);
  assert.equal((await put(a, saved)).status, 200, "idempotent");
  assert.equal((await put(b, saved)).status, 200, "a second folder");
  assert.equal(count(w.db, "bookmark_folder_items WHERE post_id = ?", saved), 2);
  const list = await (await items(w, s, a)).json();
  assert.deepEqual(list.posts.map((post) => post.id), [saved]);
  assert.equal(list.folder.name, "A");
  const removed = await call(w.env, FOLDERS + "/" + a + "/items/" + saved, { method: "DELETE", session: s });
  assert.equal(removed.status, 200);
  assert.equal((await (await items(w, s, a)).json()).posts.length, 0);
  assert.equal((await (await items(w, s, b)).json()).posts.length, 1, "the other folder keeps it");
  // Unsaving the post drops it from every folder view (re-saving restores it).
  w.db.prepare("DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?").run(w.id.alice, saved);
  assert.equal((await (await items(w, s, b)).json()).posts.length, 0);
  bookmark(w.db, w.id.alice, saved);
  assert.equal((await (await items(w, s, b)).json()).posts.length, 1);
});

test("F1 visibility: hidden, banned-author, block-paired (both ways) and hidden-ancestor posts never show", async () => {
  const w = await world();
  const s = w.session("alice");
  const ok = seedPost(w.db, { authorId: w.id.bob, body: "FOLDEROKTXT" });
  const hidden = seedPost(w.db, { authorId: w.id.bob, body: "FOLDERHIDDENTXT", visibility: "hidden" });
  const underHidden = seedPost(w.db, { authorId: w.id.bob, body: "FOLDERUNDERHIDDENTXT", parentId: hidden });
  const banned = seedPost(w.db, { authorId: w.id.carol, body: "FOLDERBANNEDTXT" });
  const blocker = seedPost(w.db, { authorId: w.id.dave, body: "FOLDERBLOCKERTXT" });
  const blocked = seedPost(w.db, { authorId: w.id.erin, body: "FOLDERBLOCKEDTXT" });
  const id = await folderId(w, s, "Mixed");
  for (const post of [ok, hidden, underHidden, banned, blocker, blocked]) {
    bookmark(w.db, w.id.alice, post);
    w.db.prepare("INSERT INTO bookmark_folder_items (folder_id, post_id, added_at) VALUES (?, ?, ?)").run(id, post, now());
  }
  seedBan(w.db, w.id.carol);
  block(w.db, w.id.dave, w.id.alice);
  block(w.db, w.id.alice, w.id.erin);
  const res = await items(w, s, id);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("FOLDEROKTXT"));
  for (const needle of ["FOLDERHIDDENTXT", "FOLDERUNDERHIDDENTXT", "FOLDERBANNEDTXT", "FOLDERBLOCKERTXT", "FOLDERBLOCKEDTXT"]) {
    assert.ok(!text.includes(needle), "leaks " + needle);
  }
  // Read-time: lifting the ban restores the row with no write.
  w.db.prepare("DELETE FROM bans WHERE user_id = ?").run(w.id.carol);
  assert.ok((await (await items(w, s, id)).text()).includes("FOLDERBANNEDTXT"));
});

test("F1 paging: FEED_PAGE_SIZE per page with a composite cursor; a bad cursor is 400", async () => {
  const w = await world();
  const s = w.session("alice");
  const id = await folderId(w, s, "Many");
  const base = now() - 1000;
  const posts = [];
  for (let i = 0; i < FEED_PAGE_SIZE + 5; i++) {
    const post = seedPost(w.db, { authorId: w.id.bob, body: "page " + i });
    posts.push(post);
    bookmark(w.db, w.id.alice, post);
    w.db.prepare("INSERT INTO bookmark_folder_items (folder_id, post_id, added_at) VALUES (?, ?, ?)").run(id, post, base + i);
  }
  const first = await (await items(w, s, id)).json();
  assert.equal(first.posts.length, FEED_PAGE_SIZE);
  assert.equal(first.posts[0].id, posts[posts.length - 1], "newest added first");
  assert.match(first.nextBefore, /^[0-9]+_[0-9]+$/);
  const second = await (await items(w, s, id, "?before=" + first.nextBefore)).json();
  assert.equal(second.posts.length, 5);
  assert.equal(second.nextBefore, null);
  const seen = new Set([...first.posts, ...second.posts].map((post) => post.id));
  assert.equal(seen.size, posts.length);
  for (const bad of ["x", "1_", "_1", "12345678901_1", "1_2_3"]) {
    assert.equal((await items(w, s, id, "?before=" + bad)).status, 400, bad);
  }
});

// ---- F2 follow a member -----------------------------------------------------

test("F2 auth: no Origin 403, anon 401, bad CSRF 403, banned 403; guests can't read state or the list", async () => {
  const w = await world();
  assert.equal((await call(w.env, "/api/users/bob/follow", { method: "POST" })).status, 403);
  assert.equal((await call(w.env, "/api/users/bob/follow", { method: "POST",
    headers: { Origin: "https://wempos-forum.com", "X-CSRF-Token": "x" } })).status, 401);
  assert.equal((await call(w.env, "/api/users/bob/follow")).status, 401);
  assert.equal((await call(w.env, "/api/me/following")).status, 401);
  const s = w.session("alice");
  assert.equal((await follow(w, { ...s, csrf: "wrong-token-wrong-token-wrong" }, "bob")).status, 403);
  seedBan(w.db, w.id.alice);
  assert.equal((await follow(w, s, "bob")).status, 403);
  assert.equal((await follow(w, s, "bob", "DELETE")).status, 403);
  assert.equal((await call(w.env, "/api/users/bob/follow", { method: "PATCH", session: s })).status, 405);
  assert.equal(count(w.db, "user_follows"), 0);
});

test("F2 rules: follow/unfollow by name; self 400; missing, banned and block pairs (both ways) refuse alike", async () => {
  const w = await world();
  const s = w.session("alice");
  const ok = await follow(w, s, "Bob");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { following: true });
  assert.equal((await follow(w, s, "bob")).status, 200, "idempotent");
  assert.equal(count(w.db, "user_follows"), 1);
  assert.deepEqual(await (await call(w.env, "/api/users/bob/follow", { session: s })).json(), { following: true });
  assert.equal((await follow(w, s, "alice")).status, 400, "self");
  seedBan(w.db, w.id.carol);
  block(w.db, w.id.dave, w.id.alice);
  block(w.db, w.id.alice, w.id.erin);
  const missing = await follow(w, s, "nobody");
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  for (const name of ["carol", "dave", "erin"]) {
    const res = await follow(w, s, name);
    assert.equal(res.status, 404, name);
    assert.deepEqual(await res.json(), missingBody, name + ": same refusal as a missing member");
  }
  for (const name of ["dave", "erin"]) {
    assert.equal((await call(w.env, "/api/users/" + name + "/follow", { session: s })).status, 404, "state read across a pair");
  }
  assert.equal(count(w.db, "user_follows"), 1);
  const off = await follow(w, s, "bob", "DELETE");
  assert.deepEqual(await off.json(), { following: false });
  assert.equal((await follow(w, s, "bob", "DELETE")).status, 200, "idempotent");
  assert.equal(count(w.db, "user_follows"), 0);
  assert.equal((await call(w.env, "/api/users/%E0%A4%A/follow", { method: "POST", session: s })).status, 404);
});

test("F2 cap: a member follows at most FOLLOWING_MAX members", async () => {
  const w = await world();
  assert.equal(FOLLOWING_MAX, 200);
  const at = now();
  for (let i = 0; i < FOLLOWING_MAX; i++) {
    const other = await seedUser(w.db, { username: "cap" + i });
    followRow(w.db, w.id.alice, other, at);
  }
  assert.equal((await follow(w, w.session("alice"), "bob")).status, 400);
  assert.equal(count(w.db, "user_follows WHERE follower_id = ?", w.id.alice), FOLLOWING_MAX);
});

test("F2 block: blocking removes follows in both directions", async () => {
  const w = await world();
  followRow(w.db, w.id.alice, w.id.bob);
  followRow(w.db, w.id.bob, w.id.alice);
  followRow(w.db, w.id.alice, w.id.carol);
  const res = await call(w.env, "/api/users/" + w.id.bob + "/block", { method: "POST", session: w.session("alice") });
  assert.equal(res.status, 200);
  assert.equal(count(w.db, "user_follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)",
    w.id.alice, w.id.bob, w.id.bob, w.id.alice), 0);
  assert.equal(count(w.db, "user_follows"), 1, "unrelated follows stay");
});

test("F2 privacy: the Following list is your own; banned and block-paired followees drop; profiles expose no follow data", async () => {
  const w = await world();
  followRow(w.db, w.id.alice, w.id.bob);
  followRow(w.db, w.id.alice, w.id.carol);
  followRow(w.db, w.id.alice, w.id.dave);
  followRow(w.db, w.id.erin, w.id.bob);
  seedBan(w.db, w.id.carol);
  block(w.db, w.id.dave, w.id.alice);
  const list = await (await call(w.env, "/api/me/following", { session: w.session("alice") })).json();
  assert.deepEqual(list.following.map((row) => row.username), ["bob"]);
  assert.ok(list.following.every((row) => Number.isSafeInteger(row.id) && typeof row.followedAt === "string"));
  const erin = await (await call(w.env, "/api/me/following", { session: w.session("erin") })).json();
  assert.deepEqual(erin.following.map((row) => row.username), ["bob"]);
  for (const viewer of [undefined, w.session("erin"), w.session("bob")]) {
    const text = await (await call(w.env, "/api/users/bob", viewer ? { session: viewer } : undefined)).text();
    assert.doesNotMatch(text, /follow/i, "no follower count or list on the profile");
  }
});

test("F2 fan-out: a new public root notifies followers once; skips banned, block-paired and the mentioned twin; replies don't", async () => {
  const w = await world();
  for (const name of ["bob", "carol", "dave", "erin", "boss"]) followRow(w.db, w.id[name], w.id.alice);
  seedBan(w.db, w.id.dave);
  block(w.db, w.id.erin, w.id.alice);
  const res = await newThread(w, w.session("alice"), "Hello followers @carol");
  assert.equal(res.status, 201);
  const postId = (await res.json()).id;
  const rows = w.db.prepare("SELECT user_id, label FROM notifications WHERE reply_id = ? ORDER BY user_id").all(postId);
  const byUser = new Map(rows.map((row) => [Number(row.user_id), row.label]));
  assert.equal(byUser.get(w.id.bob), followThreadLabel("alice"));
  assert.equal(byUser.get(w.id.boss), followThreadLabel("alice"));
  assert.equal(count(w.db, "notifications WHERE user_id = ? AND reply_id = ?", w.id.carol, postId), 1, "mention + follow = one row");
  assert.ok(!byUser.has(w.id.dave), "banned follower");
  assert.ok(!byUser.has(w.id.erin), "block-paired follower");
  assert.ok(!byUser.has(w.id.alice), "never the author");
  const bell = await (await call(w.env, "/api/me/notifications", { session: w.session("bob") })).json();
  assert.ok(bell.notifications.some((row) => row.targetPostId === postId && row.label === "New thread from alice"));
  // A reply is not a new thread.
  const before = count(w.db, "notifications");
  const reply = await call(w.env, "/api/posts/" + postId + "/replies", { method: "POST", body: { body: "self reply" }, session: w.session("alice") });
  assert.ok(reply.status === 201 || reply.status === 200, String(reply.status));
  assert.equal(count(w.db, "notifications WHERE label = ?", followThreadLabel("alice")), 2, "no new follow rows for a reply");
  assert.ok(count(w.db, "notifications") >= before);
  // Read-time: hiding the thread drops it from the follower's bell.
  w.db.prepare("UPDATE posts SET visibility = 'hidden' WHERE id = ?").run(postId);
  const hidden = await (await call(w.env, "/api/me/notifications", { session: w.session("bob") })).json();
  assert.ok(!hidden.notifications.some((row) => row.targetPostId === postId));
});

test("F2 fan-out cap: at most FOLLOW_FANOUT_CAP followers (earliest first), every statement under D1_MAX_BOUND_PARAMS", async () => {
  const w = await world();
  assert.equal(FOLLOW_FANOUT_CAP, 500);
  const base = now() - 10000;
  const followers = [];
  for (let i = 0; i < FOLLOW_FANOUT_CAP + 20; i++) {
    const other = await seedUser(w.db, { username: "fan" + i });
    followers.push(other);
    followRow(w.db, other, w.id.alice, base + i);
  }
  const realPrepare = w.env.FORUM_DB.prepare.bind(w.env.FORUM_DB);
  let maxBinds = 0;
  w.env.FORUM_DB.prepare = (sql) => {
    const statement = realPrepare(sql);
    const realBind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      maxBinds = Math.max(maxBinds, values.length);
      return realBind(...values);
    };
    return statement;
  };
  const res = await newThread(w, w.session("alice"), "big audience");
  assert.equal(res.status, 201);
  const postId = (await res.json()).id;
  assert.ok(maxBinds < D1_MAX_BOUND_PARAMS, "max binds " + maxBinds);
  assert.equal(count(w.db, "notifications WHERE reply_id = ?", postId), FOLLOW_FANOUT_CAP);
  const late = followers.slice(FOLLOW_FANOUT_CAP);
  assert.equal(count(w.db, "notifications WHERE reply_id = ? AND user_id IN (" + late.join(",") + ")", postId), 0, "the latest followers are past the cap");
});

test("F2 fan-out: a hidden (staged) root notifies nobody", async () => {
  const w = await world();
  followRow(w.db, w.id.bob, w.id.alice);
  const { followerFanOutStatements } = await import("../api/follows.mjs");
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "staged", visibility: "hidden" });
  const reply = seedPost(w.db, { authorId: w.id.alice, body: "a reply", parentId: seedPost(w.db, { authorId: w.id.carol, body: "root" }) });
  for (const postId of [hidden, reply]) {
    await w.env.FORUM_DB.batch(followerFanOutStatements(w.env.FORUM_DB, { authorId: w.id.alice, postId, username: "alice", now: now() }));
  }
  assert.equal(count(w.db, "notifications"), 0);
});

// ---- cascades -----------------------------------------------------------------

test("cascades: deleting a post, a folder or an account removes its 0067 rows", async () => {
  const w = await world();
  const s = w.session("alice");
  const p1 = seedPost(w.db, { authorId: w.id.bob, body: "one" });
  const p2 = seedPost(w.db, { authorId: w.id.bob, body: "two" });
  bookmark(w.db, w.id.alice, p1);
  bookmark(w.db, w.id.alice, p2);
  const a = await folderId(w, s, "A");
  const b = await folderId(w, s, "B");
  for (const [folder, post] of [[a, p1], [a, p2], [b, p2]]) {
    assert.equal((await call(w.env, FOLDERS + "/" + folder + "/items/" + post, { method: "PUT", session: s })).status, 200);
  }
  w.db.prepare("DELETE FROM posts WHERE id = ?").run(p1);
  assert.equal(count(w.db, "bookmark_folder_items WHERE post_id = ?", p1), 0, "post delete");
  assert.equal((await call(w.env, FOLDERS + "/" + a, { method: "DELETE", session: s })).status, 200);
  assert.equal(count(w.db, "bookmark_folder_items WHERE folder_id = ?", a), 0, "folder delete");
  assert.equal(count(w.db, "bookmark_folder_items"), 1);
  followRow(w.db, w.id.alice, w.id.bob);
  followRow(w.db, w.id.carol, w.id.alice);
  const del = await call(w.env, "/api/me/delete", { method: "POST", session: s });
  assert.equal(del.status, 200);
  for (const table of TABLES) assert.equal(count(w.db, table), 0, "account delete empties " + table);
  // Deleting the followee side cascades too.
  followRow(w.db, w.id.carol, w.id.bob);
  w.db.prepare("DELETE FROM users WHERE id = ?").run(w.id.bob);
  assert.equal(count(w.db, "user_follows"), 0);
});
