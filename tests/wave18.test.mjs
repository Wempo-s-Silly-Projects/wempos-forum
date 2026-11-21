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

// Wave 2026-11-21-18: Download my data (GET /api/me/export) plus two
// settings-page helpers (a settings filter, and a titled settings area with
// anchored sections and a jump list). Server bits drive the real worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { EXPORT_SECTION_CAPS } from "../constants.mjs";
import { createDataExportPanel, downloadMyData, EXPORT_FILE_NAME } from "../public/js/data-export.js";
import { addSectionAnchors, filterSettingsPanels, createSettingsFilter } from "../public/js/settings-tools.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

// The key names that must never appear anywhere in an export, at any depth.
const SECRET_KEYS = [
  "password_hash", "passwordHash", "password_salt", "passwordSalt",
  "totp_secret", "totpSecret", "totp_pending_secret", "totpPendingSecret",
  "code_hash", "codeHash", "backupCodes", "token_hash", "tokenHash",
  "csrf_token", "csrfToken", "session", "sessions", "ip", "ipHash", "ip_hash",
  "avatar_data", "avatarData", "pending_avatar_data", "idempotency_key",
  "idempotencyKey", "idempotency_fingerprint", "email",
];

function allKeys(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => allKeys(item, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) { found.add(key); allKeys(child, found); }
  }
  return found;
}

async function seedWorld(env = makeEnv()) {
  const db = env.__sqlite;
  const alice = await seedUser(db, { username: "alice", password: "alice-password-123" });
  const bob = await seedUser(db, { username: "bob", password: "bob-password-12345" });
  db.prepare("UPDATE users SET totp_secret = ?, totp_pending_secret = ?, totp_enabled = 1, bio = ? WHERE id = ?")
    .run("TOTPSECRETVALUEALICE", "TOTPPENDINGVALUEALICE", "alice bio", alice);
  db.prepare("INSERT INTO totp_backup_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)")
    .run(alice, "BACKUPHASHVALUEALICE", now());
  const aliceRoot = seedPost(db, { authorId: alice, body: "alice root ||own spoiler||" });
  const aliceHidden = seedPost(db, { authorId: alice, body: "alice hidden post", visibility: "hidden" });
  const bobRoot = seedPost(db, { authorId: bob, body: "bob private-ish root" });
  const aliceReply = seedPost(db, { authorId: alice, body: "alice reply", parentId: bobRoot });
  db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(alice, bobRoot, now());
  db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(bob, aliceRoot, now());
  db.prepare("INSERT INTO thread_subscriptions (user_id, post_id, created_at) VALUES (?, ?, ?)").run(alice, bobRoot, now());
  db.prepare("INSERT INTO thread_subscriptions (user_id, post_id, created_at) VALUES (?, ?, ?)").run(bob, aliceRoot, now());
  const carol = await seedUser(db, { username: "carol" });
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(alice, carol, now());
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(bob, alice, now());
  db.prepare("INSERT INTO wall_posts (owner_id, author_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(bob, alice, "alice on bob's wall", now());
  db.prepare("INSERT INTO wall_posts (owner_id, author_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(alice, bob, "bob on alice's wall", now());
  const thread = Number(db.prepare("INSERT INTO dm_threads (user_a, user_b, created_at) VALUES (?, ?, ?)")
    .run(alice, bob, now()).lastInsertRowid);
  db.prepare("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(thread, alice, "alice dm to bob", now());
  db.prepare("INSERT INTO dm_messages (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(thread, bob, "bob dm to alice", now());
  return { env, db, alice, bob, carol, aliceRoot, aliceHidden, aliceReply, bobRoot };
}

async function exportFor(world, userId) {
  const res = await call(world.env, "/api/me/export", { session: forgeSession(world.db, userId) });
  return { res, text: await res.text() };
}

// --- F1 server: GET /api/me/export ------------------------------------------------

test("export refuses anonymous callers with 401", async () => {
  const { env } = await seedWorld();
  const res = await call(env, "/api/me/export");
  assert.equal(res.status, 401);
});

test("export answers a no-store JSON attachment", async () => {
  const world = await seedWorld();
  const { res } = await exportFor(world, world.alice);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /application\/json/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Content-Disposition"), /^attachment; filename="wempos-forum-data-\d+\.json"$/);
});

test("export carries the caller's own sections, own text unmasked", async () => {
  const world = await seedWorld();
  const data = JSON.parse((await exportFor(world, world.alice)).text);
  assert.equal(data.profile.username, "alice");
  assert.equal(data.profile.bio, "alice bio");
  assert.equal(data.settings.twoFactorEnabled, true);
  const bodies = data.posts.map((post) => post.body);
  assert.ok(bodies.includes("alice root ||own spoiler||"), "own spoiler text is exported as written");
  assert.ok(bodies.includes("alice hidden post"), "own hidden posts are still the author's data");
  assert.ok(bodies.includes("alice reply"));
  assert.deepEqual(data.bookmarks.map((row) => row.postId), [world.bobRoot]);
  assert.deepEqual(data.followedThreads.map((row) => row.postId), [world.bobRoot]);
  assert.deepEqual(data.blocks.map((row) => row.username), ["carol"]);
  assert.deepEqual(data.wallPosts.map((row) => row.body), ["alice on bob's wall"]);
  assert.deepEqual(data.directMessages.map((row) => row.body), ["alice dm to bob"]);
});

test("export never carries another member's data", async () => {
  const world = await seedWorld();
  const { text } = await exportFor(world, world.alice);
  for (const foreign of ["bob private-ish root", "bob on alice's wall", "bob dm to alice"]) {
    assert.ok(!text.includes(foreign), `foreign text leaked: ${foreign}`);
  }
  const data = JSON.parse(text);
  assert.ok(!data.blocks.some((row) => row.username === "bob"), "a block ON the caller is the blocker's data");
  assert.ok(data.posts.every((post) => post.id !== world.bobRoot));
});

test("export carries no secret column, by key name or by value", async () => {
  const world = await seedWorld();
  const { text } = await exportFor(world, world.alice);
  const keys = allKeys(JSON.parse(text));
  for (const secret of SECRET_KEYS) assert.ok(!keys.has(secret), `secret key present: ${secret}`);
  const row = world.db.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").get(world.alice);
  const tokenHashes = world.db.prepare("SELECT token_hash, csrf_token FROM sessions WHERE user_id = ?").all(world.alice);
  const values = [row.password_hash, row.password_salt, "TOTPSECRETVALUEALICE", "TOTPPENDINGVALUEALICE",
    "BACKUPHASHVALUEALICE", ...tokenHashes.flatMap((session) => [session.token_hash, session.csrf_token])];
  for (const value of values) assert.ok(!text.includes(value), "a secret value leaked into the export");
});

test("export caps every section and flags truncation", async () => {
  const world = await seedWorld();
  const insert = world.db.prepare(
    "INSERT INTO posts (author_id, body, visibility, created_at, last_activity_at, board) VALUES (?, ?, 'public', ?, ?, 'general')");
  for (let index = 0; index < EXPORT_SECTION_CAPS.posts; index += 1) insert.run(world.alice, `bulk ${index}`, now(), now());
  const data = JSON.parse((await exportFor(world, world.alice)).text);
  assert.equal(data.posts.length, EXPORT_SECTION_CAPS.posts);
  assert.equal(data.truncated.posts, true);
  assert.equal(data.truncated.bookmarks, false);
  for (const [section, cap] of Object.entries(EXPORT_SECTION_CAPS)) {
    assert.ok(Number.isSafeInteger(cap) && cap > 0, `${section} cap is a positive integer`);
    assert.ok(Array.isArray(data[section]), `${section} is a list`);
  }
});

test("export rides the shared write limiter, keyed per member", async () => {
  const { bindings } = makeLimiters(false);
  const world = await seedWorld(makeEnv(bindings));
  const { res } = await exportFor(world, world.alice);
  assert.equal(res.status, 429);
});

// --- F1 client: the settings panel's Download button -----------------------------

test("data panel renders an explicit button and fetches nothing on render", () => {
  const calls = [];
  const panel = createDataExportPanel(fakeDocument, () => { calls.push("api"); });
  const button = panel.querySelector("button");
  assert.equal(button.dataset.action, "download-my-data");
  assert.equal(button.type, "button");
  assert.equal(calls.length, 0, "no network action until the member clicks");
});

test("downloadMyData fetches the export once and saves it as a file", async () => {
  const requested = [];
  const clicked = [];
  const revoked = [];
  const doc = makeFakeDocument({ body: new FakeNode("body") });
  const realCreate = doc.createElement;
  doc.createElement = (tag) => {
    const node = realCreate(tag);
    if (tag === "a") node.click = () => clicked.push({ href: node.href, download: node.download });
    return node;
  };
  const urls = { createObjectURL: (blob) => { assert.ok(blob instanceof Blob); return "blob:x"; }, revokeObjectURL: (url) => revoked.push(url) };
  const api = async (path) => { requested.push(path); return { profile: { username: "alice" } }; };
  await downloadMyData({ api, doc, urls, schedule: (fn) => fn() });
  assert.deepEqual(requested, ["/api/me/export"]);
  assert.deepEqual(clicked, [{ href: "blob:x", download: EXPORT_FILE_NAME }]);
  assert.deepEqual(revoked, ["blob:x"]);
  assert.equal(doc.body.children.length, 0, "the temporary link is removed");
});

// --- F2: the settings filter ------------------------------------------------------

function panelsFixture() {
  const container = new FakeNode("div");
  const titles = ["Appearance", "Change password", "Two-factor sign-in"];
  const panels = titles.map((title) => {
    const panel = new FakeNode("section");
    panel.className = "panel";
    const heading = new FakeNode("h2");
    heading.textContent = title;
    panel.append(heading);
    container.append(panel);
    return panel;
  });
  return { container, panels };
}

test("filterSettingsPanels hides non-matching sections, case-insensitively", () => {
  const { panels } = panelsFixture();
  assert.equal(filterSettingsPanels(panels, "PASS"), 1);
  assert.deepEqual(panels.map((panel) => panel.hidden), [true, false, true]);
  assert.equal(filterSettingsPanels(panels, "   "), 3);
  assert.deepEqual(panels.map((panel) => panel.hidden), [false, false, false]);
});

test("createSettingsFilter wires a labelled search box with an empty-state note", () => {
  const { panels } = panelsFixture();
  const filter = createSettingsFilter(fakeDocument, panels);
  const input = filter.querySelector("input");
  const label = filter.querySelector("label");
  const empty = findByClass(filter, "settings-filter-empty");
  assert.equal(input.type, "search");
  assert.equal(label.getAttribute("for"), input.id);
  assert.equal(empty.hidden, true);
  input.value = "zzz-no-such-setting";
  input.dispatch("input");
  assert.equal(empty.hidden, false);
  assert.ok(panels.every((panel) => panel.hidden));
});

test("filtering hides the jump buttons of filtered-out sections", () => {
  const { panels } = panelsFixture();
  const nav = addSectionAnchors(fakeDocument, panels);
  const filter = createSettingsFilter(fakeDocument, panels, nav);
  const input = filter.querySelector("input");
  input.value = "two-factor";
  input.dispatch("input");
  assert.deepEqual(Array.from(nav.querySelectorAll("button")).map((button) => button.hidden), [true, true, false]);
});

// --- F3: anchored section headings + a jump list ----------------------------------

test("addSectionAnchors gives each section a stable id and a jump button", () => {
  const { panels } = panelsFixture();
  const nav = addSectionAnchors(fakeDocument, panels);
  assert.deepEqual(panels.map((panel) => panel.id),
    ["settings-appearance", "settings-change-password", "settings-two-factor-sign-in"]);
  const buttons = Array.from(nav.querySelectorAll("button"));
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((button) => button.dataset.target), panels.map((panel) => panel.id));
  assert.equal(buttons[1].textContent, "Change password");
  let scrolled = false;
  panels[1].scrollIntoView = () => { scrolled = true; };
  buttons[1].dispatch("click");
  assert.equal(scrolled, true);
  assert.equal(panels[1].querySelector("h2").ownerFocused, true, "focus follows the jump");
});

test("the account settings area is titled and carries the new panels", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /document\.createElement\("summary"\)/);
  assert.match(feed, /createDataExportPanel\(/);
  assert.match(feed, /createSettingsFilter\(/);
  assert.match(feed, /addSectionAnchors\(/);
  assert.match(feed, /"download-my-data":/);
});
