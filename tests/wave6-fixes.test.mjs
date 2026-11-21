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

// Wave 2026-11-21-6: the Lobby history paint on open (F1), the two wave-5
// reviewer LOWs — stale older group pages and the badge's loaded-pages-only
// count (F2) — and the two features: Lobby reply and the chat list filter.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DM_GROUP_LIST_LIMIT } from "../constants.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedUser } from "./helpers/seed.mjs";
import { REPLY_BODY_MAX, withReplyMention } from "../public/js/lobby-reply.js";
import { FILTER_QUERY_MAX, filterConversations } from "../public/js/chat-filter.js";

const source = (path) => readFileSync(new URL("../public/js/" + path, import.meta.url), "utf8");

let env;
let db;
const u = {};
const s = {};

before(async () => {
  env = makeEnv();
  db = env.__sqlite;
  for (const name of ["alice", "bob", "carol"]) {
    u[name] = await seedUser(db, { username: name });
    s[name] = forgeSession(db, u[name]);
  }
});

beforeEach(() => {
  db.prepare("DELETE FROM dm_groups").run();
  db.prepare("DELETE FROM dm_threads").run();
});

const getJson = async (path, who) => {
  const response = await call(env, path, { session: s[who] });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};

// F1 — the 50 messages seeded at boot paint when the panel opens.
test("the panel paints the seeded lobby log on open, after the session probe", () => {
  const lobby = source("chat-widget-lobby.js");
  assert.match(lobby, /export const paintLobbyLog = /);
  assert.match(lobby, /export const seedLobby = /);
  const widget = source("chat-widget.js");
  assert.match(widget, /seedLobby\(lobbyData\)/);
  const open = widget.slice(widget.indexOf("const openPanel = async"), widget.indexOf("const closePanel = "));
  const probe = open.indexOf('api("/api/session")');
  const paint = open.indexOf("paintLobbyLog()");
  assert.ok(probe > 0 && paint > probe, "paintLobbyLog() runs after the session probe so mine/staff marks are right");
});

test("the lobby poll never double-paints the seeded rows", () => {
  const lobby = source("chat-widget-lobby.js");
  // Append dedupes by id against the carried log, and the cursor resumes past it.
  assert.match(lobby, /ui\.lobbyLog\.some\(\(row\) => row\.id === message\.id\)/);
  assert.match(lobby, /"\/api\/chat\?after=" \+ ui\.lobbyLastId/);
});

// F2a — a group the viewer was removed from drops out of the cached pages.
test("a group 404 on open or poll drops the group from both cached pages", () => {
  const composer = source("chat-widget-composer.js");
  assert.match(composer, /error\?\.status === 404 && kindOf\(thread\) === "group"/);
  assert.match(composer, /dropGroup\(thread\.id\)/);
  const threads = source("chat-widget-threads.js");
  assert.match(threads, /export const dropGroup = /);
  assert.match(threads, /ui\.olderGroups = ui\.olderGroups\.filter/);
});

test("removing a member makes that group read answer 404 for them", async () => {
  const at = now() - 100;
  const groupId = Number(db.prepare("INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, '', ?)")
    .run(u.alice, at).lastInsertRowid);
  for (const id of [u.alice, u.bob, u.carol]) {
    db.prepare("INSERT INTO dm_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)").run(groupId, id, at);
  }
  db.prepare("DELETE FROM dm_group_members WHERE group_id = ? AND user_id = ?").run(groupId, u.carol);
  const response = await call(env, "/api/dm/groups/" + groupId, { session: s.carol });
  assert.equal(response.status, 404);
});

// F2b — the badge uses the server total, not the loaded pages.
test("GET /api/dm/threads carries dmUnread counting groups past the first page", async () => {
  const base = now() - 10000;
  for (let index = 0; index < DM_GROUP_LIST_LIMIT + 3; index += 1) {
    const groupId = Number(db.prepare("INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, '', ?)")
      .run(u.bob, base + index).lastInsertRowid);
    for (const id of [u.alice, u.bob]) {
      db.prepare("INSERT INTO dm_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)")
        .run(groupId, id, base + index);
    }
    db.prepare("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, 'x', ?)")
      .run(groupId, u.bob, base + index);
    db.prepare("UPDATE dm_group_members SET unread = 1 WHERE group_id = ? AND user_id = ?").run(groupId, u.alice);
  }
  const body = await getJson("/api/dm/threads", "alice");
  assert.equal(body.groups.length, DM_GROUP_LIST_LIMIT);
  assert.equal(body.dmUnread, DM_GROUP_LIST_LIMIT + 3);
  const lobby = await getJson("/api/chat", "alice");
  assert.equal(lobby.dmUnread, body.dmUnread);
});

test("the widget badge paints the server dmUnread total", () => {
  const threads = source("chat-widget-threads.js");
  assert.match(threads, /dmUnread: Number\.isFinite\(Number\(data\?\.dmUnread\)\)/);
  assert.match(threads, /ui\.dmUnread = data\.dmUnread/);
  const paint = threads.slice(threads.indexOf("export const paintBadge"), threads.indexOf("export const paintThreadList"));
  assert.match(paint, /ui\.dmUnread/);
});

// F3 — Lobby reply prefills an @mention.
test("withReplyMention prefixes the mention once and keeps the typed draft", () => {
  assert.equal(withReplyMention("", "bob"), "@bob ");
  assert.equal(withReplyMention("hey", "bob"), "@bob hey");
  assert.equal(withReplyMention("@bob hey", "bob"), "@bob hey");
  assert.equal(withReplyMention("  hey", "bob"), "@bob hey");
  assert.equal(withReplyMention("x", ""), "x");
  assert.equal(withReplyMention("x", null), "x");
  assert.equal(withReplyMention("a".repeat(REPLY_BODY_MAX), "bob").length, REPLY_BODY_MAX);
});

test("lobby rows carry a Reply button for other members' messages", () => {
  const lobby = source("chat-widget-lobby.js");
  assert.match(lobby, /chat-message-reply/);
  assert.match(lobby, /t\("chat\.replyTo", \{ name: message\.author\.username \}\)/);
  assert.match(lobby, /withReplyMention\(/);
});

// F4 — the chat list quick filter.
test("filterConversations matches labels case-insensitively and never mutates", () => {
  const rows = [{ id: 1, name: "Alice" }, { id: 2, name: "bobby" }, { id: 3, name: "Carol" }];
  const label = (row) => row.name;
  assert.deepEqual(filterConversations(rows, "", label), rows);
  assert.deepEqual(filterConversations(rows, "  ", label), rows);
  assert.deepEqual(filterConversations(rows, "BOB", label).map((row) => row.id), [2]);
  assert.deepEqual(filterConversations(rows, "a", label).map((row) => row.id), [1, 3]);
  assert.deepEqual(filterConversations(rows, "zzz", label), []);
  assert.equal(rows.length, 3);
  assert.notEqual(filterConversations(rows, "", label), rows);
  assert.deepEqual(filterConversations(rows, "x".repeat(FILTER_QUERY_MAX + 10), label), []);
});

test("the chat list mounts the filter outside the repainted rows and applies it", () => {
  const widget = source("chat-widget.js");
  assert.match(widget, /buildListFilter\(\)/);
  const threads = source("chat-widget-threads.js");
  assert.match(threads, /export const buildListFilter = /);
  assert.match(threads, /filterConversations\(/);
  assert.match(threads, /t\("chat\.filterChats"\)/);
  assert.match(threads, /t\("chat\.noFilterMatch"\)/);
});
