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

// Wave 5.10 — the whole-repo visibility re-audit (docs/drafts/visibility-
// audit-5.10.md). Extends the wave-40 sweep (kept as-is) with the standard
// fixture cast — public root, hidden root, reply under hidden, banned author,
// EXPIRED-ban author (must stay visible), block pair both directions, staff,
// guest, DM non-member — and every member-facing read that the wave-40 sweep
// did not request: edit history, profile.css, group DMs, the GIF library,
// the category feeds, by-author search, plus the four leaks this wave fixed:
//   F1 archive: a deleted thread's replies under a hidden root, and a banned
//      member's posts after their account wipe, reached /api/archive;
//   F2 bell: a lobby @mention row kept naming a since-banned or block-paired
//      member ("You were mentioned by X in chat");
//   F3 presence: /api/presence and the lobby roster listed a block-paired
//      member to the other side;
//   F4 counts: leaderboard and profile counts tallied public replies under a
//      hidden or banned-author ancestor.
// Exemptions are the wave-40 ones (staff read all; 1:1 DM rows keep the
// other participant's name; per-member pages by name keep the ban banner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountDeletionStatements } from "../api/profiles.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser, sha256 } from "./helpers/seed.mjs";

const TOKENS = { viewer: "w510-viewer-token-0123456789abcdefghijkl", zzblocker: "w510-blocker-token-0123456789abcdefghijk",
  zzblocked: "w510-blocked-token-0123456789abcdefghijk" };
const ALWAYS_FORBIDDEN = ["HIDDENROOTTXT", "UNDERHIDDENTXT", "BANNEDTXT", "DOOMEDREPLYTXT", "WIPEDTXT",
  "HIDDENEDITTXT", "zzbanned", "zzghost", "zzwiped",
  // Wave 5.32: staff-only records (reports, appeals, AutoMod, analytics
  // referrers) never reach a non-staff route.
  "STAFFONLYTXT", "staffonly-referrer"];
const SIDE_FORBIDDEN = { zzblocker: ["BLOCKEDTXT", "zzblocked"], zzblocked: ["BLOCKERTXT", "zzblocker"] };

async function seedWorld() {
  const env = makeEnv({ AGENT_TOKENS: JSON.stringify(Object.fromEntries(
    Object.entries(TOKENS).map(([name, token]) => [sha256(token), name]))) });
  const db = env.__sqlite;
  const id = {};
  for (const name of ["viewer", "alice", "zzbanned", "zzexpired", "zzblocker", "zzblocked", "zzghost", "zzwiped", "outsider"]) {
    id[name] = await seedUser(db, { username: name });
  }
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const at = now();
  const run = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  const w = { env, db, id };

  w.publicRoot = seedPost(db, { authorId: id.alice, body: "zzsweep VISIBLEOKTXT public root" });
  w.hiddenRoot = seedPost(db, { authorId: id.alice, body: "zzsweep HIDDENROOTTXT", visibility: "hidden" });
  w.underHidden = seedPost(db, { authorId: id.alice, body: "zzsweep UNDERHIDDENTXT", parentId: w.hiddenRoot });
  seedPost(db, { authorId: id.zzbanned, body: "zzsweep BANNEDTXT root", board: "suggestions" });
  const bannedRoot = seedPost(db, { authorId: id.zzbanned, body: "zzsweep BANNEDTXT ancestor root" });
  w.bannedRoot = bannedRoot;
  w.bannedReply = seedPost(db, { authorId: id.zzbanned, body: "zzsweep BANNEDTXT reply", parentId: w.publicRoot });
  seedPost(db, { authorId: id.zzexpired, body: "zzsweep EXPIREDOKTXT root" });
  seedPost(db, { authorId: id.zzexpired, body: "zzsweep EXPIREDOKTXT reply", parentId: w.publicRoot });
  w.blockerRoot = seedPost(db, { authorId: id.zzblocker, body: "zzsweep BLOCKERTXT root" });
  const blockerReply = seedPost(db, { authorId: id.zzblocker, body: "zzsweep BLOCKERTXT reply", parentId: w.publicRoot });
  w.blockedRoot = seedPost(db, { authorId: id.zzblocked, body: "zzsweep BLOCKEDTXT root" });
  const blockedReply = seedPost(db, { authorId: id.zzblocked, body: "zzsweep BLOCKEDTXT reply", parentId: w.publicRoot });
  w.blockerReply = blockerReply;
  w.blockedReply = blockedReply;
  seedPost(db, { authorId: id.alice, body: "zzsweep level two a", parentId: blockerReply });
  seedPost(db, { authorId: id.alice, body: "zzsweep level two b", parentId: blockedReply });
  // F4 count fixture: viewer's public replies under a hidden root and under a
  // banned author's root must not move viewer's public numbers.
  w.countRoot = seedPost(db, { authorId: id.alice, body: "zzsweep count hidden root", visibility: "hidden" });
  for (let i = 0; i < 3; i++) seedPost(db, { authorId: id.outsider, body: "zzsweep count reply", parentId: w.countRoot });
  seedPost(db, { authorId: id.outsider, body: "zzsweep count reply b", parentId: bannedRoot });
  // Edit history: a public root's past version is fine; a hidden root's isn't.
  run("INSERT INTO post_edits (post_id, editor_id, body, edited_at) VALUES (?, ?, 'VISIBLEEDITTXT', ?)", w.publicRoot, id.alice, at);
  run("INSERT INTO post_edits (post_id, editor_id, body, edited_at) VALUES (?, ?, 'HIDDENEDITTXT', ?)", w.hiddenRoot, id.alice, at);
  seedBan(db, id.zzbanned);
  seedBan(db, id.zzexpired, -3600);
  run("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)", id.zzblocker, id.zzblocked, at);

  for (const [author, body] of [[id.zzbanned, "BANNEDTXT"], [id.zzblocker, "BLOCKERTXT"], [id.zzblocked, "BLOCKEDTXT"]]) {
    run("INSERT INTO wall_posts (owner_id, author_id, body, created_at) VALUES (?, ?, ?, ?)", id.alice, author, body + " wall", at);
    run("INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)", author, body + " lobby", at);
  }
  // Presence: every swept identity online (F3 needs both sides of the pair).
  for (const [user, invisible] of [[id.zzbanned, 0], [id.zzghost, 1], [id.alice, 0], [id.zzblocker, 0], [id.zzblocked, 0]]) {
    run("INSERT INTO presence (user_id, last_seen, invisible) VALUES (?, ?, ?)", user, at, invisible);
  }
  // F2: lobby @mention bell rows (label-only) naming each swept actor.
  for (const member of ["viewer", "zzblocker", "zzblocked"]) {
    for (const actor of ["zzbanned", "zzblocker", "zzblocked", "alice"]) {
      if (actor === member) continue;
      run("INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) VALUES (?, NULL, NULL, ?, ?)",
        id[member], at, "You were mentioned by " + actor + " in chat");
      // Wave 5.34: invite-join bell rows name the new member the same way.
      run("INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) VALUES (?, NULL, NULL, ?, ?)",
        id[member], at, "Your friend " + actor + " joined using your invite link");
    }
  }
  // DMs: the pair's thread; each member with the banned one; a group with a
  // banned member's line (the outsider is in none of them).
  const thread = (a, b) => run("INSERT INTO dm_threads (user_a, user_b, created_at, unread_a, unread_b) VALUES (?, ?, ?, 1, 1)",
    Math.min(a, b), Math.max(a, b), at);
  w.pairThread = thread(id.zzblocker, id.zzblocked);
  run("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, 'BLOCKERTXT dm', ?)", w.pairThread, id.zzblocker, at);
  run("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, 'BLOCKEDTXT dm', ?)", w.pairThread, id.zzblocked, at);
  for (const member of ["viewer", "zzblocker", "zzblocked"]) {
    const t = thread(id[member], id.zzbanned);
    run("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, 'BANNEDTXT dm', ?)", t, id.zzbanned, at);
  }
  w.group = run("INSERT INTO dm_groups (creator_id, name, created_at) VALUES (?, 'sweep', ?)", id.viewer, at);
  for (const member of ["viewer", "alice", "zzbanned"]) {
    run("INSERT INTO dm_group_members (group_id, user_id, joined_at, unread) VALUES (?, ?, ?, 1)", w.group, id[member], at);
  }
  run("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, 'BANNEDTXT group', ?)", w.group, id.zzbanned, at);
  run("INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (?, ?, 'GROUPOKTXT', ?)", w.group, id.alice, at);
  seedStaffOnly(w, at);
  await seedArchive(w);
  return w;
}

// Wave 5.32: one row in every staff-only store, each carrying STAFFONLYTXT.
function seedStaffOnly(w, at) {
  const { db, id } = w;
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  run("INSERT INTO reports (post_id, reporter_id, reason, created_at) VALUES (?, ?, 'STAFFONLYTXT report', ?)", w.publicRoot, id.outsider, at);
  run("INSERT INTO profile_reports (profile_user_id, reporter_id, reason, created_at) VALUES (?, ?, 'STAFFONLYTXT profile', ?)", id.alice, id.outsider, at);
  run("INSERT INTO dm_reports (thread_id, reporter_id, reason, created_at) VALUES (?, ?, 'STAFFONLYTXT dm report', ?)", w.pairThread, id.zzblocker, at);
  run("INSERT INTO appeals (user_id, kind, body, created_at) VALUES (?, 'ban', 'STAFFONLYTXT appeal', ?)", id.zzbanned, at);
  run("INSERT INTO automod_actions (action, target_type, target_id, target_user_id, reason, created_at) " +
    "VALUES ('report', 'post', ?, ?, 'STAFFONLYTXT automod', ?)", w.publicRoot, id.alice, at);
  run("INSERT INTO referrer_counts (day, referrer_host, views) VALUES (date('now'), 'staffonly-referrer.example', 7)");
}

// F1, driven through the real write routes: alice deletes a thread whose
// root was hidden (a member's public reply rides along into the archive),
// and the banned member zzwiped deletes their account.
async function seedArchive(w) {
  const doomed = seedPost(w.db, { authorId: w.id.alice, body: "zzsweep doomed root", visibility: "hidden" });
  seedPost(w.db, { authorId: w.id.outsider, body: "zzsweep DOOMEDREPLYTXT", parentId: doomed });
  seedPost(w.db, { authorId: w.id.zzwiped, body: "zzsweep WIPEDTXT root" });
  seedPost(w.db, { authorId: w.id.zzwiped, body: "zzsweep WIPEDTXT reply", parentId: w.publicRoot });
  const deletable = seedPost(w.db, { authorId: w.id.alice, body: "zzsweep ARCHIVEOKTXT plain root" });
  seedBan(w.db, w.id.zzwiped);
  const alice = forgeSession(w.db, w.id.alice);
  for (const postId of [doomed, deletable]) {
    const res = await call(w.env, "/api/posts/" + postId, { method: "DELETE", session: alice });
    assert.equal(res.status, 200, "delete " + postId);
  }
  // The account wipe's own archive statement (accountDeletionStatements[0]),
  // then the rows the rest of that batch removes. The full route is not
  // driven: the local schema lacks the retired gc_messages table that
  // fleet_boosts still references, so the users DELETE cannot run here.
  const [archive] = accountDeletionStatements(w.env.FORUM_DB, w.id.zzwiped,
    { archiveReason: "account-delete", deletedAt: now(), deletedByName: "zzwiped" });
  await archive.run();
  w.db.prepare("DELETE FROM bans WHERE user_id = ?").run(w.id.zzwiped);
  w.db.prepare("DELETE FROM posts WHERE author_id = ?").run(w.id.zzwiped);
}

function routes(w, member) {
  const list = [
    ["/api/posts"], ["/api/posts?sort=new"], ["/api/posts?board=suggestions"], ["/api/posts?board=general"],
    ["/api/posts?board=general&sort=new"], ["/api/posts?unanswered=1"],
    ["/api/search?q=zzsweep"], ["/api/search?q=zzsweep&in=replies"], ["/api/search?q=zzsweep&by=zzbanned&in=replies"],
    ["/api/posts/" + w.publicRoot], ["/api/posts/" + w.publicRoot + "/replies"], ["/api/posts/" + w.publicRoot + "/edits"],
    ["/api/users/" + w.id.alice + "/threads"], ["/api/users/" + w.id.alice + "/wall"], ["/api/users/alice"],
    ["/api/leaderboard"], ["/api/presence"], ["/api/chat"], ["/api/chat?after=0"], ["/api/gifs"],
    ["/api/traditions/qotd"], ["/api/traditions/showcase"], ["/api/archive"],
    ["/sitemap.xml", { guestOnly: true }], ["/", { guestOnly: true, markdown: true }],
    ["/c/general", { guestOnly: true, markdown: true }], ["/c/suggestions", { guestOnly: true, markdown: true }],
    ["/posts/" + w.publicRoot, { guestOnly: true, markdown: true }],
    // Wave 5.32: the v5.31 page heads + JSON-LD (api/seo.mjs) for every
    // viewer — hidden, banned-author and block-paired threads and profiles
    // must render the generic head; plus the remaining public JSON reads.
    ["/posts/" + w.publicRoot], ["/posts/" + w.hiddenRoot], ["/posts/" + w.bannedRoot],
    ["/posts/" + w.blockerRoot], ["/posts/" + w.blockedRoot],
    ["/users/zzbanned"], ["/users/zzblocker"], ["/users/zzblocked"], ["/c/general"], ["/"],
    ["/api/rules"], ["/api/branding"], ["/api/posts?board=polls"], ["/api/posts?board=showcase"],
    ["/api/users/" + w.id.zzblocker + "/threads", { pairRefuses: true }],
    ["/api/users/" + w.id.zzblocked + "/threads", { pairRefuses: true }],
    ["/api/search?q=STAFFONLYTXT"],
    // Wave 5.34: the RSS feeds (anonymous visibility, cacheable, so guest
    // only) and the static llms.txt summary.
    ["/feed.xml", { guestOnly: true }], ["/c/general/feed.xml", { guestOnly: true }],
    ["/c/suggestions/feed.xml", { guestOnly: true }], ["/c/showcase/feed.xml", { guestOnly: true }],
    ["/llms.txt", { guestOnly: true }],
  ];
  if (member) {
    list.push(["/api/me/notifications"], ["/api/me/bookmarks"], ["/api/session"], ["/api/posts?mine=1"],
      ["/api/dm/threads", { keepParticipantNames: true }],
      // Wave 5.32: the data export (own words only; 1:1 partner names kept
      // like the DM list) and the account-security page.
      ["/api/me/export", { keepParticipantNames: true }], ["/api/me/security"]);
    if (member === "viewer") list.push(["/api/dm/groups/" + w.group]);
    else list.push(["/api/dm/threads/" + w.pairThread, { keepParticipantNames: true }]);
  }
  return list;
}

const MCP_CALLS = (w) => [["recent_posts", {}], ["search_posts", { query: "zzsweep" }], ["list_board", { board: "general" }],
  ["list_board", { board: "suggestions" }], ["get_post", { id: w.publicRoot }], ["lobby_read", {}]];

async function fetchText(env, path, { session, markdown, refusable } = {}) {
  const res = await call(env, path, { session, headers: markdown ? { Accept: "text/markdown" } : {} });
  if (refusable && res.status === 403) return res.text();
  assert.equal(res.status, 200, path);
  return res.text();
}

async function mcpText(env, name, args, token, { refused = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await call(env, "/mcp", { method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const reply = await res.json();
  assert.equal(reply.result.isError, refused, name);
  return reply.result.content[0].text;
}

function assertClean(text, forbidden, where) {
  for (const needle of forbidden) assert.ok(!text.includes(needle), where + " leaks " + needle);
}

test("wave 5.10 sweep: no hidden, banned, wiped, invisible, or block-paired content or identity on any route", async () => {
  const w = await seedWorld();
  const viewers = [["guest", null], ["viewer", "viewer"], ["zzblocker", "zzblocker"], ["zzblocked", "zzblocked"]];
  let swept = 0;
  for (const [label, member] of viewers) {
    const session = member ? forgeSession(w.db, w.id[member]) : undefined;
    const forbidden = [...ALWAYS_FORBIDDEN, ...(SIDE_FORBIDDEN[member] || [])];
    for (const [path, options = {}] of routes(w, member)) {
      if (options.guestOnly && member) continue;
      // A per-member page refuses the block pair with 403 (wave-40 law); the
      // refusal body is swept too.
      const refusable = Boolean(options.pairRefuses && SIDE_FORBIDDEN[member]);
      const text = await fetchText(w.env, path, { session, markdown: options.markdown, refusable });
      const needles = options.keepParticipantNames ? forbidden.filter((n) => !/^zz(block|banned)/.test(n)) : forbidden;
      assertClean(text, needles, label + " " + path);
      swept++;
    }
    for (const [name, args] of MCP_CALLS(w)) {
      assertClean(await mcpText(w.env, name, args, member ? TOKENS[member] : null), forbidden, label + " mcp " + name);
      swept++;
    }
    if (member) {
      assertClean(await mcpText(w.env, "list_mentions", {}, TOKENS[member]), forbidden, label + " mcp list_mentions");
      swept++;
    }
  }
  assert.ok(swept >= 142, "swept " + swept); // 28 guest + 3 x (23 + 6 member) + MCP 6x4 + 3
  // Wave 5.32: + 17 page-head and public reads for each of the 4 viewers,
  // + export and security for each of the 3 members.
  assert.ok(swept >= 216, "swept " + swept);
  // Wave 5.34: + 4 feeds and llms.txt for the guest.
  assert.ok(swept >= 221, "swept " + swept);
});

test("wave 5.10 sweep: hidden-root reads are 404 and the DM non-member is refused", async () => {
  const w = await seedWorld();
  const outsider = forgeSession(w.db, w.id.outsider);
  for (const path of ["/api/posts/" + w.hiddenRoot, "/api/posts/" + w.hiddenRoot + "/replies",
    "/api/posts/" + w.hiddenRoot + "/edits"]) {
    assert.equal((await call(w.env, path)).status, 404, "guest " + path);
    assert.equal((await call(w.env, path, { session: outsider })).status, 404, "member " + path);
  }
  const md = await call(w.env, "/posts/" + w.hiddenRoot, { headers: { Accept: "text/markdown" } });
  assert.equal(md.status, 404);
  const thread = await call(w.env, "/api/dm/threads/" + w.pairThread, { session: outsider });
  assert.equal(thread.status, 403);
  assertClean(await thread.text(), ["BLOCKERTXT", "BLOCKEDTXT", "zzblock"], "outsider thread");
  const group = await call(w.env, "/api/dm/groups/" + w.group, { session: outsider });
  assert.equal(group.status, 404);
  assertClean(await group.text(), ["GROUPOKTXT", "alice", "viewer"], "outsider group");
  assert.equal((await call(w.env, "/api/dm/threads/" + w.pairThread)).status, 401);
});

test("wave 5.10 sweep: positive controls — expired bans, unrelated members, own content, and staff", async () => {
  const w = await seedWorld();
  const viewer = forgeSession(w.db, w.id.viewer);
  const feed = await fetchText(w.env, "/api/posts", { session: viewer });
  for (const needle of ["VISIBLEOKTXT", "BLOCKERTXT", "BLOCKEDTXT", "EXPIREDOKTXT"]) assert.ok(feed.includes(needle), needle);
  assert.ok((await fetchText(w.env, "/api/posts/" + w.publicRoot)).includes("EXPIREDOKTXT reply"));
  assert.ok((await fetchText(w.env, "/api/posts/" + w.publicRoot + "/edits")).includes("VISIBLEEDITTXT"));
  assert.ok((await fetchText(w.env, "/api/archive")).includes("ARCHIVEOKTXT"), "a plain deletion stays archived");
  const rss = await fetchText(w.env, "/feed.xml");
  for (const needle of ["VISIBLEOKTXT", "EXPIREDOKTXT", "BLOCKERTXT"]) assert.ok(rss.includes(needle), "feed " + needle);
  const presence = await fetchText(w.env, "/api/presence", { session: viewer });
  assert.ok(presence.includes("zzblocker") && presence.includes("zzblocked"), "unrelated members see both sides online");
  const bell = await fetchText(w.env, "/api/me/notifications", { session: viewer });
  assert.ok(bell.includes("mentioned by zzblocked in chat") && bell.includes("mentioned by alice in chat"));
  assert.ok(bell.includes("Your friend zzblocked joined") && bell.includes("Your friend alice joined"));
  assert.ok((await fetchText(w.env, "/api/dm/groups/" + w.group, { session: viewer })).includes("GROUPOKTXT"));
  const blocker = forgeSession(w.db, w.id.zzblocker);
  assert.ok((await fetchText(w.env, "/api/dm/threads/" + w.pairThread, { session: blocker })).includes("BLOCKERTXT dm"));
  assert.ok((await fetchText(w.env, "/api/me/notifications", { session: blocker })).includes("mentioned by alice in chat"));
  const boss = forgeSession(w.db, w.id.boss);
  assert.ok((await fetchText(w.env, "/api/posts/" + w.hiddenRoot, { session: boss })).includes("HIDDENROOTTXT"));
  assert.ok((await fetchText(w.env, "/api/posts/" + w.hiddenRoot + "/edits", { session: boss })).includes("HIDDENEDITTXT"));
  assert.ok((await fetchText(w.env, "/api/posts/" + w.publicRoot, { session: boss })).includes("BANNEDTXT reply"));
  const bossPresence = await fetchText(w.env, "/api/presence", { session: boss });
  assert.ok(bossPresence.includes("zzblocker") && bossPresence.includes("zzblocked"));
  // The hidden/banned archive rows still exist for staff in D1.
  const archived = w.db.prepare("SELECT COUNT(*) AS n FROM post_archive WHERE body LIKE '%DOOMEDREPLYTXT%' OR body LIKE '%WIPEDTXT%'").get();
  assert.equal(Number(archived.n), 3);
});

// ---- per-fix pins (RED before the wave-5.10 fixes) ----

test("F1 archive: replies under a deleted hidden root and a banned member's wiped posts stay off /api/archive", async () => {
  const w = await seedWorld();
  const text = await fetchText(w.env, "/api/archive");
  assertClean(text, ["DOOMEDREPLYTXT", "WIPEDTXT"], "archive");
  const rows = w.db.prepare("SELECT body, visibility FROM post_archive ORDER BY id").all();
  for (const row of rows) {
    const expected = /DOOMED|WIPED|doomed root/.test(row.body) ? "hidden" : "public";
    assert.equal(row.visibility, expected, row.body);
  }
});

test("F2 bell: a lobby @mention row naming a banned or block-paired member drops from the list and the badge", async () => {
  const w = await seedWorld();
  for (const [member, gone] of [["viewer", ["zzbanned"]], ["zzblocker", ["zzbanned", "zzblocked"]], ["zzblocked", ["zzbanned", "zzblocker"]]]) {
    const session = forgeSession(w.db, w.id[member]);
    const list = JSON.parse(await fetchText(w.env, "/api/me/notifications", { session })).notifications;
    const labels = list.map((row) => row.label).filter(Boolean);
    for (const actor of gone) assert.ok(!labels.some((label) => label.includes(actor)), member + " sees " + actor);
    const badge = JSON.parse(await fetchText(w.env, "/api/session", { session })).unreadNotifications;
    assert.equal(badge, list.filter((row) => !row.read).length, member + " badge matches the list");
  }
});

test("F3 presence: neither side of a block pair sees the other on /api/presence or the lobby roster", async () => {
  const w = await seedWorld();
  for (const [member, other] of [["zzblocker", "zzblocked"], ["zzblocked", "zzblocker"]]) {
    const session = forgeSession(w.db, w.id[member]);
    const online = JSON.parse(await fetchText(w.env, "/api/presence", { session })).online.map((row) => row.username);
    assert.ok(!online.includes(other), member + " presence lists " + other);
    assert.ok(online.includes("alice"));
    const roster = JSON.parse(await fetchText(w.env, "/api/chat", { session })).onlineMembers.map((row) => row.username);
    assert.ok(!roster.includes(other), member + " roster lists " + other);
  }
});

test("F4 counts: replies under a hidden or banned-author root count on neither the leaderboard nor the profile", async () => {
  const w = await seedWorld();
  const board = JSON.parse(await fetchText(w.env, "/api/leaderboard")).allTime.leaderboard;
  assert.ok(!board.some((row) => row.username === "outsider"), "outsider's only replies are under hidden/banned roots");
  for (const session of [undefined, forgeSession(w.db, w.id.viewer)]) {
    const profile = JSON.parse(await fetchText(w.env, "/api/users/outsider", { session }));
    assert.equal(profile.repliesCount, 0);
  }
  const own = JSON.parse(await fetchText(w.env, "/api/users/outsider", { session: forgeSession(w.db, w.id.outsider) }));
  assert.equal(own.repliesCount, 4, "the member's own view keeps the full count");
  const boss = JSON.parse(await fetchText(w.env, "/api/users/outsider", { session: forgeSession(w.db, w.id.boss) }));
  assert.equal(boss.repliesCount, 4, "staff keep the full count");
});

// ---- wave 5.32: staff-only stores and the page heads ----

const STAFF_ONLY_GETS = (w) => ["/api/admin/reports", "/api/admin/profile-reports", "/api/admin/dm-reports",
  "/api/admin/appeals", "/api/admin/automod", "/api/automod/queue", "/api/admin/analytics", "/api/admin/hidden",
  "/api/admin/bans", "/api/admin/chat", "/api/admin/dms", "/api/admin/avatars", "/api/admin/attachments",
  "/api/admin/gifs", "/api/admin/css", "/api/admin/filter", "/api/admin/users/search?q=zz",
  "/api/admin/users/" + w.id.zzbanned + "/recent-posts"];

test("wave 5.32 sweep: every staff-only read refuses guests and members and leaks nothing", async () => {
  const w = await seedWorld();
  const members = [["guest", undefined], ...["viewer", "zzblocker", "outsider"].map((name) => [name, forgeSession(w.db, w.id[name])])];
  let refused = 0;
  for (const path of STAFF_ONLY_GETS(w)) {
    for (const [label, session] of members) {
      const res = await call(w.env, path, { session });
      // 404 only where the store is off entirely (the AutoMod key route).
      const ok = [401, 403].includes(res.status) || (path.startsWith("/api/automod/") && res.status === 404);
      assert.ok(ok, label + " " + path + " -> " + res.status);
      assertClean(await res.text(), [...ALWAYS_FORBIDDEN, "VISIBLEOKTXT"], label + " " + path);
      refused++;
    }
  }
  assert.equal(refused, STAFF_ONLY_GETS(w).length * 4);
  const boss = forgeSession(w.db, w.id.boss);
  for (const path of ["/api/admin/reports", "/api/admin/appeals", "/api/admin/automod"]) {
    assert.ok((await fetchText(w.env, path, { session: boss })).includes("STAFFONLYTXT"), "staff read " + path);
  }
  assert.ok((await fetchText(w.env, "/api/admin/analytics", { session: boss })).includes("staffonly-referrer"));
});

test("wave 5.32 sweep: page heads show the thread to who may see it and the generic head otherwise", async () => {
  const w = await seedWorld();
  const head = (html) => html.slice(0, html.indexOf("</head>"));
  const guestPublic = head(await fetchText(w.env, "/posts/" + w.publicRoot));
  assert.ok(guestPublic.includes("VISIBLEOKTXT") && guestPublic.includes("DiscussionForumPosting"));
  const viewer = forgeSession(w.db, w.id.viewer);
  assert.ok(head(await fetchText(w.env, "/posts/" + w.blockerRoot, { session: viewer })).includes("BLOCKERTXT"));
  const boss = forgeSession(w.db, w.id.boss);
  for (const [path, session] of [["/posts/" + w.hiddenRoot, boss], ["/posts/" + w.bannedRoot, boss],
    ["/posts/" + w.blockerRoot, forgeSession(w.db, w.id.zzblocked)], ["/users/zzbanned", undefined]]) {
    const text = head(await fetchText(w.env, path, { session }));
    assert.ok(text.includes('name="robots" content="noindex"'), path + " is the generic noindexed head");
    assert.ok(!text.includes("DiscussionForumPosting"), path + " carries no thread JSON-LD");
  }
});

test("wave 5.32 sweep: every by-id read of a forbidden post refuses, for every viewer and the MCP twin", async () => {
  const w = await seedWorld();
  const always = [w.hiddenRoot, w.underHidden, w.bannedRoot, w.bannedReply];
  const side = { zzblocker: [w.blockedRoot, w.blockedReply], zzblocked: [w.blockerRoot, w.blockerReply] };
  let refused = 0;
  for (const member of [null, "viewer", "zzblocker", "zzblocked"]) {
    const session = member ? forgeSession(w.db, w.id[member]) : undefined;
    const forbidden = [...ALWAYS_FORBIDDEN, ...(SIDE_FORBIDDEN[member] || [])];
    for (const postId of [...always, ...(side[member] || [])]) {
      for (const path of ["/api/posts/" + postId, "/api/posts/" + postId + "/replies", "/api/posts/" + postId + "/edits"]) {
        const res = await call(w.env, path, { session });
        assert.ok([403, 404].includes(res.status), (member || "guest") + " " + path + " -> " + res.status);
        assertClean(await res.text(), forbidden, (member || "guest") + " " + path);
        refused++;
      }
      const head = await fetchText(w.env, "/posts/" + postId, { session });
      assertClean(head.slice(0, head.indexOf("</head>")), forbidden, (member || "guest") + " head " + postId);
      assertClean(await mcpText(w.env, "get_post", { id: postId }, member ? TOKENS[member] : null, { refused: true }), forbidden,
        (member || "guest") + " mcp get_post " + postId);
      refused += 2;
    }
  }
  assert.equal(refused, 4 * 4 * 5 + 2 * 2 * 5);
});

// L1 (wave 5.32): the thread head's JSON-LD reply count (api/seo.mjs) counted
// block-paired replies — and sub-replies under them — for a signed-in member,
// while the feed (viewer-aware rollup) hides them. The head must say what the
// feed says, for every viewer kind.
test("L1 head count: the JSON-LD reply count matches the viewer's feed count, block pairs included", async () => {
  const w = await seedWorld();
  for (const member of [null, "viewer", "zzblocker", "zzblocked"]) {
    const session = member ? forgeSession(w.db, w.id[member]) : undefined;
    const feed = JSON.parse(await fetchText(w.env, "/api/posts?sort=new", { session })).posts;
    const row = feed.find((post) => post.id === w.publicRoot);
    assert.ok(row, "public root in the feed");
    const html = await fetchText(w.env, "/posts/" + w.publicRoot, { session });
    const counted = Number(html.match(/"userInteractionCount":(\d+)/)[1]);
    assert.equal(counted, row.replyCount, (member || "guest") + " head count matches the feed");
  }
});

// Rows the v5.32 inventory found with no pin (behavior already correct).
test("wave 5.32 pins: no @mention ping across a block pair; pending avatars stay private; the blocks list labels direction", async () => {
  const w = await seedWorld();
  const unread = async (member) => JSON.parse(await fetchText(w.env, "/api/me/notifications",
    { session: forgeSession(w.db, w.id[member]) })).notifications.length;
  const before = { zzblocked: await unread("zzblocked"), alice: await unread("alice") };
  const created = await call(w.env, "/api/posts", { method: "POST", session: forgeSession(w.db, w.id.zzblocker),
    body: { body: "zzsweep ping @zzblocked and @alice" } });
  assert.equal(created.status, 201);
  assert.equal(await unread("zzblocked"), before.zzblocked, "no mention across the pair");
  assert.equal(await unread("alice"), before.alice + 1, "control: an unrelated member is pinged");

  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b80000000049454e44ae426082", "hex");
  w.db.prepare("UPDATE users SET avatar_status = 'pending', pending_avatar_mime = 'image/png', pending_avatar_data = ?, " +
    "pending_avatar_updated_at = ?, pending_avatar_version = 'v1' WHERE id = ?").run(png, now(), w.id.alice);
  for (const session of [undefined, forgeSession(w.db, w.id.viewer)]) {
    assert.equal((await call(w.env, "/api/avatars/" + w.id.alice, { session })).status, 404, "pending avatar is private");
  }
  assert.equal((await call(w.env, "/api/avatars/" + w.id.alice, { session: forgeSession(w.db, w.id.alice) })).status, 200);

  for (const [member, other, own] of [["zzblocker", "zzblocked", true], ["zzblocked", "zzblocker", false]]) {
    const list = JSON.parse(await fetchText(w.env, "/api/me/blocks", { session: forgeSession(w.db, w.id[member]) })).blocks;
    assert.deepEqual(list.map((row) => [row.username, row.ownDirection]), [[other, own]], member);
  }
});
