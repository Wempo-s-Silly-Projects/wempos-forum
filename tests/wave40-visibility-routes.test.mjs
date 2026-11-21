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

// Wave 2026-11-21-40 F1 — per-route fixes from the whole-repo visibility
// audit (docs/drafts/feature-slate-2026-11-21-40.md). Each test is RED on
// v4.44.0 and names the route it pins; removing the new clause fails it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";

const AGENT_TOKEN = "wave40-agent-token-0123456789abcdefghij";

async function world() {
  const env = makeEnv({ AGENT_TOKENS: JSON.stringify({ [sha256(AGENT_TOKEN)]: "botty" }) });
  const db = env.__sqlite;
  const ids = {};
  for (const name of ["viewer", "alice", "bob", "carol", "banned", "botty"]) {
    ids[name] = await seedUser(db, { username: name });
  }
  ids.boss = await seedUser(db, { username: "boss", role: "admin" });
  seedBan(db, ids.banned);
  return { env, db, ids };
}

const block = (db, blocker, blocked) =>
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(blocker, blocked, now());
const notify = (db, userId, targetId, replyId, label = null) =>
  db.prepare("INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) VALUES (?, ?, ?, ?, ?)")
    .run(userId, targetId, replyId, now(), label);
const getJson = async (env, path, session) => {
  const res = await call(env, path, session ? { session } : undefined);
  assert.equal(res.status, 200, path);
  return res.json();
};
const mcp = async (env, name, args) => {
  const res = await call(env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + AGENT_TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const reply = await res.json();
  return reply.result.content[0].text;
};

// ---- notifications (HIGH): the reply's ancestors gate the whole row ----

test("notifications: a reply under a hidden root, a banned root author, or a block-paired root author drops out (list + badge)", async () => {
  const { env, db, ids } = await world();
  const viewer = forgeSession(db, ids.viewer);
  const cases = [
    seedPost(db, { authorId: ids.alice, body: "hidden root", visibility: "hidden" }),
    seedPost(db, { authorId: ids.banned, body: "banned root" }),
    seedPost(db, { authorId: ids.carol, body: "blocked root" }),
  ];
  block(db, ids.carol, ids.viewer);
  for (const root of cases) {
    const reply = seedPost(db, { authorId: ids.bob, body: "secret reply text", parentId: root });
    notify(db, ids.viewer, root, reply, "You were mentioned by bob");
  }
  const okRoot = seedPost(db, { authorId: ids.alice, body: "fine root" });
  const okReply = seedPost(db, { authorId: ids.bob, body: "fine reply", parentId: okRoot });
  notify(db, ids.viewer, okRoot, okReply);
  const list = (await getJson(env, "/api/me/notifications", viewer)).notifications;
  assert.deepEqual(list.map((row) => row.replyId), [okReply]);
  assert.equal((await getJson(env, "/api/session", viewer)).unreadNotifications, 1);
  assert.equal((await getJson(env, "/api/chat", viewer)).bellUnread, 1, "lobby bell matches the list");
  // Staff keep the full desk view.
  notify(db, ids.boss, okRoot, okReply);
  const boss = forgeSession(db, ids.boss);
  assert.equal((await getJson(env, "/api/me/notifications", boss)).notifications.length, 1);
});

test("notifications: a reply by a since-banned or block-paired author drops the row and its label; label-only rows stay", async () => {
  const { env, db, ids } = await world();
  const viewer = forgeSession(db, ids.viewer);
  const root = seedPost(db, { authorId: ids.alice, body: "root" });
  const byBanned = seedPost(db, { authorId: ids.banned, body: "from banned", parentId: root });
  const byCarol = seedPost(db, { authorId: ids.carol, body: "from carol", parentId: root });
  notify(db, ids.viewer, root, byBanned, "You were mentioned by banned");
  notify(db, ids.viewer, root, byCarol, "You were mentioned by carol");
  block(db, ids.viewer, ids.carol);
  db.prepare("INSERT INTO notifications (user_id, created_at, label) VALUES (?, ?, 'Your appeal was approved')").run(ids.viewer, now());
  const list = (await getJson(env, "/api/me/notifications", viewer)).notifications;
  assert.deepEqual(list.map((row) => row.label), ["Your appeal was approved"]);
  assert.equal((await getJson(env, "/api/session", viewer)).unreadNotifications, 1);
});

test("MCP list_mentions: a mention under a hidden or block-paired parent drops out", async () => {
  const { env, db, ids } = await world();
  const hiddenRoot = seedPost(db, { authorId: ids.alice, body: "hidden", visibility: "hidden" });
  const carolRoot = seedPost(db, { authorId: ids.carol, body: "carol root" });
  block(db, ids.botty, ids.carol);
  for (const root of [hiddenRoot, carolRoot]) {
    const reply = seedPost(db, { authorId: ids.bob, body: "@botty leaked mention", parentId: root });
    notify(db, ids.botty, root, reply, "You were mentioned by bob");
  }
  const text = await mcp(env, "list_mentions", {});
  assert.doesNotMatch(text, /leaked mention/);
  assert.deepEqual(JSON.parse(text).mentions, []);
});

// ---- MCP read tools (HIGH): an agent token reads as its member ----

test("MCP read tools: an agent never reads a block-paired member's posts (both directions)", async () => {
  const { env, db, ids } = await world();
  const carolRoot = seedPost(db, { authorId: ids.carol, body: "carol zebra words" });
  const aliceRoot = seedPost(db, { authorId: ids.alice, body: "alice zebra words" });
  seedPost(db, { authorId: ids.carol, body: "carol zebra reply", parentId: aliceRoot });
  block(db, ids.carol, ids.botty);
  for (const [name, args] of [["recent_posts", {}], ["search_posts", { query: "zebra" }], ["list_board", { board: "general" }]]) {
    const text = await mcp(env, name, args);
    assert.doesNotMatch(text, /carol zebra/, name);
    assert.match(text, /alice zebra words/, name);
  }
  assert.match(await mcp(env, "get_post", { id: carolRoot }), /Post not found/);
  assert.doesNotMatch(await mcp(env, "get_post", { id: aliceRoot }), /carol zebra reply/);
});

test("MCP lobby_read: an agent never reads a block-paired member's lobby lines", async () => {
  const { env, db, ids } = await world();
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(ids.carol, "carol lobby line", now());
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(ids.alice, "alice lobby line", now());
  block(db, ids.botty, ids.carol);
  const text = await mcp(env, "lobby_read", {});
  assert.doesNotMatch(text, /carol lobby line/);
  assert.match(text, /alice lobby line/);
});

// ---- leaderboard (HIGH) ----

test("leaderboard: hidden posts and banned reactors never count; a block-paired member is not listed", async () => {
  const { env, db, ids } = await world();
  for (let i = 0; i < 5; i++) seedPost(db, { authorId: ids.bob, body: "hidden " + i, visibility: "hidden" });
  const alicePost = seedPost(db, { authorId: ids.alice, body: "alice" });
  db.prepare("INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, 'like', ?)").run(alicePost, ids.banned, now());
  seedPost(db, { authorId: ids.carol, body: "carol" });
  const board = async (session) => (await getJson(env, "/api/leaderboard", session)).allTime.leaderboard;
  const guest = await board(null);
  assert.equal(guest.find((row) => row.username === "bob"), undefined, "only-hidden member listed");
  assert.equal(guest.find((row) => row.username === "alice").reactionsReceived, 0);
  assert.ok(guest.find((row) => row.username === "carol"));
  block(db, ids.carol, ids.viewer);
  assert.equal((await board(forgeSession(db, ids.viewer))).find((row) => row.username === "carol"), undefined);
});

// ---- lobby chat (MEDIUM) ----

test("lobby chat: a block pair hides each side's lines from the other; guests and staff see both", async () => {
  const { env, db, ids } = await world();
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(ids.carol, "carol says", now());
  db.prepare("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)").run(ids.viewer, "viewer says", now());
  block(db, ids.viewer, ids.carol);
  const lines = async (session, after = "") =>
    (await getJson(env, "/api/chat" + after, session)).messages.map((row) => row.body);
  assert.deepEqual(await lines(forgeSession(db, ids.viewer)), ["viewer says"]);
  assert.deepEqual(await lines(forgeSession(db, ids.carol)), ["carol says"]);
  assert.deepEqual(await lines(forgeSession(db, ids.viewer), "?after=0"), ["viewer says"]);
  assert.deepEqual(await lines(null), ["carol says", "viewer says"]);
  assert.deepEqual(await lines(forgeSession(db, ids.boss)), ["carol says", "viewer says"]);
});

// ---- 1:1 and group DMs (MEDIUM / LOW) ----

function seedThread(db, a, b) {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  const info = db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at, unread_a, unread_b) VALUES (?, ?, ?, 2, 2)")
    .run(userA, userB, now());
  return Number(info.lastInsertRowid);
}
const dm = (db, threadId, userId, body) =>
  db.prepare("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)").run(threadId, userId, body, now());

test("DM thread list: the preview never shows a banned or block-paired member's message", async () => {
  const { env, db, ids } = await world();
  const withBanned = seedThread(db, ids.viewer, ids.banned);
  dm(db, withBanned, ids.viewer, "my hello");
  dm(db, withBanned, ids.banned, "banned secret");
  const withCarol = seedThread(db, ids.viewer, ids.carol);
  dm(db, withCarol, ids.carol, "carol secret");
  block(db, ids.carol, ids.viewer);
  const threads = (await getJson(env, "/api/dm/threads", forgeSession(db, ids.viewer))).threads;
  const byId = new Map(threads.map((row) => [row.id, row]));
  assert.equal(byId.get(withBanned).lastMessagePreview, "my hello");
  assert.equal(byId.get(withCarol).lastMessagePreview, "");
  assert.doesNotMatch(JSON.stringify(threads), /secret/);
});

test("DM thread read: a block pair hides the other side's messages and unread reads 0 (both directions)", async () => {
  const { env, db, ids } = await world();
  const thread = seedThread(db, ids.viewer, ids.carol);
  dm(db, thread, ids.carol, "carol words");
  dm(db, thread, ids.viewer, "viewer words");
  block(db, ids.viewer, ids.carol);
  const read = async (who) => getJson(env, "/api/dm/threads/" + thread, forgeSession(db, who));
  const mine = await read(ids.viewer);
  assert.deepEqual(mine.messages.map((row) => row.body), ["viewer words"]);
  assert.equal(mine.unread, 0);
  const theirs = await read(ids.carol);
  assert.deepEqual(theirs.messages.map((row) => row.body), ["carol words"]);
  assert.equal(theirs.unread, 0);
});

test("DM group read: unread counts only visible messages, matching the list", async () => {
  const { env, db, ids } = await world();
  const group = Number(db.prepare("INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, 'g', ?)").run(ids.viewer, now()).lastInsertRowid);
  for (const [user, unread] of [[ids.viewer, 2], [ids.alice, 0], [ids.banned, 0]]) {
    db.prepare("INSERT INTO dm_group_members (group_id, user_id, joined_at, unread) VALUES (?, ?, ?, ?)").run(group, user, now(), unread);
  }
  db.prepare("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, 'hi', ?)").run(group, ids.alice, now());
  db.prepare("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, 'psst', ?)").run(group, ids.banned, now());
  const session = forgeSession(db, ids.viewer);
  const listed = (await getJson(env, "/api/dm/threads", session)).groups.find((row) => row.id === group);
  const opened = await getJson(env, "/api/dm/groups/" + group, session);
  assert.equal(opened.unread, 1);
  assert.equal(opened.unread, listed.unread);
});

// ---- profiles (MEDIUM / LOW) ----

test("profile counts: other viewers count only public posts; the author and staff keep the full count", async () => {
  const { env, db, ids } = await world();
  seedPost(db, { authorId: ids.alice, body: "public" });
  const hidden = seedPost(db, { authorId: ids.alice, body: "hidden", visibility: "hidden" });
  seedPost(db, { authorId: ids.alice, body: "hidden reply", parentId: hidden, visibility: "hidden" });
  const counts = async (session) => {
    const body = await getJson(env, "/api/users/alice", session);
    return [body.postsCount, body.repliesCount];
  };
  assert.deepEqual(await counts(null), [1, 0]);
  assert.deepEqual(await counts(forgeSession(db, ids.viewer)), [1, 0]);
  assert.deepEqual(await counts(forgeSession(db, ids.alice)), [2, 1]);
  assert.deepEqual(await counts(forgeSession(db, ids.boss)), [2, 1]);
});

test("profile.css: a block pair gets 404 for the other member's theme (both directions)", async () => {
  const { env, db, ids } = await world();
  db.prepare("UPDATE users SET approved_css = ? WHERE id = ?").run(".x { color: red; }", ids.carol);
  const path = "/api/users/" + ids.carol + "/profile.css";
  assert.equal((await call(env, path)).status, 200);
  block(db, ids.carol, ids.viewer);
  assert.equal((await call(env, path, { session: forgeSession(db, ids.viewer) })).status, 404);
  db.prepare("UPDATE users SET approved_css = ? WHERE id = ?").run(".x { color: red; }", ids.viewer);
  assert.equal((await call(env, "/api/users/" + ids.viewer + "/profile.css", { session: forgeSession(db, ids.carol) })).status, 404);
  assert.equal((await call(env, path, { session: forgeSession(db, ids.boss) })).status, 200);
});

// ---- accountability archive (MEDIUM) ----

test("archive: an actively-banned author's rows and a block-paired author's rows stay off the page", async () => {
  const { env, db, ids } = await world();
  const insert = db.prepare(
    "INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because, visibility) " +
    "VALUES (?, ?, ?, ?, 'general', ?, ?, 'post-delete', 'public')");
  insert.run(901, ids.banned, "banned", "banned archived words", now(), now());
  insert.run(902, ids.carol, "carol", "carol archived words", now(), now());
  insert.run(903, null, "removed", "wiped account words", now(), now());
  block(db, ids.viewer, ids.carol);
  const bodies = async (session) => (await getJson(env, "/api/archive", session)).archive.map((row) => row.body).sort();
  assert.deepEqual(await bodies(null), ["carol archived words", "wiped account words"]);
  assert.deepEqual(await bodies(forgeSession(db, ids.viewer)), ["wiped account words"]);
});

// ---- reaction counts, Suggestions score, poll results (MEDIUM) ----

test("reactions and poll votes by an actively-banned member never count", async () => {
  const { env, db, ids } = await world();
  const root = seedPost(db, { authorId: ids.alice, body: "suggest", board: "suggestions" });
  const other = seedPost(db, { authorId: ids.alice, body: "other", board: "suggestions" });
  const react = db.prepare("INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?)");
  // root: one like, by the banned member (score 1 unfiltered, 0 filtered);
  // other: a like and a dislike (score 0) — newer, so it wins the 0-0 tie.
  react.run(root, ids.banned, "like", now());
  react.run(other, ids.carol, "like", now());
  react.run(other, ids.bob, "dislike", now());
  const poll = Number(db.prepare("INSERT INTO polls (post_id, question, created_at) VALUES (?, 'q?', ?)").run(root, now()).lastInsertRowid);
  const option = Number(db.prepare("INSERT INTO poll_options (poll_id, label, position) VALUES (?, 'yes', 0)").run(poll).lastInsertRowid);
  db.prepare("INSERT INTO poll_votes (poll_id, user_id, option_id, voted_at) VALUES (?, ?, ?, ?)").run(poll, ids.banned, option, now());
  db.prepare("INSERT INTO poll_votes (poll_id, user_id, option_id, voted_at) VALUES (?, ?, ?, ?)").run(poll, ids.bob, option, now());
  const detail = await getJson(env, "/api/posts/" + root);
  assert.equal(detail.likeCount, 0);
  assert.equal(detail.dislikeCount, 0);
  assert.equal(detail.poll.totalVotes, 1);
  const feed = (await getJson(env, "/api/posts?board=suggestions")).posts;
  assert.deepEqual(feed.map((row) => row.id), [other, root], "a banned like must not lift the score");
});

// ---- F2a: the presence heartbeat skips actively-banned members ----

test("presence heartbeat: an actively-banned member's ping writes no presence row", async () => {
  const { env, db, ids } = await world();
  // A ban that leaves the session in place (bans normally delete sessions).
  const session = forgeSession(db, ids.banned);
  const res = await call(env, "/api/presence", { method: "POST", body: {}, session });
  assert.ok(res.status < 500);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM presence WHERE user_id = ?").get(ids.banned).n, 0);
  const ok = await call(env, "/api/presence", { method: "POST", body: {}, session: forgeSession(db, ids.alice) });
  assert.equal(ok.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM presence WHERE user_id = ?").get(ids.alice).n, 1);
});
