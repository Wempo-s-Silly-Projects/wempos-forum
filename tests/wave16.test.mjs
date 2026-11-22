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

// Wave 2026-11-21-16: notifications grouped by thread (with a mark-the-thread
// read endpoint and spoiler-safe previews), clearer poll results, and search
// term highlighting. Server bits are driven through the real worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import {
  groupNotifications, notificationPreview, renderNotificationsPage,
} from "../public/js/notifications.js";
import { renderPollBlock } from "../public/js/polls.js";
import { appendHighlighted, highlightParts } from "../public/js/search-highlight.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

// --- F1 server: POST /api/me/notifications/read-thread/:postId ----------------------

async function seedThread() {
  const env = makeEnv();
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const bob = await seedUser(db, { username: "bob" });
  const carol = await seedUser(db, { username: "carol" });
  const root = seedPost(db, { authorId: alice, body: "root" });
  const other = seedPost(db, { authorId: alice, body: "other root" });
  const r1 = seedPost(db, { authorId: bob, body: "one", parentId: root });
  const r2 = seedPost(db, { authorId: bob, body: "two", parentId: root });
  const r3 = seedPost(db, { authorId: bob, body: "three", parentId: other });
  const insert = (userId, target, reply, label = null) => Number(db.prepare(
    "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) VALUES (?, ?, ?, ?, ?)",
  ).run(userId, target, reply, now(), label).lastInsertRowid);
  const ids = {
    a1: insert(alice, root, r1),
    a2: insert(alice, root, r2),
    aMention: insert(alice, root, r1, "You were mentioned by bob"),
    aOther: insert(alice, other, r3),
    c1: insert(carol, root, r1),
  };
  const readAt = (id) => db.prepare("SELECT read_at FROM notifications WHERE id = ?").get(id).read_at;
  return { env, db, alice, carol, root, other, ids, readAt };
}

test("read-thread marks only the caller's own reply notifications for that thread", async () => {
  const { env, db, alice, root, ids, readAt } = await seedThread();
  const session = forgeSession(db, alice);
  const res = await call(env, `/api/me/notifications/read-thread/${root}`, { method: "POST", session, body: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.notEqual(readAt(ids.a1), null);
  assert.notEqual(readAt(ids.a2), null);
  assert.equal(readAt(ids.aMention), null, "labelled (mention) rows stay separate and unread");
  assert.equal(readAt(ids.aOther), null, "another thread is untouched");
  assert.equal(readAt(ids.c1), null, "another member's rows are untouched");
});

test("read-thread on someone else's thread id changes nothing of theirs", async () => {
  const { env, db, carol, other, ids, readAt } = await seedThread();
  const session = forgeSession(db, carol);
  const res = await call(env, `/api/me/notifications/read-thread/${other}`, { method: "POST", session, body: {} });
  assert.equal(res.status, 200);
  assert.equal(readAt(ids.aOther), null);
  assert.equal(readAt(ids.c1), null);
});

test("read-thread refuses anonymous callers and missing CSRF", async () => {
  const { env, db, alice, root, ids, readAt } = await seedThread();
  const anon = await call(env, `/api/me/notifications/read-thread/${root}`, { method: "POST", body: {} });
  assert.ok(anon.status === 401 || anon.status === 403, `anon got ${anon.status}`);
  const session = forgeSession(db, alice);
  const noCsrf = await call(env, `/api/me/notifications/read-thread/${root}`, {
    method: "POST", body: {}, headers: { Cookie: session.cookie, Origin: "https://wempos-forum.com" },
  });
  assert.equal(noCsrf.status, 403);
  const crossOrigin = await call(env, `/api/me/notifications/read-thread/${root}`, {
    method: "POST", body: {}, headers: { Cookie: session.cookie, Origin: "https://evil.example", "X-CSRF-Token": session.csrf },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(readAt(ids.a1), null);
  assert.equal(readAt(ids.a2), null);
});

test("read-thread answers 405 on GET and 404 on a non-numeric id", async () => {
  const { env, db, alice, root } = await seedThread();
  const session = forgeSession(db, alice);
  const get = await call(env, `/api/me/notifications/read-thread/${root}`, { session });
  assert.equal(get.status, 405);
  const bad = await call(env, "/api/me/notifications/read-thread/abc", { method: "POST", session, body: {} });
  assert.equal(bad.status, 404);
  const zero = await call(env, "/api/me/notifications/read-thread/0", { method: "POST", session, body: {} });
  assert.equal(zero.status, 404);
});

test("read-thread's UPDATE is bounded and bound (LIMIT + placeholders)", () => {
  const source = read("api/notifications.mjs");
  const block = source.slice(source.indexOf("read-thread"));
  assert.match(block, /target_post_id = \? AND read_at IS NULL AND label IS NULL[^"]*LIMIT/);
});

// --- F1 client: grouping + spoiler-safe previews ------------------------------------

const item = (id, targetPostId, extra = {}) => ({ id, targetPostId, replyId: id + 100, read: false, postPreview: "", label: null, ...extra });

test("groupNotifications folds label-less rows of one thread into the newest slot", () => {
  const groups = groupNotifications([
    item(9, 1, { postPreview: "newest" }),
    item(8, 2),
    item(7, 1, { read: true }),
    item(6, 1, { label: "You were mentioned by bob" }),
    item(5, null, { label: "Your appeal was accepted" }),
    item(4, 1, { read: true }),
  ]);
  assert.deepEqual(groups.map((g) => g.ids), [[9, 7, 4], [8], [6], [5]]);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].read, false, "any unread member keeps the group unread");
  assert.equal(groups[0].preview, "newest");
  assert.equal(groups[0].targetPostId, 1);
  assert.deepEqual(groupNotifications(null), []);
});

test("notificationPreview masks spoilers, even one the 80-char cut left open", () => {
  assert.equal(notificationPreview("it ends ||he dies|| ok"), "it ends ▒▒▒ ok");
  assert.doesNotMatch(notificationPreview("the twist: ||he di"), /he di/);
  assert.equal(notificationPreview("a || b"), "a || b".slice(0, 2).trim() + "…");
  assert.equal(notificationPreview(""), "");
});

test("the notifications page renders a group as one thread row", () => {
  const main = new FakeNode("main");
  main.ownerDocument = fakeDocument;
  renderNotificationsPage(main, [item(9, 1), item(7, 1), item(6, 2, { postPreview: "x ||y||" })]);
  const rows = [];
  const walk = (node) => {
    if (String(node.className || "").includes("notification-item")) rows.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(main);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.action, "open-notification-thread");
  assert.equal(rows[0].dataset.postId, "1");
  assert.equal(rows[1].dataset.action, "open-notification");
  assert.doesNotMatch(rows[1].textContent, /\by\b/);
});

test("the thread-row action marks the thread read, then opens it", () => {
  const source = read("public/js/routes/notifications.js");
  assert.match(source, /"open-notification-thread":/);
  assert.match(source, /\/api\/me\/notifications\/read-thread\//);
});

// --- F2: poll clarity ----------------------------------------------------------------

const poll = { question: "Best?", totalVotes: 4, viewerOption: 2, options: [
  { id: 1, label: "A", count: 1 }, { id: 2, label: "B", count: 3 },
] };

test("poll rows show a percentage beside each count", () => {
  const block = renderPollBlock(poll, fakeDocument, { id: 1 });
  assert.equal(countByClass(block, "poll-percent"), 2);
  const percents = [];
  const walk = (node) => {
    if (String(node.className || "").split(" ").includes("poll-percent")) percents.push(node.textContent);
    for (const child of node.children || []) walk(child);
  };
  walk(block);
  assert.deepEqual(percents, ["25%", "75%"]);
});

test("the member's own option is marked 'Your vote'; guests and non-voters see no mark", () => {
  assert.equal(countByClass(renderPollBlock(poll, fakeDocument, { id: 1 }), "poll-yours"), 1);
  assert.equal(countByClass(renderPollBlock(poll, fakeDocument, null), "poll-yours"), 0);
  assert.equal(countByClass(renderPollBlock({ ...poll, viewerOption: null }, fakeDocument, { id: 1 }), "poll-yours"), 0);
});

test("the poll total is translated, not hardcoded English", () => {
  const source = read("public/js/polls.js");
  assert.doesNotMatch(source, /" votes"|"1 vote"/);
  assert.match(source, /tn\("polls\.total"/);
});

// --- F3: search highlighting ---------------------------------------------------------

test("highlightParts splits text around case-insensitive matches", () => {
  assert.deepEqual(highlightParts("Hello world, hello", "hello"), [
    { text: "Hello", hit: true }, { text: " world, ", hit: false }, { text: "hello", hit: true },
  ]);
  assert.deepEqual(highlightParts("nothing here", "zzz"), [{ text: "nothing here", hit: false }]);
  assert.deepEqual(highlightParts("abc", ""), [{ text: "abc", hit: false }]);
  assert.deepEqual(highlightParts("", "a"), []);
});

test("highlightParts skips highlighting when lowercasing changes the length", () => {
  assert.deepEqual(highlightParts("İstanbul", "i"), [{ text: "İstanbul", hit: false }]);
});

test("appendHighlighted builds text nodes and <mark> elements (no HTML strings)", () => {
  const parent = new FakeNode("p");
  appendHighlighted(fakeDocument, parent, "say Hi hi", "hi");
  assert.equal(countByClass(parent, "search-hit"), 2);
  assert.equal(findByClass(parent, "search-hit").tagName.toLowerCase(), "mark");
  assert.doesNotMatch(read("public/js/search-highlight.js"), /innerHTML/);
});

test("search results highlight reply bodies after spoiler masking", () => {
  const source = read("public/js/routes/feed.js");
  assert.match(source, /appendHighlighted\(document, bodyBlock, maskSpoilers\(reply\.body\), /);
});

// --- strings -------------------------------------------------------------------------

const NEW_KEYS = [
  "bell.threadGroup.one", "bell.threadGroup.other",
  "bell.threadGroupPreview.one", "bell.threadGroupPreview.other",
  "polls.yourVote", "polls.total.one", "polls.total.other", "polls.changeHint",
];

test("wave-16 strings exist, non-empty, in every locale", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 57);
  for (const file of files) {
    const table = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    for (const key of NEW_KEYS) {
      assert.equal(typeof table[key], "string", `${file} ${key}`);
      assert.ok(table[key].trim(), `${file} ${key} empty`);
      if (key.startsWith("polls.total") || key.startsWith("bell.threadGroup")) {
        assert.match(table[key], /\{count\}/, `${file} ${key} lacks {count}`);
      }
    }
  }
});
