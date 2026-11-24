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

// Wave 2026-11-21-40 F1 — the cross-route visibility regression. Waves 36
// and 39 found leaks in OLD routes that diff-scoped reviews never re-read;
// this sweep seeds one of each forbidden thing and asserts that NONE of it
// reaches ANY member-facing route's JSON (and the guest discovery/MCP
// surfaces) for an unrelated member, a guest, and each side of a block pair:
//   - a hidden root (plus a public reply under it),
//   - an actively-banned author (posts, replies, wall, lobby, DMs, archive,
//     reactions, presence),
//   - a block pair zzblocker -> zzblocked (each side's content, both ways),
//   - an invisible member on presence.
// A new route that returns member content belongs in ROUTES below.
//
// Explicit exemptions (owner-endorsed semantics, not leaks):
//   - staff (owner/admin) read everything — asserted at the end so the seed
//     is proven non-vacuous;
//   - per-member pages by name (/api/users/:name) and member search keep
//     listing a banned member with a ban banner (v3.1), so the banned
//     username is not swept on those (they are not requested here);
//   - /api/dm/threads(/:id) keeps the other participant's NAME on a 1:1 thread
//     row (the conversation's own label) when that member is banned or
//     block-paired; every message text and preview is swept (whether to
//     drop such rows entirely is an open owner question, slate F1 notes);
//   - discovery pages (sitemap, markdown) and anonymous MCP are guest-shaped
//     by construction, so they are swept as a guest only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";

const TOKENS = { viewer: "sweep-viewer-token-0123456789abcdefghijk", zzblocker: "sweep-blocker-token-0123456789abcdefghi",
  zzblocked: "sweep-blocked-token-0123456789abcdefghi" };
const ALWAYS_FORBIDDEN = ["HIDDENROOTTXT", "UNDERHIDDENTXT", "BANNEDTXT", "zzbanned", "zzghost"];
const SIDE_FORBIDDEN = { zzblocker: ["BLOCKEDTXT", "zzblocked"], zzblocked: ["BLOCKERTXT", "zzblocker"] };

async function seedWorld() {
  const env = makeEnv({ AGENT_TOKENS: JSON.stringify(Object.fromEntries(
    Object.entries(TOKENS).map(([name, token]) => [sha256(token), name]))) });
  const db = env.__sqlite;
  const id = {};
  for (const name of ["viewer", "alice", "zzbanned", "zzblocker", "zzblocked", "zzghost"]) {
    id[name] = await seedUser(db, { username: name });
  }
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const at = now();
  const run = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);

  const publicRoot = seedPost(db, { authorId: id.alice, body: "zzsweep VISIBLEOKTXT public root" });
  const hiddenRoot = seedPost(db, { authorId: id.alice, body: "zzsweep HIDDENROOTTXT", visibility: "hidden" });
  const underHidden = seedPost(db, { authorId: id.alice, body: "zzsweep UNDERHIDDENTXT", parentId: hiddenRoot });
  const bannedRoot = seedPost(db, { authorId: id.zzbanned, body: "zzsweep BANNEDTXT root", board: "suggestions" });
  const bannedReply = seedPost(db, { authorId: id.zzbanned, body: "zzsweep BANNEDTXT reply", parentId: publicRoot });
  const blockerRoot = seedPost(db, { authorId: id.zzblocker, body: "zzsweep BLOCKERTXT root" });
  const blockerReply = seedPost(db, { authorId: id.zzblocker, body: "zzsweep BLOCKERTXT reply", parentId: publicRoot });
  const blockedRoot = seedPost(db, { authorId: id.zzblocked, body: "zzsweep BLOCKEDTXT root" });
  const blockedReply = seedPost(db, { authorId: id.zzblocked, body: "zzsweep BLOCKEDTXT reply", parentId: publicRoot });
  // A level-2 reply by alice under each side's level-1 reply: its parent text
  // and chain must not carry the other side through.
  const underBlocker = seedPost(db, { authorId: id.alice, body: "zzsweep level two a", parentId: blockerReply });
  const underBlocked = seedPost(db, { authorId: id.alice, body: "zzsweep level two b", parentId: blockedReply });
  seedBan(db, id.zzbanned);
  run("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)", id.zzblocker, id.zzblocked, at);

  // Reactions + poll votes by the banned member; a like from the blocked side.
  run("INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, 'like', ?)", publicRoot, id.zzbanned, at);
  // Wall posts on alice's wall; lobby lines; presence (banned + invisible).
  for (const [author, body] of [[id.zzbanned, "BANNEDTXT wall"], [id.zzblocker, "BLOCKERTXT wall"], [id.zzblocked, "BLOCKEDTXT wall"]]) {
    run("INSERT INTO wall_posts (owner_id, author_id, body, created_at) VALUES (?, ?, ?, ?)", id.alice, author, body, at);
    run("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)", author, body.replace("wall", "lobby"), at);
  }
  for (const [user, invisible] of [[id.zzbanned, 0], [id.zzghost, 1], [id.alice, 0]]) {
    run("INSERT INTO presence (user_id, last_seen, invisible) VALUES (?, ?, ?)", user, at, invisible);
  }
  // Archive rows by the banned member and by each side of the pair.
  for (const [author, name, body] of [[id.zzbanned, "zzbanned", "BANNEDTXT archived"],
    [id.zzblocker, "zzblocker", "BLOCKERTXT archived"], [id.zzblocked, "zzblocked", "BLOCKEDTXT archived"]]) {
    run("INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because, visibility) " +
      "VALUES (?, ?, ?, ?, 'general', ?, ?, 'post-delete', 'public')", 9000 + author, author, name, body, at, at);
  }
  // Notifications + bookmarks for each swept member, pointing at everything.
  const pointers = [[hiddenRoot, underHidden], [publicRoot, bannedReply], [publicRoot, blockerReply],
    [publicRoot, blockedReply], [blockerReply, underBlocker], [blockedReply, underBlocked]];
  for (const member of ["viewer", "zzblocker", "zzblocked"]) {
    for (const [target, reply] of pointers) {
      run("INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) VALUES (?, ?, ?, ?, 'mention')",
        id[member], target, reply, at);
    }
    for (const post of [hiddenRoot, underHidden, bannedRoot, bannedReply, blockerRoot, blockedRoot, underBlocker, underBlocked]) {
      run("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)", id[member], post, at);
    }
  }
  // DMs: the pair's own thread, and each swept member with the banned member.
  const thread = (a, b) => run("INSERT INTO dm_threads (user_a, user_b, created_at, unread_a, unread_b) VALUES (?, ?, ?, 1, 1)",
    Math.min(a, b), Math.max(a, b), at);
  const pairThread = thread(id.zzblocker, id.zzblocked);
  run("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, 'BLOCKERTXT dm', ?)", pairThread, id.zzblocker, at);
  run("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, 'BLOCKEDTXT dm', ?)", pairThread, id.zzblocked, at);
  for (const member of ["viewer", "zzblocker", "zzblocked"]) {
    const t = thread(id[member], id.zzbanned);
    run("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, 'BANNEDTXT dm', ?)", t, id.zzbanned, at);
  }
  return { env, db, id, publicRoot, hiddenRoot, pairThread };
}

// Every member-facing read: [path, { guestOnly, keepParticipantNames }].
function routes(w, member) {
  const list = [
    ["/api/posts"], ["/api/posts?sort=new"], ["/api/posts?board=suggestions"], ["/api/posts?view=unanswered"],
    ["/api/search?q=zzsweep"], ["/api/search?q=zzsweep&in=replies"],
    ["/api/posts/" + w.publicRoot], ["/api/posts/" + w.publicRoot + "/replies"],
    ["/api/users/" + w.id.alice + "/threads"], ["/api/users/" + w.id.alice + "/wall"], ["/api/users/alice"],
    ["/api/leaderboard"], ["/api/presence"], ["/api/chat"], ["/api/chat?after=0"],
    ["/api/traditions/qotd"], ["/api/traditions/showcase"], ["/api/archive"],
    ["/sitemap.xml", { guestOnly: true }], ["/", { guestOnly: true, markdown: true }],
    ["/c/general", { guestOnly: true, markdown: true }], ["/posts/" + w.publicRoot, { guestOnly: true, markdown: true }],
  ];
  if (member) {
    list.push(["/api/me/notifications"], ["/api/me/bookmarks"], ["/api/session"],
      ["/api/dm/threads", { keepParticipantNames: true }]);
    if (member !== "viewer") list.push(["/api/dm/threads/" + w.pairThread, { keepParticipantNames: true }]);
  }
  return list;
}

const MCP_CALLS = (w) => [["recent_posts", {}], ["search_posts", { query: "zzsweep" }], ["list_board", { board: "general" }],
  ["get_post", { id: w.publicRoot }], ["lobby_read", {}]];

async function fetchText(env, path, { session, markdown } = {}) {
  const headers = markdown ? { Accept: "text/markdown" } : {};
  const res = await call(env, path, { session, headers });
  assert.equal(res.status, 200, path);
  return res.text();
}

async function mcpText(env, name, args, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await call(env, "/mcp", { method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const reply = await res.json();
  assert.equal(reply.result.isError, false, name);
  return reply.result.content[0].text;
}

function assertClean(text, forbidden, where) {
  for (const needle of forbidden) assert.ok(!text.includes(needle), where + " leaks " + needle);
}

test("cross-route sweep: no hidden, banned, invisible, or block-paired content or identity on any route", async () => {
  const w = await seedWorld();
  const viewers = [["guest", null], ["viewer", "viewer"], ["zzblocker", "zzblocker"], ["zzblocked", "zzblocked"]];
  let swept = 0;
  for (const [label, member] of viewers) {
    const session = member ? forgeSession(w.db, w.id[member]) : undefined;
    const forbidden = [...ALWAYS_FORBIDDEN, ...(SIDE_FORBIDDEN[member] || [])];
    for (const [path, options = {}] of routes(w, member)) {
      if (options.guestOnly && member) continue;
      const text = await fetchText(w.env, path, { session, markdown: options.markdown });
      const needles = options.keepParticipantNames
        ? forbidden.filter((n) => !/^zz(block|banned)/.test(n)) : forbidden;
      assertClean(text, needles, label + " " + path);
      swept++;
    }
    for (const [name, args] of MCP_CALLS(w)) {
      assertClean(await mcpText(w.env, name, args, member ? TOKENS[member] : null), forbidden, label + " mcp " + name);
      swept++;
    }
    if (member) {
      const mentions = await mcpText(w.env, "list_mentions", {}, TOKENS[member]);
      assertClean(mentions, forbidden, label + " mcp list_mentions");
      swept++;
    }
  }
  assert.ok(swept >= 113, "swept " + swept); // 22 routes x guest, 26 x3 members, MCP 5x4 + 3
});

test("cross-route sweep: the seed is live (positive controls) and staff keep the desk view", async () => {
  const w = await seedWorld();
  // Unrelated members still see both sides of the pair and the public root.
  const viewer = forgeSession(w.db, w.id.viewer);
  const feed = await fetchText(w.env, "/api/posts", { session: viewer });
  for (const needle of ["VISIBLEOKTXT", "BLOCKERTXT", "BLOCKEDTXT"]) assert.ok(feed.includes(needle), needle);
  assert.ok((await fetchText(w.env, "/api/chat", { session: viewer })).includes("BLOCKEDTXT lobby"));
  assert.ok((await fetchText(w.env, "/api/me/notifications", { session: viewer })).includes("BLOCKERTXT"));
  // Each side still sees its own content.
  const blocker = forgeSession(w.db, w.id.zzblocker);
  assert.ok((await fetchText(w.env, "/api/dm/threads/" + w.pairThread, { session: blocker })).includes("BLOCKERTXT dm"));
  // Staff: the hidden root and the banned member's reply are readable.
  const boss = forgeSession(w.db, w.id.boss);
  assert.ok((await fetchText(w.env, "/api/posts/" + w.hiddenRoot, { session: boss })).includes("HIDDENROOTTXT"));
  assert.ok((await fetchText(w.env, "/api/posts/" + w.publicRoot, { session: boss })).includes("BANNEDTXT reply"));
  assert.ok((await fetchText(w.env, "/api/chat", { session: boss })).includes("BLOCKEDTXT lobby"));
});

// v5.96.0 B1: thread pages carry the title + opening text in the served HTML
// (an <h1> and a paragraph inside <main>), behind the same canViewPost gate as
// the head. Served on the real shell, so the injection marker is live.
test("server HTML thread text: hidden, banned-author and block-paired threads leak nothing; a visible one shows", async () => {
  const shell = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(shell, /<h1 class="visually-hidden" data-i18n="shell\.tagline">/, "injection marker present in the shell");
  const env = makeEnv({ ASSETS: makeAssets(() => new Response(shell, { headers: { "Content-Type": "text/html; charset=utf-8" } })) });
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice" });
  const banned = await seedUser(db, { username: "zzbanned" });
  const blocker = await seedUser(db, { username: "zzblocker" });
  const blocked = await seedUser(db, { username: "zzblocked" });
  const visible = seedPost(db, { authorId: alice, body: "SSRTITLEOK <b>bold</b>\nOpening ||SSRSPOILER|| words OKBODYTXT" });
  const hidden = seedPost(db, { authorId: alice, body: "HIDDENROOTTXT title\nHIDDENBODYTXT", visibility: "hidden" });
  const bannedRoot = seedPost(db, { authorId: banned, body: "BANNEDTXT title\nBANNEDBODYTXT" });
  const blockerRoot = seedPost(db, { authorId: blocker, body: "BLOCKERTXT title\nBLOCKERBODYTXT" });
  seedBan(db, banned);
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(blocker, blocked, now());
  const html = async (path, session) => (await call(env, path, session ? { session } : {})).text();

  const shown = await html("/posts/" + visible);
  const main = shown.slice(shown.indexOf("<main"), shown.indexOf("</main>"));
  assert.match(main, /<h1[^>]*>SSRTITLEOK &lt;b&gt;bold&lt;\/b&gt;<\/h1>/, "title escaped in an <h1>");
  assert.ok(main.includes("OKBODYTXT"), "opening text present");
  assert.ok(!shown.includes("SSRSPOILER"), "spoiler masked");
  assert.equal((shown.match(/<h1\b/g) || []).length, 1, "exactly one <h1>");

  for (const [id, needles] of [[hidden, ["HIDDENROOTTXT", "HIDDENBODYTXT"]], [bannedRoot, ["BANNEDTXT", "BANNEDBODYTXT"]]]) {
    const text = await html("/posts/" + id);
    for (const needle of needles) assert.ok(!text.includes(needle), needle + " leaked");
  }
  const blockedView = await html("/posts/" + blockerRoot, forgeSession(db, blocked));
  for (const needle of ["BLOCKERTXT", "BLOCKERBODYTXT"]) assert.ok(!blockedView.includes(needle), needle + " leaked to blocked");
  const blockerView = await html("/posts/" + blockerRoot, forgeSession(db, blocker));
  assert.ok(blockerView.includes("BLOCKERBODYTXT"), "the author's own thread still renders");
});
