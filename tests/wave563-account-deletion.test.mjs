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

// v5.63 regression: deleting an account through POST /api/me/delete removes
// every row that names the member, across every table with a users FK, and
// leaves no orphan (PRAGMA foreign_key_check is empty). The completeness pin
// fails when a future migration adds a users-FK table this test does not seed,
// so new tables must join the sweep.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";

const ROOT = new URL("../", import.meta.url);

// One INSERT per users-FK table; `a` is the member being deleted, `b` a
// bystander. Every users column that can hold `a` does.
const SEEDS = {
  sessions: null, // forgeSession seeds it
  bans: ({ a, b, t }) => [`INSERT INTO bans (user_id, reason, created_at, created_by, revoked_by) VALUES (?, 'r', ?, ?, ?)`, [b, t, a, a]],
  post_archive: ({ a, t }) => [`INSERT INTO post_archive (original_post_id, author_id, author_name, body, created_at, deleted_at, deleted_because, deleted_by_user_id) VALUES (999, ?, 'alice', 'x', ?, ?, 'post-delete', ?)`, [a, t, t, a]],
  profile_reports: ({ a, b, t }) => [`INSERT INTO profile_reports (profile_user_id, reporter_id, reason, created_at) VALUES (?, ?, 'r', ?), (?, ?, 'r', ?)`, [a, b, t, b, a, t]],
  revoked_attachment_hashes: ({ a, t }) => [`INSERT INTO revoked_attachment_hashes (hash, revoked_at, revoked_by) VALUES ('h1', ?, ?)`, [t, a]],
  gifs: ({ a, t }) => [`INSERT INTO gifs (id, hash, uploader_id, mime, version, created_at) VALUES ('g1', 'h', ?, 'image/gif', 'v', ?)`, [a, t]],
  presence: ({ a, t }) => [`INSERT INTO presence (user_id, last_seen) VALUES (?, ?)`, [a, t]],
  chat_messages: ({ a, t }) => [`INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, 'hi', ?)`, [a, t]],
  dm_threads: ({ a, b, t }) => [`INSERT INTO dm_threads (id, user_a, user_b, created_at) VALUES (1, ?, ?, ?)`, [Math.min(a, b), Math.max(a, b), t]],
  dm_messages: ({ a, b, t }) => [`INSERT INTO dm_messages (id, thread_id, user_id, body, created_at) VALUES (1, 1, ?, 'hi', ?), (2, 1, ?, 'yo', ?)`, [a, t, b, t]],
  wall_posts: ({ a, b, t }) => [`INSERT INTO wall_posts (owner_id, author_id, body, created_at) VALUES (?, ?, 'w', ?), (?, ?, 'w', ?)`, [a, b, t, b, a, t]],
  posts: null, // seeded in seedEverything
  reactions: ({ a, p, t }) => [`INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, 'like', ?)`, [p.bob, a, t]],
  reports: ({ a, b, p, t }) => [`INSERT INTO reports (post_id, reporter_id, reason, created_at, resolved_by) VALUES (?, ?, 'r', ?, NULL), (?, ?, 'r', ?, ?)`, [p.bob, a, t, p.bob2, b, t, a]],
  post_edits: ({ a, p, t }) => [`INSERT INTO post_edits (post_id, editor_id, body, edited_at) VALUES (?, ?, 'old', ?)`, [p.alice, a, t]],
  thread_subscriptions: ({ a, p, t }) => [`INSERT INTO thread_subscriptions (user_id, post_id, created_at) VALUES (?, ?, ?)`, [a, p.bob, t]],
  bookmarks: ({ a, p, t }) => [`INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)`, [a, p.bob, t]],
  attachments: ({ a, p, t }) => [`INSERT INTO attachments (id, post_id, created_by, created_at, mime, version) VALUES ('at1', ?, ?, ?, 'image/png', 'v')`, [p.alice, a, t]],
  poll_votes: ({ a, p, t }) => [
    `INSERT INTO polls (id, post_id, question, created_at) VALUES (1, ?, 'q', ?);
     INSERT INTO poll_options (id, poll_id, label, position) VALUES (1, 1, 'o', 0);
     INSERT INTO poll_votes (poll_id, user_id, option_id, voted_at) VALUES (1, ?, 1, ?)`, [p.bob, t, a, t]],
  totp_challenges: ({ a, t }) => [`INSERT INTO totp_challenges (token_hash, user_id, created_at, expires_at) VALUES ('tc', ?, ?, ?)`, [a, t, t + 60]],
  notifications: ({ a, p, t }) => [`INSERT INTO notifications (user_id, target_post_id, created_at) VALUES (?, ?, ?)`, [a, p.bob, t]],
  blocks: ({ a, b, t }) => [`INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?), (?, ?, ?)`, [a, b, t, b, a, t]],
  totp_backup_codes: ({ a, t }) => [`INSERT INTO totp_backup_codes (user_id, code_hash, created_at) VALUES (?, 'c', ?)`, [a, t]],
  gc_fleet_boosts: ({ a, p, t }) => [`INSERT INTO gc_fleet_boosts (forum_post_id, author_id, thread_title, thread_excerpt, created_at) VALUES (?, ?, 't', 'e', ?)`, [p.alice, a, t]],
  dm_groups: ({ a, t }) => [`INSERT INTO dm_groups (id, creator_id, name, created_at) VALUES (1, ?, 'g', ?)`, [a, t]],
  dm_group_members: ({ a, b, t }) => [`INSERT INTO dm_group_members (group_id, user_id, joined_at) VALUES (1, ?, ?), (1, ?, ?)`, [a, t, b, t]],
  dm_group_messages: ({ a, t }) => [`INSERT INTO dm_group_messages (group_id, user_id, body, created_at) VALUES (1, ?, 'hi', ?)`, [a, t]],
  dm_images: ({ a, t }) => [`INSERT INTO dm_images (id, uploader_id, group_id, mime, hash, created_at) VALUES ('di', ?, 1, 'image/png', 'h', ?)`, [a, t]],
  automod_actions: ({ a, t }) => [`INSERT INTO automod_actions (action, target_type, target_id, target_user_id, reason, created_at) VALUES ('report', 'post', 1, ?, 'r', ?)`, [a, t]],
  dm_reports: ({ a, t }) => [`INSERT INTO dm_reports (thread_id, reporter_id, reason, created_at) VALUES (1, ?, 'r', ?)`, [a, t]],
  automod_profile_edits: ({ a, t }) => [`INSERT INTO automod_profile_edits (user_id, created_at) VALUES (?, ?)`, [a, t]],
  totp_algorithms: ({ a, t }) => [`INSERT INTO totp_algorithms (user_id, algorithm, created_at) VALUES (?, 'SHA256', ?)`, [a, t]],
  // Batch F (migration 0081).
  totp_used_steps: ({ a }) => [`INSERT INTO totp_used_steps (user_id, last_step) VALUES (?, 1)`, [a]],
  passkeys: ({ a, t }) => [`INSERT INTO passkeys (user_id, credential_id, public_key, name, created_at) VALUES (?, 'cred', 'pk', 'n', ?)`, [a, t]],
  webauthn_challenges: ({ a, t }) => [`INSERT INTO webauthn_challenges (challenge_hash, purpose, session_hash, user_id, expires_at) VALUES ('ch', 'register', 's', ?, ?)`, [a, t]],
  profile_pronouns: ({ a, t }) => [`INSERT INTO profile_pronouns (user_id, pronouns, updated_at) VALUES (?, 'she/her', ?)`, [a, t]],
  invites: ({ a, b, t }) => [`INSERT INTO invites (user_id, inviter_id, created_at) VALUES (?, ?, ?)`, [b, a, t]],
  featured_posts: ({ a, p, t }) => [`INSERT INTO featured_posts (post_id, picked_by, picked_at) VALUES (?, ?, ?)`, [p.bob, a, t]],
  staff_pick_log: ({ a, p, t }) => [`INSERT INTO staff_pick_log (post_id, actor_id, action, created_at) VALUES (?, ?, 'pick', ?)`, [p.bob, a, t]],
  profile_pins: ({ a, p, t }) => [`INSERT INTO profile_pins (user_id, post_id, pinned_at) VALUES (?, ?, ?)`, [a, p.alice, t]],
  user_status: ({ a, t }) => [`INSERT INTO user_status (user_id, text, updated_at) VALUES (?, 'busy', ?)`, [a, t]],
  bookmark_folders: ({ a, t }) => [`INSERT INTO bookmark_folders (user_id, name, created_at) VALUES (?, 'f', ?)`, [a, t]],
  user_follows: ({ a, b, t }) => [`INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?), (?, ?, ?)`, [a, b, t, b, a, t]],
  notification_prefs: ({ a, t }) => [`INSERT INTO notification_prefs (user_id, muted, updated_at) VALUES (?, '', ?)`, [a, t]],
  member_notes: ({ a, b, t }) => [`INSERT INTO member_notes (member_id, author_id, body, created_at) VALUES (?, ?, 'n', ?), (?, ?, 'n', ?)`, [a, b, t, b, a, t]],
  report_claims: ({ a, t }) => [`INSERT INTO report_claims (report_id, staff_id, claimed_at) VALUES ((SELECT MAX(id) FROM reports), ?, ?)`, [a, t]],
  thread_slowmode: ({ a, p, t }) => [`INSERT INTO thread_slowmode (post_id, seconds, set_by, set_at) VALUES (?, 60, ?, ?)`, [p.bob, a, t]],
  dm_message_reactions: ({ a, t }) => [`INSERT INTO dm_message_reactions (message_id, user_id, emoji, created_at) VALUES (2, ?, 'like', ?)`, [a, t]],
  forum_tags: ({ a, t }) => [`INSERT INTO forum_tags (slug, label, created_by, created_at) VALUES ('t', 'T', ?, ?)`, [a, t]],
  thread_mutes: ({ a, p, t }) => [`INSERT INTO thread_mutes (user_id, post_id, created_at) VALUES (?, ?, ?)`, [a, p.bob, t]],
  private_notes: ({ a, b, t }) => [`INSERT INTO private_notes (owner_id, subject_id, body, updated_at) VALUES (?, ?, 'n', ?), (?, ?, 'n', ?)`, [a, b, t, b, a, t]],
  saved_searches: ({ a, t }) => [`INSERT INTO saved_searches (owner_id, name, q, created_at) VALUES (?, 's', 'q', ?)`, [a, t]],
  thread_summaries: ({ a, p, t }) => [`INSERT INTO thread_summaries (post_id, body, updated_by, updated_at) VALUES (?, 'sum', ?, ?)`, [p.bob, a, t]],
  thread_locks: ({ a, p, t }) => [`INSERT INTO thread_locks (post_id, locked_by, locked_at) VALUES (?, ?, ?)`, [p.bob2, a, t]],
};

function usersFkColumns(sqlite) {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  const out = [];
  for (const table of tables) {
    for (const fk of sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all()) {
      if (fk.table === "users") out.push({ table, column: fk.from, onDelete: fk.on_delete });
    }
  }
  return out;
}

const count = (sqlite, table, column, id) =>
  sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" = ?`).get(id).n;

function runSeed(sqlite, sql, params) {
  const statements = sql.split(";").map((part) => part.trim()).filter(Boolean);
  let offset = 0;
  for (const statement of statements) {
    const binds = (statement.match(/\?/g) || []).length;
    sqlite.prepare(statement).run(...params.slice(offset, offset + binds));
    offset += binds;
  }
}

async function seedEverything(env) {
  const sqlite = env.__sqlite;
  const a = await seedUser(sqlite, { username: "alice" });
  const b = await seedUser(sqlite, { username: "bobby" });
  const session = forgeSession(sqlite, a);
  const p = {
    alice: seedPost(sqlite, { authorId: a, body: "alice root" }),
    bob: seedPost(sqlite, { authorId: b, body: "bob root" }),
    bob2: seedPost(sqlite, { authorId: b, body: "bob second root" }),
  };
  p.replyInAlice = seedPost(sqlite, { authorId: b, body: "bob reply in alice thread", parentId: p.alice });
  p.aliceReply = seedPost(sqlite, { authorId: a, body: "alice reply in bob thread", parentId: p.bob });
  const t = now();
  for (const seed of Object.values(SEEDS)) {
    if (seed) runSeed(sqlite, ...seed({ a, b, p, t }));
  }
  return { a, b, p, session };
}

test("every users-FK table is seeded by this sweep (a new table must join it)", () => {
  const env = makeEnv();
  const tables = new Set(usersFkColumns(env.__sqlite).map((fk) => fk.table));
  assert.deepEqual([...tables].sort(), Object.keys(SEEDS).sort());
});

test("the seeded member holds a row in every users-FK table before deletion", async () => {
  const env = makeEnv();
  const { a } = await seedEverything(env);
  const fks = usersFkColumns(env.__sqlite);
  for (const table of new Set(fks.map((fk) => fk.table))) {
    const held = fks.filter((fk) => fk.table === table).some((fk) => count(env.__sqlite, table, fk.column, a) > 0);
    assert.ok(held, `${table} has no row naming the member`);
  }
});

test("POST /api/me/delete wipes the member from every users-FK table and leaves no orphan", async () => {
  const env = makeEnv();
  const { a, b, p, session } = await seedEverything(env);
  const response = await call(env, "/api/me/delete", { method: "POST", body: {}, session });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  const sqlite = env.__sqlite;
  const rows = (sql, ...params) => sqlite.prepare(sql).get(...params).n;
  assert.equal(rows("SELECT COUNT(*) AS n FROM users WHERE id = ?", a), 0);
  for (const { table, column } of usersFkColumns(sqlite)) {
    assert.equal(count(sqlite, table, column, a), 0, `${table}.${column} still names the deleted member`);
  }
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  // The bystander and their own root threads survive; the bystander's reply
  // inside the member's thread goes with that thread and is archived.
  assert.equal(rows("SELECT COUNT(*) AS n FROM users WHERE id = ?", b), 1);
  assert.equal(rows("SELECT COUNT(*) AS n FROM posts WHERE id IN (?, ?)", p.bob, p.bob2), 2);
  assert.equal(rows("SELECT COUNT(*) AS n FROM posts WHERE id = ?", p.replyInAlice), 0);
  assert.equal(rows("SELECT COUNT(*) AS n FROM post_archive WHERE original_post_id = ?", p.replyInAlice), 1);
  assert.equal(rows("SELECT COUNT(*) AS n FROM dm_messages WHERE id = 2"), 0); // the DM thread cascaded
  assert.equal(rows("SELECT COUNT(*) AS n FROM dm_groups WHERE id = 1"), 1); // creator SET NULL keeps the group
});

test("migration 0076 is CREATE-only and adds just the two FK-target stubs", () => {
  const sql = readFileSync(new URL("migrations/0076_gc_fk_targets.sql", ROOT), "utf8").replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS gc_channels \(\s*id INTEGER PRIMARY KEY\s*\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS gc_messages \(\s*id INTEGER PRIMARY KEY\s*\)/);
  assert.doesNotMatch(sql, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|RENAME)\b/i);
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, 2);
});
