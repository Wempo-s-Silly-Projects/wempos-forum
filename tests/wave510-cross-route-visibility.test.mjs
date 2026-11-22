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
  "STAFFONLYTXT", "staffonly-referrer",
  // Wave 5.38: an expired custom status never reaches any route.
  "STALESTATUSTXT",
  // Wave 5.43: staff notes on members (migration 0069) never reach any
  // member-facing payload, export, feed, search, MCP read or page head —
  // not even the noted member's own.
  "STAFFNOTETXT"];
const SIDE_FORBIDDEN = { zzblocker: ["BLOCKEDTXT", "zzblocked"], zzblocked: ["BLOCKERTXT", "zzblocker"] };
// Wave 5.42: private data with one owner — forbidden to every other viewer
// (guest, members, both pair sides, staff) on every route.
// Wave 5.47: the viewer's private notes about members (migration 0072) —
// about alice, the zzblocker pair side and the banned member — reach no one
// but the viewer: not the subject, not staff, not guests.
// Wave 5.48: the viewer's saved searches (migration 0073) — name and query
// — reach no one but the viewer: not other members, not staff, not guests.
const OWNER_ONLY = { PRIVATEFOLDERTXT: "viewer", PRIVNOTETXT: "viewer", SAVEDSEARCHTXT: "viewer" };
const ownerOnlyNeedles = (member) => Object.entries(OWNER_ONLY).filter(([, owner]) => owner !== member).map(([needle]) => needle);

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
  seedStaffPicks(w, at);
  seedProfileExtras(w, at);
  seedFoldersFollows(w, at);
  seedPrivateExtras(w, at);
  seedTags(w, at);
  seedSummaries(w, at);
  await seedArchive(w);
  return w;
}

// Wave 5.38 (migration 0066): stored pins and statuses that the read must
// re-check — alice's pin points at her HIDDEN root and her status expired;
// the banned and block-paired members carry a pin and a live status each.
function seedProfileExtras(w, at) {
  const { db, id } = w;
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  run("INSERT INTO profile_pins (user_id, post_id, pinned_at) VALUES (?, ?, ?)", id.alice, w.hiddenRoot, at);
  run("INSERT INTO user_status (user_id, text, emoji, expires_at, updated_at) VALUES (?, 'STALESTATUSTXT', '', ?, ?)", id.alice, at - 1, at);
  run("INSERT INTO profile_pins (user_id, post_id, pinned_at) VALUES (?, ?, ?)", id.zzbanned, w.bannedRoot, at);
  run("INSERT INTO profile_pins (user_id, post_id, pinned_at) VALUES (?, ?, ?)", id.zzblocker, w.blockerRoot, at);
  run("INSERT INTO profile_pins (user_id, post_id, pinned_at) VALUES (?, ?, ?)", id.zzblocked, w.blockedRoot, at);
  w.expiredBanRoot = Number(db.prepare("SELECT id FROM posts WHERE author_id = ? AND parent_id IS NULL LIMIT 1").get(id.zzexpired).id);
  run("INSERT INTO profile_pins (user_id, post_id, pinned_at) VALUES (?, ?, ?)", id.zzexpired, w.expiredBanRoot, at);
  for (const [user, text] of [[id.zzbanned, "BANNEDTXT status"], [id.zzblocker, "BLOCKERTXT status"],
    [id.zzblocked, "BLOCKEDTXT status"], [id.zzexpired, "EXPIREDOKTXT status"]]) {
    run("INSERT INTO user_status (user_id, text, emoji, expires_at, updated_at) VALUES (?, ?, '', NULL, ?)", user, text, at);
  }
}

// Wave 5.39 (migration 0067): each swept member keeps a bookmark folder holding
// every fixture root (hidden, banned, both block sides, a reply under the
// hidden root), follows every swept author (raw rows, so the block pair and
// the ban are already in place) and holds a follow bell row for each of
// those roots — every read must re-check them.
function seedFoldersFollows(w, at) {
  const { db, id } = w;
  const run = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  const roots = [w.publicRoot, w.hiddenRoot, w.underHidden, w.bannedRoot, w.blockerRoot, w.blockedRoot];
  const authors = { [w.hiddenRoot]: "alice", [w.bannedRoot]: "zzbanned", [w.blockerRoot]: "zzblocker", [w.blockedRoot]: "zzblocked" };
  w.folder = {};
  for (const member of ["viewer", "zzblocker", "zzblocked"]) {
    w.folder[member] = run("INSERT INTO bookmark_folders (user_id, name, created_at) VALUES (?, 'sweep folder', ?)", id[member], at);
    for (const post of roots) {
      run("INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)", id[member], post, at);
      run("INSERT INTO bookmark_folder_items (folder_id, post_id, added_at) VALUES (?, ?, ?)", w.folder[member], post, at);
    }
    for (const author of ["alice", "zzbanned", "zzblocker", "zzblocked"]) {
      if (author === member) continue;
      run("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)", id[member], id[author], at);
    }
    for (const [post, author] of Object.entries(authors)) {
      if (author === member) continue;
      run("INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) VALUES (?, ?, ?, ?, ?)",
        id[member], Number(post), Number(post), at, "New thread from " + author);
    }
  }
}

// Wave 5.42: the viewer's private extras — a named folder (PRIVATEFOLDERTXT)
// and a muted notification kind. Only the viewer may ever read either.
function seedPrivateExtras(w, at) {
  const { db, id } = w;
  db.prepare("INSERT INTO bookmark_folders (user_id, name, created_at) VALUES (?, 'PRIVATEFOLDERTXT', ?)").run(id.viewer, at);
  db.prepare("INSERT INTO notification_prefs (user_id, muted, updated_at) VALUES (?, 'mention', ?)").run(id.viewer, at);
  // Wave 5.47: private notes. Bodies carry no username, so the owner's own
  // reads stay clean of the always-forbidden names.
  for (const [subject, tag] of [["alice", "one"], ["zzblocker", "two"], ["zzbanned", "three"]]) {
    db.prepare("INSERT INTO private_notes (owner_id, subject_id, body, updated_at) VALUES (?, ?, ?, ?)")
      .run(id.viewer, id[subject], "PRIVNOTETXT " + tag, at);
  }
  // Wave 5.48: one saved search; the needle rides both the name and the query.
  w.savedSearch = Number(db.prepare("INSERT INTO saved_searches (owner_id, name, q, created_at) VALUES (?, ?, ?, ?)")
    .run(id.viewer, "SAVEDSEARCHTXT name", "SAVEDSEARCHTXT query", at).lastInsertRowid);
  // Wave 5.52: the viewer mutes the public root (migration 0071). The flag
  // is the viewer's alone; every other viewer reads it false or absent.
  db.prepare("INSERT INTO thread_mutes (user_id, post_id, created_at) VALUES (?, ?, ?)").run(id.viewer, w.publicRoot, at);
}

// Wave 5.44 (migration 0070): one tag on every fixture root — public,
// hidden, banned author, both block sides — and on the reply under the
// hidden root. The tag listing, the thread's chips and the tag page head
// must re-check visibility for every viewer. A 1:1 DM reaction by each pair
// side rides the pair thread (counts only, never text).
// Wave 5.50 (migration 0074): a TL;DR on every fixture root — public, hidden,
// banned author, both block sides. The summary read must follow the thread's
// own visibility for every viewer; each body carries its root's needle.
function seedSummaries(w, at) {
  const { db, id } = w;
  for (const [post, writer, body] of [[w.publicRoot, id.alice, "VISIBLESUMTXT"], [w.hiddenRoot, id.alice, "HIDDENROOTTXT tldr"],
    [w.bannedRoot, id.zzbanned, "BANNEDTXT tldr"], [w.blockerRoot, id.zzblocker, "BLOCKERTXT tldr"],
    [w.blockedRoot, id.zzblocked, "BLOCKEDTXT tldr"]]) {
    db.prepare("INSERT INTO thread_summaries (post_id, body, updated_by, updated_at) VALUES (?, ?, ?, ?)").run(post, body, writer, at);
  }
}

function seedTags(w, at) {
  const { db, id } = w;
  const tag = Number(db.prepare("INSERT INTO forum_tags (slug, label, created_by, created_at) VALUES ('sweep', 'Sweep', ?, ?)")
    .run(id.boss, at).lastInsertRowid);
  for (const post of [w.publicRoot, w.hiddenRoot, w.underHidden, w.bannedRoot, w.blockerRoot, w.blockedRoot]) {
    db.prepare("INSERT INTO thread_tags (post_id, tag_id) VALUES (?, ?)").run(post, tag);
  }
  for (const row of db.prepare("SELECT id, user_id FROM dm_messages WHERE thread_id = ?").all(w.pairThread)) {
    const other = Number(row.user_id) === id.zzblocker ? id.zzblocked : id.zzblocker;
    db.prepare("INSERT INTO dm_message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, 'like', ?)").run(row.id, other, at);
  }
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
  // Wave 5.43: staff notes about the viewer, both pair sides and alice, a
  // claim on the open report (the claimer's name is desk-only) and slow mode
  // on the public root (public by design: the thread page shows it).
  for (const member of ["viewer", "zzblocker", "zzblocked", "alice"]) {
    run("INSERT INTO member_notes (member_id, author_id, body, created_at) VALUES (?, ?, ?, ?)",
      id[member], id.boss, "STAFFNOTETXT about " + member, at);
  }
  const reportId = db.prepare("SELECT id FROM reports WHERE reason = 'STAFFONLYTXT report'").get().id;
  run("INSERT INTO report_claims (report_id, staff_id, claimed_at) VALUES (?, ?, ?)", reportId, id.boss, at);
  run("INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, 60, ?, ?)", w.publicRoot, id.boss, at);
  // Wave 5.51: a staff lock on the public root. `locked` is public (the
  // thread page shows it); the reason is staff-only and carries the needle.
  run("INSERT INTO thread_locks (post_id, locked_by, reason, locked_at) VALUES (?, ?, 'STAFFONLYTXT lock reason', ?)", w.publicRoot, id.boss, at);
}

// Wave 5.35: staff picks (migration 0065). An older pick on a block-paired
// member's build, then the newest pick on a hidden showcase root — /week and
// the gallery re-check visibility, so neither may surface for anyone.
function seedStaffPicks(w, at) {
  const { db, id } = w;
  const blockedBuild = seedPost(db, { authorId: id.zzblocked, body: "zzsweep BLOCKEDTXT build", board: "showcase" });
  const hiddenBuild = seedPost(db, { authorId: id.alice, body: "zzsweep HIDDENROOTTXT build", board: "showcase", visibility: "hidden" });
  db.prepare("INSERT INTO featured_posts (post_id, picked_by, picked_at) VALUES (?, ?, ?)").run(blockedBuild, id.boss, at - 60);
  db.prepare("INSERT INTO featured_posts (post_id, picked_by, picked_at) VALUES (?, ?, ?)").run(hiddenBuild, id.boss, at);
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
    // Wave 5.35: the This-week page (JSON for every viewer, the page head too).
    ["/api/week"], ["/week"],
    // Wave 5.36: the date-range and sort filters on search (every filter
    // still applies under every combination).
    ["/api/search?q=zzsweep&in=replies&since=year&sort=new"], ["/api/search?q=zzsweep&since=week&sort=relevant"],
    ["/api/search?q=zzsweep&by=zzbanned&in=replies&since=month&sort=new"],
    // Wave 5.42: the newest-members list (v5.35). zzghost (invisible is a
    // presence setting, not a hidden account) and zzwiped (the fixture keeps
    // the user row the real account wipe deletes) may be listed; the ban and
    // the block pair may not.
    ["/api/members/newest", { allowNames: ["zzghost", "zzwiped"] }],
    // Wave 5.43: the noted member's public face (JSON + page head) and a
    // search for the note text.
    ["/api/users/viewer"], ["/users/viewer"], ["/api/search?q=STAFFNOTETXT"],
    // Wave 5.44: the tag listing (JSON + page head) and a visible thread's
    // tag chips — hidden, banned-author and block-paired roots never listed.
    ["/api/tags/sweep/posts"], ["/tag/sweep"], ["/api/posts/" + w.publicRoot + "/tags"],
    // Wave 5.47: a search for the private-note text.
    ["/api/search?q=PRIVNOTETXT"],
    // Wave 5.48: a search for the saved-search text.
    ["/api/search?q=SAVEDSEARCHTXT"],
    // Wave 5.50: the visible thread's TL;DR.
    ["/api/posts/" + w.publicRoot + "/summary"],
    // Wave 5.52: the public tag list (staff-written labels only).
    ["/api/tags"],
  ];
  if (member) {
    list.push(["/api/me/notifications"], ["/api/me/bookmarks"], ["/api/session"], ["/api/posts?mine=1"],
      ["/api/dm/threads", { keepParticipantNames: true }],
      // Wave 5.32: the data export (own words only; 1:1 partner names kept
      // like the DM list) and the account-security page.
      ["/api/me/export", { keepParticipantNames: true }], ["/api/me/security"]);
    if (member === "viewer") list.push(["/api/dm/groups/" + w.group]);
    else list.push(["/api/dm/threads/" + w.pairThread, { keepParticipantNames: true }]);
    // Wave 5.36: search inside a conversation hides banned and block-paired
    // authors exactly like the chat view.
    if (member === "viewer") list.push(["/api/dm/groups/" + w.group + "/search?q=TXT"]);
    else list.push(["/api/dm/threads/" + w.pairThread + "/search?q=TXT"]);
    // Wave 5.39: the member's bookmark folders, one folder's contents and
    // the private Following list.
    list.push(["/api/me/bookmark-folders"], ["/api/me/bookmark-folders/" + w.folder[member] + "/items"],
      ["/api/me/following"]);
    // Wave 5.42: the member's own notification preferences and follow state.
    list.push(["/api/me/notification-prefs"], ["/api/users/alice/follow"]);
    // Wave 5.47: each member's own note reads on the noted subjects (the
    // banned one included); the others also ask for "their" note about the
    // viewer, and zzblocker is itself a noted subject.
    list.push(["/api/users/alice/note"], ["/api/users/zzbanned/note"]);
    if (member !== "viewer") list.push(["/api/users/viewer/note"]);
    // Wave 5.48: each member's own saved-search list.
    list.push(["/api/me/saved-searches"]);
  }
  return list;
}

const MCP_CALLS = (w) => [["recent_posts", {}], ["search_posts", { query: "zzsweep" }], ["list_board", { board: "general" }],
  ["list_board", { board: "suggestions" }], ["get_post", { id: w.publicRoot }], ["lobby_read", {}],
  // Wave 5.43: an MCP search for the staff-note text.
  ["search_posts", { query: "STAFFNOTETXT" }],
  // Wave 5.47: an MCP search for the private-note text.
  ["search_posts", { query: "PRIVNOTETXT" }],
  // Wave 5.48: an MCP search for the saved-search text.
  ["search_posts", { query: "SAVEDSEARCHTXT" }]];

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
    const forbidden = [...ALWAYS_FORBIDDEN, ...(SIDE_FORBIDDEN[member] || []), ...ownerOnlyNeedles(member)];
    for (const [path, options = {}] of routes(w, member)) {
      if (options.guestOnly && member) continue;
      // A per-member page refuses the block pair with 403 (wave-40 law); the
      // refusal body is swept too.
      const refusable = Boolean(options.pairRefuses && SIDE_FORBIDDEN[member]);
      const text = await fetchText(w.env, path, { session, markdown: options.markdown, refusable });
      const kept = options.keepParticipantNames ? forbidden.filter((n) => !/^zz(block|banned)/.test(n)) : forbidden;
      const needles = options.allowNames ? kept.filter((n) => !options.allowNames.includes(n)) : kept;
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
  // Wave 5.36: + 3 filtered searches for each of the 4 viewers, + one
  // conversation search for each of the 3 members.
  assert.ok(swept >= 236, "swept " + swept);
  // Wave 5.39: + folders, folder contents and Following for each of the 3 members.
  assert.ok(swept >= 245, "swept " + swept);
  // Wave 5.42: + newest members for each of the 4 viewers, + prefs and the
  // follow state for each of the 3 members.
  assert.ok(swept >= 263, "swept " + swept);
  // Wave 5.43: + the noted member's profile JSON + head and a note-text
  // search for each of the 4 viewers, + one MCP note-text search each.
  assert.ok(swept >= 279, "swept " + swept);
  // Wave 5.44: + the tag listing, its page head and a thread's chips for
  // each of the 4 viewers.
  assert.ok(swept >= 291, "swept " + swept);
  // Wave 5.47: + a note-text search and an MCP note-text search for each of
  // the 4 viewers, + 2 note reads for each of the 3 members, + the read on
  // the viewer for the 2 other members.
  assert.ok(swept >= 307, "swept " + swept);
  // Wave 5.48: + a saved-search-text search and an MCP one for each of the
  // 4 viewers, + the own saved-search list for each of the 3 members.
  assert.ok(swept >= 318, "swept " + swept);
  // Wave 5.50: + the visible thread's TL;DR for each of the 4 viewers.
  assert.ok(swept >= 322, "swept " + swept);
  // Wave 5.52: + the tag list for each of the 4 viewers.
  assert.ok(swept >= 326, "swept " + swept);
});

test("wave 5.50 sweep: the TL;DR is never served for a hidden, banned-author or block-paired thread; positive controls", async () => {
  const w = await seedWorld();
  const always = [w.hiddenRoot, w.underHidden, w.bannedRoot, w.bannedReply];
  const side = { zzblocker: [w.blockedRoot, w.blockedReply], zzblocked: [w.blockerRoot, w.blockerReply] };
  let refused = 0;
  for (const member of [null, "viewer", "zzblocker", "zzblocked", "outsider"]) {
    const session = member ? forgeSession(w.db, w.id[member]) : undefined;
    const forbidden = [...ALWAYS_FORBIDDEN, ...(SIDE_FORBIDDEN[member] || [])];
    for (const postId of [...always, ...(side[member] || [])]) {
      const res = await call(w.env, "/api/posts/" + postId + "/summary", { session });
      assert.equal(res.status, 404, (member || "guest") + " summary " + postId);
      assertClean(await res.text(), forbidden, (member || "guest") + " summary " + postId);
      refused++;
    }
  }
  assert.equal(refused, 5 * 4 + 2 * 2);
  // Positive controls: the public thread for everyone; the unrelated member
  // sees both pair sides; staff read the hidden and banned-author ones.
  assert.ok((await fetchText(w.env, "/api/posts/" + w.publicRoot + "/summary")).includes("VISIBLESUMTXT"));
  const viewer = forgeSession(w.db, w.id.viewer);
  assert.ok((await fetchText(w.env, "/api/posts/" + w.blockerRoot + "/summary", { session: viewer })).includes("BLOCKERTXT tldr"));
  assert.ok((await fetchText(w.env, "/api/posts/" + w.blockedRoot + "/summary", { session: viewer })).includes("BLOCKEDTXT tldr"));
  const boss = forgeSession(w.db, w.id.boss);
  assert.ok((await fetchText(w.env, "/api/posts/" + w.hiddenRoot + "/summary", { session: boss })).includes("HIDDENROOTTXT tldr"));
  assert.ok((await fetchText(w.env, "/api/posts/" + w.bannedRoot + "/summary", { session: boss })).includes("BANNEDTXT tldr"));
});

test("wave 5.44 sweep: tags and DM reactions on hidden, banned and block-paired content", async () => {
  const w = await seedWorld();
  const outsider = forgeSession(w.db, w.id.outsider);
  for (const post of [w.hiddenRoot, w.bannedRoot]) {
    assert.equal((await call(w.env, "/api/posts/" + post + "/tags")).status, 404, "guest chips " + post);
    assert.equal((await call(w.env, "/api/posts/" + post + "/tags", { session: outsider })).status, 404, "member chips " + post);
  }
  const blocker = forgeSession(w.db, w.id.zzblocker);
  assert.equal((await call(w.env, "/api/posts/" + w.blockedRoot + "/tags", { session: blocker })).status, 404, "pair chips");
  const listed = (await (await call(w.env, "/api/tags/sweep/posts", { session: outsider })).json()).threads.map((row) => row.id);
  assert.ok(listed.includes(w.publicRoot));
  for (const post of [w.hiddenRoot, w.underHidden, w.bannedRoot]) assert.ok(!listed.includes(post), "listed " + post);
  const pairListed = (await (await call(w.env, "/api/tags/sweep/posts", { session: blocker })).json()).threads.map((row) => row.id);
  assert.ok(!pairListed.includes(w.blockedRoot), "pair listed");
  // The pair thread's messages and reactions are refused to an outsider (404).
  const pairMessage = Number(w.db.prepare("SELECT id FROM dm_messages WHERE thread_id = ? LIMIT 1").get(w.pairThread).id);
  const reacted = await call(w.env, "/api/dm/messages/" + pairMessage + "/reaction", { method: "PUT", body: { value: "like" }, session: outsider });
  assert.equal(reacted.status, 404);
  assertClean(await reacted.text(), ["BLOCKERTXT", "BLOCKEDTXT", "zzblock"], "outsider reaction");
  // Either pair side is refused (the block pair) — 403, no write.
  const before = Number(w.db.prepare("SELECT COUNT(*) AS n FROM dm_message_reactions").get().n);
  const pairSide = await call(w.env, "/api/dm/messages/" + pairMessage + "/reaction", { method: "PUT", body: { value: "dislike" }, session: blocker });
  assert.equal(pairSide.status, 403);
  assert.equal(Number(w.db.prepare("SELECT COUNT(*) AS n FROM dm_message_reactions").get().n), before);
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
  // Wave 5.36: conversation search never reveals that a conversation exists.
  for (const path of ["/api/dm/threads/" + w.pairThread + "/search?q=TXT", "/api/dm/groups/" + w.group + "/search?q=TXT"]) {
    const res = await call(w.env, path, { session: outsider });
    assert.equal(res.status, 404, path);
    assertClean(await res.text(), ["BLOCKERTXT", "BLOCKEDTXT", "GROUPOKTXT", "zzblock", "alice", "viewer"], "outsider " + path);
    assert.equal((await call(w.env, path)).status, 401, "guest " + path);
  }
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
  assert.ok((await fetchText(w.env, "/api/dm/groups/" + w.group + "/search?q=TXT", { session: viewer })).includes("GROUPOKTXT"));
  assert.ok((await fetchText(w.env, "/api/search?q=zzsweep&since=week&sort=new", { session: viewer })).includes("VISIBLEOKTXT"));
  const blocker = forgeSession(w.db, w.id.zzblocker);
  assert.ok((await fetchText(w.env, "/api/dm/threads/" + w.pairThread, { session: blocker })).includes("BLOCKERTXT dm"));
  assert.ok((await fetchText(w.env, "/api/dm/threads/" + w.pairThread + "/search?q=TXT", { session: blocker }))
    .includes("BLOCKERTXT dm"), "own messages stay searchable");
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
  "/api/admin/users/" + w.id.zzbanned + "/recent-posts",
  // Wave 5.42: the staff-pick mod log (v5.35).
  "/api/admin/staff-picks",
  // Wave 5.43: staff notes on the viewer (migration 0069).
  "/api/admin/members/" + w.id.viewer + "/notes",
  // Wave 5.51: the desk's read of a thread lock (the reason lives here only).
  "/api/admin/threads/" + w.publicRoot + "/lock"];

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
  // Wave 5.43: staff read the notes back (positive control for the needle).
  assert.ok((await fetchText(w.env, "/api/admin/members/" + w.id.viewer + "/notes", { session: boss })).includes("STAFFNOTETXT about viewer"));
  // Wave 5.51: staff read the lock reason back on the desk route (positive
  // control), while the public thread payload carries only `locked: true`.
  assert.ok((await fetchText(w.env, "/api/admin/threads/" + w.publicRoot + "/lock", { session: boss })).includes("STAFFONLYTXT lock reason"));
  assert.equal(JSON.parse(await fetchText(w.env, "/api/posts/" + w.publicRoot)).locked, true);
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

// ---- wave 5.38: profile pin and custom status (migration 0066) ----

test("wave 5.38: the profile's pin and status re-check hidden, banned, expired and block pairs on every read", async () => {
  const w = await seedWorld();
  const viewers = [["guest", undefined], ["viewer", forgeSession(w.db, w.id.viewer)],
    ["boss", forgeSession(w.db, w.id.boss)], ["self", forgeSession(w.db, w.id.alice)]];
  for (const [label, session] of viewers) {
    const alice = JSON.parse(await fetchText(w.env, "/api/users/alice", { session }));
    assert.equal(alice.pinnedThread, null, label + ": a pin on a hidden root never shows (public face, staff too)");
    assert.equal(alice.status, null, label + ": an expired status never shows");
    const banned = await fetchText(w.env, "/api/users/zzbanned", { session });
    assertClean(banned, ["BANNEDTXT"], label + " /api/users/zzbanned");
    const expired = JSON.parse(await fetchText(w.env, "/api/users/zzexpired", { session }));
    assert.equal(expired.pinnedThread?.id, w.expiredBanRoot, label + ": an expired ban keeps the pin");
    assert.equal(expired.status?.text, "EXPIREDOKTXT status", label + ": an expired ban keeps the status");
  }
  for (const [member, other, needles] of [["zzblocker", "zzblocked", ["BLOCKEDTXT"]], ["zzblocked", "zzblocker", ["BLOCKERTXT"]]]) {
    const text = await fetchText(w.env, "/api/users/" + other, { session: forgeSession(w.db, w.id[member]) });
    assertClean(text, needles, member + " -> /api/users/" + other);
    assert.equal(JSON.parse(text).unavailable, true);
  }
  // Positive control: an unrelated member sees both block-pair members' pins and statuses.
  const viewer = forgeSession(w.db, w.id.viewer);
  const blocker = JSON.parse(await fetchText(w.env, "/api/users/zzblocker", { session: viewer }));
  assert.equal(blocker.pinnedThread?.id, w.blockerRoot);
  assert.equal(blocker.status?.text, "BLOCKERTXT status");
});

// ---- wave 5.39: bookmark folders and follows (migration 0067) ----

test("wave 5.39: folder contents and the Following list re-check hidden, banned and block pairs; positive controls", async () => {
  const w = await seedWorld();
  const viewer = forgeSession(w.db, w.id.viewer);
  const folder = await fetchText(w.env, "/api/me/bookmark-folders/" + w.folder.viewer + "/items", { session: viewer });
  assert.ok(folder.includes("VISIBLEOKTXT"), "control: the public root shows");
  assert.ok(folder.includes("BLOCKERTXT") && folder.includes("BLOCKEDTXT"), "control: unrelated viewer sees both pair members");
  const following = JSON.parse(await fetchText(w.env, "/api/me/following", { session: viewer })).following.map((row) => row.username);
  assert.deepEqual(following.sort(), ["alice", "zzblocked", "zzblocker"], "the banned followee drops");
  for (const [member, other] of [["zzblocker", "zzblocked"], ["zzblocked", "zzblocker"]]) {
    const session = forgeSession(w.db, w.id[member]);
    const list = JSON.parse(await fetchText(w.env, "/api/me/following", { session })).following.map((row) => row.username);
    assert.deepEqual(list, ["alice"], member + ": the pair partner and the banned member drop");
    // A folder belongs to its owner alone, staff included.
    for (const intruder of [viewer, forgeSession(w.db, w.id.boss)]) {
      assert.equal((await call(w.env, "/api/me/bookmark-folders/" + w.folder[member] + "/items", { session: intruder })).status, 404);
    }
    // Following across the pair refuses exactly like a missing member.
    const refused = await call(w.env, "/api/users/" + other + "/follow", { method: "POST", session });
    assert.equal(refused.status, 404);
  }
});

test("wave 5.39: a new thread notifies followers except across a block pair or when the follower is banned", async () => {
  const w = await seedWorld();
  w.db.prepare("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(w.id.zzbanned, w.id.zzblocked, now());
  w.db.prepare("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(w.id.outsider, w.id.zzblocked, now());
  const created = await call(w.env, "/api/posts", { method: "POST", session: forgeSession(w.db, w.id.zzblocked),
    body: { body: "zzsweep fresh thread from the blocked side" } });
  assert.equal(created.status, 201);
  const postId = (await created.json()).id;
  const recipients = w.db.prepare("SELECT user_id FROM notifications WHERE reply_id = ?").all(postId).map((row) => Number(row.user_id)).sort((a, b) => a - b);
  assert.deepEqual(recipients, [w.id.viewer, w.id.outsider].sort((a, b) => a - b), "zzblocker (pair) and zzbanned (banned) get nothing");
});

test("wave 5.40: a follow_thread mute composes with the ban and block exclusions; the prefs read is own-row only", async () => {
  const w = await seedWorld();
  w.db.prepare("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(w.id.zzbanned, w.id.zzblocked, now());
  w.db.prepare("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(w.id.outsider, w.id.zzblocked, now());
  const prefs = "/api/me/notification-prefs";
  const muted = await call(w.env, prefs, { method: "PUT", session: forgeSession(w.db, w.id.viewer), body: { muted: ["follow_thread"] } });
  assert.equal(muted.status, 200);
  const created = await call(w.env, "/api/posts", { method: "POST", session: forgeSession(w.db, w.id.zzblocked),
    body: { body: "zzsweep 5.40 thread from the blocked side" } });
  assert.equal(created.status, 201);
  const postId = (await created.json()).id;
  const recipients = w.db.prepare("SELECT user_id FROM notifications WHERE reply_id = ?").all(postId).map((row) => Number(row.user_id));
  assert.deepEqual(recipients, [w.id.outsider], "viewer muted; zzblocker (pair) and zzbanned (banned) still get nothing");
  assert.equal((await call(w.env, prefs)).status, 401, "guests read nothing");
  for (const name of ["outsider", "zzblocker", "zzblocked", "boss"]) {
    const body = await fetchText(w.env, prefs, { session: forgeSession(w.db, w.id[name]) });
    assert.deepEqual(JSON.parse(body).muted, [], name + " never sees the viewer's mutes");
    for (const forbidden of [...ALWAYS_FORBIDDEN, "viewer"]) assert.ok(!body.includes(forbidden), name + ": " + forbidden);
  }
});

// ---- wave 5.42: the every-tenth-wave re-audit (docs/visibility-inventory.md) ----

// Staff (admin) and the site owner bypass hidden/ban/block on member reads,
// but the PUBLIC FACES (RSS, llms.txt, /week, the gallery and its staff pick,
// the sitemap, a profile's pin and status) never show hidden, banned or
// expired items to them either, and nobody's private data (folders, follows,
// notification preferences) ever reaches staff.
test("wave 5.42: staff and owner viewers — public faces stay public, private data stays its owner's", async () => {
  const w = await seedWorld();
  // DB roles (api/core/roles.mjs): "admin" = the site owner (boss), "moderator" = an admin.
  const deputy = await seedUser(w.db, { username: "deputy", role: "moderator" });
  const faces = ["/feed.xml", "/c/showcase/feed.xml", "/c/general/feed.xml", "/llms.txt", "/sitemap.xml",
    "/api/week", "/week", "/api/traditions/showcase", "/api/traditions/qotd", "/api/users/alice", "/users/alice"];
  const faceNeedles = ["HIDDENROOTTXT", "UNDERHIDDENTXT", "BANNEDTXT", "WIPEDTXT", "DOOMEDREPLYTXT", "HIDDENEDITTXT",
    "STALESTATUSTXT", "STAFFONLYTXT", "STAFFNOTETXT", ...Object.keys(OWNER_ONLY)];
  let swept = 0;
  for (const [label, session] of [["owner boss", forgeSession(w.db, w.id.boss)], ["admin deputy", forgeSession(w.db, deputy)]]) {
    for (const path of faces) {
      assertClean(await fetchText(w.env, path, { session }), faceNeedles, label + " " + path);
      swept++;
    }
    const week = JSON.parse(await fetchText(w.env, "/api/week", { session }));
    assert.equal(week.staffPick, null, label + ": the newest pick is hidden and no older pick stands in");
    const alice = JSON.parse(await fetchText(w.env, "/api/users/alice", { session }));
    assert.equal(alice.pinnedThread, null, label + ": a pin on a hidden root stays off the public face");
    assert.ok(!Object.keys(alice).some((key) => /follow/i.test(key)), label + ": no follower list or count on a profile");
    // Private stores: own rows only, and another member's folder is a 404.
    for (const path of ["/api/me/bookmark-folders", "/api/me/following", "/api/me/notification-prefs",
      // Wave 5.47: staff have no bypass — a note read is the caller's own row.
      "/api/users/alice/note", "/api/users/zzblocker/note",
      // Wave 5.48: staff have no bypass — the list is the caller's own rows.
      "/api/me/saved-searches"]) {
      const text = await fetchText(w.env, path, { session });
      assertClean(text, [...Object.keys(OWNER_ONLY), "sweep folder", "alice", "zzblock"], label + " " + path);
      swept++;
    }
    assert.deepEqual(JSON.parse(await fetchText(w.env, "/api/me/notification-prefs", { session })).muted, [], label + " prefs");
    for (const member of ["viewer", "zzblocker", "zzblocked"]) {
      const res = await call(w.env, "/api/me/bookmark-folders/" + w.folder[member] + "/items", { session });
      assert.equal(res.status, 404, label + " reads " + member + "'s folder");
      assertClean(await res.text(), ["VISIBLEOKTXT", "sweep folder"], label + " folder " + member);
    }
    assert.deepEqual(JSON.parse(await fetchText(w.env, "/api/users/alice/follow", { session })), { following: false },
      label + ": follow state is the caller's own, never the member's followers");
    // Wave 5.48: staff deleting the viewer's saved search is a 404, row kept.
    const del = await call(w.env, "/api/me/saved-searches/" + w.savedSearch, { method: "DELETE", session });
    assert.equal(del.status, 404, label + " deletes the viewer's saved search");
    assertClean(await del.text(), Object.keys(OWNER_ONLY), label + " saved-search delete");
  }
  assert.equal(swept, 2 * (11 + 3 + 2 + 1));
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM saved_searches WHERE id = ?").get(w.savedSearch).n, 1);
  // The data owner reads every private row back (positive control).
  const viewer = forgeSession(w.db, w.id.viewer);
  assert.ok((await fetchText(w.env, "/api/me/bookmark-folders", { session: viewer })).includes("PRIVATEFOLDERTXT"));
  assert.deepEqual(JSON.parse(await fetchText(w.env, "/api/me/notification-prefs", { session: viewer })).muted, ["mention"]);
  assert.deepEqual(JSON.parse(await fetchText(w.env, "/api/users/alice/follow", { session: viewer })), { following: true });
  // Wave 5.47: the note owner reads every note back, banned and block-paired
  // subjects included, and the export carries them.
  for (const [subject, tag] of [["alice", "one"], ["zzblocker", "two"], ["zzbanned", "three"]]) {
    assert.equal(JSON.parse(await fetchText(w.env, "/api/users/" + subject + "/note", { session: viewer })).note.body,
      "PRIVNOTETXT " + tag);
  }
  const exported = JSON.parse(await fetchText(w.env, "/api/me/export", { session: viewer }));
  assert.deepEqual(exported.privateNotes.map((n) => n.body).sort(), ["PRIVNOTETXT one", "PRIVNOTETXT three", "PRIVNOTETXT two"]);
  // Wave 5.48: the owner lists the saved search back and the export carries it.
  const saved = JSON.parse(await fetchText(w.env, "/api/me/saved-searches", { session: viewer })).savedSearches;
  assert.deepEqual(saved.map((s) => [s.name, s.q]), [["SAVEDSEARCHTXT name", "SAVEDSEARCHTXT query"]]);
  assert.deepEqual(exported.savedSearches.map((s) => s.name), ["SAVEDSEARCHTXT name"]);
});

// /api/members/newest (v5.35): the ban drops a member, the block pair hides
// each side from the other, staff skip only the block filter, and an expired
// ban counts as unbanned. The swept members are made the newest accounts so
// every one of them is inside the list's window.
test("wave 5.42: newest members drop the actively banned and the block pair both ways", async () => {
  const w = await seedWorld();
  const later = now() + 100;
  for (const [index, name] of ["zzbanned", "zzexpired", "zzblocker", "zzblocked"].entries()) {
    w.db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(later + index, w.id[name]);
  }
  const names = async (session) =>
    JSON.parse(await fetchText(w.env, "/api/members/newest", { session })).members.map((row) => row.username);
  for (const [label, session] of [["guest", undefined], ["viewer", forgeSession(w.db, w.id.viewer)]]) {
    const list = await names(session);
    assert.ok(!list.includes("zzbanned"), label + " lists the banned member");
    for (const name of ["zzexpired", "zzblocker", "zzblocked"]) assert.ok(list.includes(name), label + " misses " + name);
  }
  for (const [member, other] of [["zzblocker", "zzblocked"], ["zzblocked", "zzblocker"]]) {
    const list = await names(forgeSession(w.db, w.id[member]));
    assert.ok(!list.includes(other) && !list.includes("zzbanned"), member + " lists " + other);
    assert.ok(list.includes("zzexpired"), member + ": an expired ban stays listed");
  }
  const staff = await names(forgeSession(w.db, w.id.boss));
  assert.ok(staff.includes("zzblocker") && staff.includes("zzblocked") && !staff.includes("zzbanned"), "staff: block bypass, ban kept");
  const raw = await fetchText(w.env, "/api/members/newest");
  assert.ok(!/created|joined|"id"/i.test(raw), "no join time or member id leaves the server");
});

// GET /api/users/:name/follow (v5.39): a block pair answers the same 404 as a
// missing member, both ways; guests read nothing; an unrelated member's own
// state is all anyone learns.
test("wave 5.42: the follow-state read refuses the block pair both ways and guests", async () => {
  const w = await seedWorld();
  assert.equal((await call(w.env, "/api/users/alice/follow")).status, 401, "guest");
  for (const [member, other] of [["zzblocker", "zzblocked"], ["zzblocked", "zzblocker"]]) {
    const session = forgeSession(w.db, w.id[member]);
    const paired = await call(w.env, "/api/users/" + other + "/follow", { session });
    const missing = await call(w.env, "/api/users/zznobody/follow", { session });
    assert.equal(paired.status, 404, member + " -> " + other);
    assert.deepEqual(await paired.json(), await missing.json(), member + ": the pair reads exactly like a missing member");
  }
  const viewer = forgeSession(w.db, w.id.viewer);
  assert.deepEqual(JSON.parse(await fetchText(w.env, "/api/users/zzblocker/follow", { session: viewer })), { following: true });
});

// ---- wave 5.52: the every-tenth-wave re-audit (v5.43 – v5.51 surfaces) ----

// Thread mutes (v5.46, migration 0071): the flag on the detail read is the
// caller's own — every other viewer reads false (guests: no field); a mute
// write on a thread the caller cannot see is a 404 that writes nothing; and
// the muted member gets no row from a reply fan-out in that thread.
test("wave 5.52: a thread mute is its owner's alone and gated by the visibility law", async () => {
  const w = await seedWorld();
  const deputy = await seedUser(w.db, { username: "deputy", role: "moderator" });
  const flag = async (session) => JSON.parse(await fetchText(w.env, "/api/posts/" + w.publicRoot, { session })).viewerMuted;
  assert.equal(await flag(forgeSession(w.db, w.id.viewer)), true, "the owner reads their own mute");
  assert.equal(await flag(undefined), undefined, "guests carry no field");
  for (const [label, userId] of [["zzblocker", w.id.zzblocker], ["zzblocked", w.id.zzblocked], ["outsider", w.id.outsider],
    ["owner boss", w.id.boss], ["admin deputy", deputy]]) {
    assert.equal(await flag(forgeSession(w.db, userId)), false, label + " never sees the viewer's mute");
  }
  const muteRows = () => Number(w.db.prepare("SELECT COUNT(*) AS n FROM thread_mutes").get().n);
  const before = muteRows();
  const outsider = forgeSession(w.db, w.id.outsider);
  for (const [session, post, label] of [[outsider, w.hiddenRoot, "hidden root"], [outsider, w.bannedRoot, "banned root"],
    [forgeSession(w.db, w.id.zzblocker), w.blockedRoot, "pair root"], [forgeSession(w.db, w.id.zzblocked), w.blockerRoot, "pair root back"]]) {
    const res = await call(w.env, "/api/posts/" + post + "/mute", { method: "PUT", session });
    assert.equal(res.status, 404, label);
    assertClean(await res.text(), [...ALWAYS_FORBIDDEN, "BLOCKERTXT", "BLOCKEDTXT"], label);
  }
  assert.equal(muteRows(), before, "no refused mute wrote a row");
  const muted = await call(w.env, "/api/posts/" + w.publicRoot + "/mute", { method: "PUT", session: outsider });
  assert.equal(muted.status, 200, "control: a visible root mutes");
  assert.equal((await call(w.env, "/api/posts/" + w.publicRoot + "/mute", { method: "DELETE", session: outsider })).status, 200);
  // Fan-out: staff (exempt from the lock and slow mode on the root) reply
  // mentioning both members; the muted viewer gets nothing, the control does.
  const reply = await call(w.env, "/api/posts/" + w.publicRoot + "/replies", { method: "POST",
    session: forgeSession(w.db, w.id.boss), body: { body: "zzsweep 5.52 ping @viewer and @outsider" } });
  assert.equal(reply.status, 201);
  const replyId = Number((await reply.json()).id);
  const recipients = w.db.prepare("SELECT user_id FROM notifications WHERE reply_id = ?").all(replyId).map((row) => Number(row.user_id));
  assert.ok(recipients.includes(w.id.outsider), "control: the unmuted member is pinged");
  assert.ok(!recipients.includes(w.id.viewer), "the muted member is not");
});

// Thread locks (v5.51) and slow mode (v5.43): the refusals come AFTER the
// visibility check, so a lock on a thread the member cannot see answers like
// any unseen thread (never 423 — no existence oracle), web and MCP alike,
// and no refusal body carries the staff-only reason.
test("wave 5.52: lock refusals never reveal a hidden or block-paired thread, nor the reason", async () => {
  const w = await seedWorld();
  for (const post of [w.hiddenRoot, w.bannedRoot, w.blockedRoot]) {
    w.db.prepare("INSERT INTO thread_locks (post_id, locked_by, reason, locked_at) VALUES (?, ?, 'STAFFONLYTXT hidden lock', ?)")
      .run(post, w.id.boss, now());
  }
  const posts = () => Number(w.db.prepare("SELECT COUNT(*) AS n FROM posts").get().n);
  const before = posts();
  for (const [member, post] of [["outsider", w.hiddenRoot], ["outsider", w.bannedRoot], ["zzblocker", w.blockedRoot]]) {
    const res = await call(w.env, "/api/posts/" + post + "/replies", { method: "POST",
      session: forgeSession(w.db, w.id[member]), body: { body: "zzsweep 5.52 locked probe" } });
    assert.notEqual(res.status, 423, member + " learns that " + post + " is locked");
    assert.ok(res.status >= 400 && res.status < 500, member + " " + post + " -> " + res.status);
    assertClean(await res.text(), [...ALWAYS_FORBIDDEN, "BLOCKEDTXT", "locked"], member + " reply " + post);
  }
  for (const post of [w.hiddenRoot, w.bannedRoot, w.blockedRoot]) {
    const text = await mcpText(w.env, "reply", { post_id: post, body: "zzsweep 5.52 mcp probe" }, TOKENS.zzblocker, { refused: true });
    assertClean(text, [...ALWAYS_FORBIDDEN, "BLOCKEDTXT", "locked"], "mcp reply " + post);
  }
  assert.equal(posts(), before, "no probe wrote a reply");
  // Control: on the visible locked root a member gets the 423 with the
  // public copy only — never the reason or the locker.
  const visible = await call(w.env, "/api/posts/" + w.publicRoot + "/replies", { method: "POST",
    session: forgeSession(w.db, w.id.outsider), body: { body: "zzsweep 5.52 visible probe" } });
  assert.equal(visible.status, 423);
  assertClean(await visible.text(), ["STAFFONLYTXT", "boss"], "visible lock refusal");
});

// DM reactions (v5.44): inside the pair's own 1:1 thread, a reaction by the
// other side of the block pair is left out of the counts (only the reader's
// own reactions stay), both ways; removing the block restores it with no
// write. Staff read no 1:1 thread they are not in.
test("wave 5.52: DM reaction counts drop the other side of a block pair, both ways", async () => {
  const w = await seedWorld();
  const shapesFor = async (member) => {
    const thread = JSON.parse(await fetchText(w.env, "/api/dm/threads/" + w.pairThread, { session: forgeSession(w.db, w.id[member]) }));
    return thread.messages.map((message) => message.reactions);
  };
  for (const member of ["zzblocker", "zzblocked"]) {
    const shapes = await shapesFor(member);
    assert.ok(shapes.length >= 1, member + " reads the pair thread");
    for (const shape of shapes) assert.deepEqual(shape, { like: 0, dislike: 0, mine: null }, member + ": the other side's reaction is hidden");
  }
  const boss = await call(w.env, "/api/dm/threads/" + w.pairThread, { session: forgeSession(w.db, w.id.boss) });
  assert.equal(boss.status, 403, "staff are not participants");
  assertClean(await boss.text(), ["BLOCKERTXT", "BLOCKEDTXT"], "staff pair thread");
  // Positive control: lift the block and the count comes back with no write.
  w.db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(w.id.zzblocker, w.id.zzblocked);
  assert.ok((await shapesFor("zzblocker")).some((shape) => shape.like === 1), "an unblock restores the count");
});

// The data export (v4.23, sections through v5.50) as ONE surface: for every
// member kind, every section carries only rows keyed on the caller — checked
// against the database row by row — and no other member's private store.
test("wave 5.52: the data export carries only the caller's own rows in every section", async () => {
  const w = await seedWorld();
  const one = (sql, ...args) => w.db.prepare(sql).get(...args);
  const OWNED = {
    posts: [(row) => row.id, "SELECT author_id AS owner FROM posts WHERE id = ?", "SELECT COUNT(*) AS n FROM posts WHERE author_id = ?"],
    bookmarks: [(row) => row.postId, null, "SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?"],
    followedThreads: [(row) => row.postId, null, "SELECT COUNT(*) AS n FROM thread_subscriptions WHERE user_id = ?"],
    blocks: [(row) => row.id, null, "SELECT COUNT(*) AS n FROM blocks WHERE blocker_id = ?"],
    wallPosts: [(row) => row.id, "SELECT author_id AS owner FROM wall_posts WHERE id = ?", "SELECT COUNT(*) AS n FROM wall_posts WHERE author_id = ?"],
    dmReactions: [(row) => row.messageId, null, "SELECT COUNT(*) AS n FROM dm_message_reactions WHERE user_id = ?"],
    privateNotes: [null, null, "SELECT COUNT(*) AS n FROM private_notes WHERE owner_id = ?"],
    savedSearches: [null, null, "SELECT COUNT(*) AS n FROM saved_searches WHERE owner_id = ?"],
    threadSummaries: [(row) => row.postId, "SELECT updated_by AS owner FROM thread_summaries WHERE post_id = ?",
      "SELECT COUNT(*) AS n FROM thread_summaries WHERE updated_by = ?"],
  };
  const KEYED = {
    bookmarks: "SELECT 1 AS hit FROM bookmarks WHERE user_id = ? AND post_id = ?",
    followedThreads: "SELECT 1 AS hit FROM thread_subscriptions WHERE user_id = ? AND post_id = ?",
    blocks: "SELECT 1 AS hit FROM blocks WHERE blocker_id = ? AND blocked_id = ?",
    dmReactions: "SELECT 1 AS hit FROM dm_message_reactions WHERE user_id = ? AND message_id = ?",
  };
  let checked = 0;
  for (const member of ["viewer", "alice", "zzblocker", "zzblocked", "outsider", "boss"]) {
    const userId = w.id[member];
    const text = await fetchText(w.env, "/api/me/export", { session: forgeSession(w.db, userId) });
    const data = JSON.parse(text);
    assert.equal(data.profile.id, userId, member + " profile");
    for (const [section, [idOf, ownerSql, countSql]] of Object.entries(OWNED)) {
      const rows = data[section];
      assert.ok(Array.isArray(rows), member + " " + section);
      assert.equal(rows.length, Number(one(countSql, userId).n), member + " " + section + " row count is the caller's own");
      for (const row of rows) {
        if (ownerSql) assert.equal(Number(one(ownerSql, idOf(row)).owner), userId, member + " " + section + " " + idOf(row));
        if (KEYED[section]) assert.ok(one(KEYED[section], userId, idOf(row)), member + " " + section + " " + idOf(row));
        checked++;
      }
    }
    for (const message of data.directMessages) {
      const table = message.kind === "direct" ? "dm_messages" : "dm_group_messages";
      assert.equal(Number(one("SELECT user_id FROM " + table + " WHERE id = ?", message.id).user_id), userId, member + " dm " + message.id);
      checked++;
    }
    assertClean(text, [...ownerOnlyNeedles(member), "STAFFNOTETXT", "STAFFONLYTXT", "STALESTATUSTXT"], member + " export");
  }
  assert.ok(checked >= 40, "checked " + checked);
});

// Staff-only writes added in v5.43 – v5.51 refuse guests (401/403) and members
// (403) before anything is written; the claim reaches the desk only.
test("wave 5.52: v5.43 – v5.51 staff writes refuse guests and members and write nothing", async () => {
  const w = await seedWorld();
  const reportId = Number(w.db.prepare("SELECT id FROM reports LIMIT 1").get().id);
  const tagId = Number(w.db.prepare("SELECT id FROM forum_tags LIMIT 1").get().id);
  const noteId = Number(w.db.prepare("SELECT id FROM member_notes WHERE member_id = ? LIMIT 1").get(w.id.viewer).id);
  const writes = [
    ["POST", "/api/admin/members/" + w.id.viewer + "/notes", { body: "zzsweep note" }],
    ["DELETE", "/api/admin/members/" + w.id.viewer + "/notes/" + noteId, undefined],
    ["POST", "/api/admin/reports/" + reportId + "/claim", undefined],
    ["DELETE", "/api/admin/reports/" + reportId + "/claim", undefined],
    ["PUT", "/api/admin/threads/" + w.blockerRoot + "/slowmode", { seconds: 30 }],
    ["DELETE", "/api/admin/threads/" + w.publicRoot + "/slowmode", undefined],
    ["PUT", "/api/admin/threads/" + w.blockerRoot + "/lock", { reason: "zzsweep" }],
    ["DELETE", "/api/admin/threads/" + w.publicRoot + "/lock", undefined],
    ["POST", "/api/admin/tags", { slug: "zzsweep", label: "zzsweep" }],
    ["DELETE", "/api/admin/tags/" + tagId, undefined],
  ];
  const snapshot = () => ["member_notes", "report_claims", "thread_slowmode", "thread_locks", "forum_tags", "thread_tags"]
    .map((table) => Number(w.db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n)).join(",");
  const before = snapshot();
  let refused = 0;
  // A guest has no CSRF token, so requireCsrf answers 403 before the 401.
  for (const [label, session, statuses] of [["guest", undefined, [401, 403]], ["viewer", forgeSession(w.db, w.id.viewer), [403]],
    ["zzblocker", forgeSession(w.db, w.id.zzblocker), [403]]]) {
    for (const [method, path, body] of writes) {
      const res = await call(w.env, path, { method, session, body });
      assert.ok(statuses.includes(res.status), label + " " + method + " " + path + " -> " + res.status);
      assertClean(await res.text(), [...ALWAYS_FORBIDDEN, "boss"], label + " " + method + " " + path);
      refused++;
    }
  }
  assert.equal(refused, 3 * writes.length);
  assert.equal(snapshot(), before, "no refused write changed a staff store");
  const queue = await fetchText(w.env, "/api/admin/reports", { session: forgeSession(w.db, w.id.boss) });
  assert.ok(queue.includes('"username":"boss"'), "control: staff see who claimed the report");
});

// Public faces for staff (v5.44): the tag listing and its page head keep
// hidden and banned-author threads off for the owner and an admin too.
test("wave 5.52: the tag listing is a public face for staff — hidden and banned stay off", async () => {
  const w = await seedWorld();
  const deputy = await seedUser(w.db, { username: "deputy", role: "moderator" });
  for (const [label, session] of [["owner boss", forgeSession(w.db, w.id.boss)], ["admin deputy", forgeSession(w.db, deputy)]]) {
    const listing = await fetchText(w.env, "/api/tags/sweep/posts", { session });
    assertClean(listing, ["HIDDENROOTTXT", "UNDERHIDDENTXT", "BANNEDTXT", "STAFFONLYTXT", "STAFFNOTETXT"], label + " listing");
    const ids = JSON.parse(listing).threads.map((row) => row.id);
    assert.ok(ids.includes(w.blockerRoot) && ids.includes(w.blockedRoot), label + ": staff skip only the block filter");
    assertClean(await fetchText(w.env, "/tag/sweep", { session }), ["HIDDENROOTTXT", "BANNEDTXT", "STAFFONLYTXT"], label + " head");
  }
});
