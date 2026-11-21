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

// Wave 2026-11-21-9: F1 member activity peek (mods), F2 hide a spam run +
// restore (mods), F3 jump to the latest reply (members). Authz cases first.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { createMemberPeek, createHideRecentForm, HIDE_RECENT_MAX } from "../public/js/desk/member-tools.js";
import { createReportQueue } from "../public/js/desk/reports.js";
import { createLatestReplyJump, LATEST_JUMP_MIN_REPLIES } from "../public/js/latest-reply.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

let env, db, u, s;
const visibilityOf = (id) => db.prepare("SELECT visibility FROM posts WHERE id = ?").get(id).visibility;

beforeEach(async () => {
  env = makeEnv();
  db = env.__sqlite;
  u = {
    owner: await seedUser(db, { username: "Owner", role: "admin" }),
    mod: await seedUser(db, { username: "Mod", role: "moderator" }),
    bannedMod: await seedUser(db, { username: "BannedMod", role: "moderator" }),
    member: await seedUser(db, { username: "Member" }),
    spammer: await seedUser(db, { username: "Spammer" }),
  };
  seedBan(db, u.bannedMod, null);
  s = {
    owner: forgeSession(db, u.owner),
    mod: forgeSession(db, u.mod),
    bannedMod: forgeSession(db, u.bannedMod),
    member: forgeSession(db, u.member),
  };
});

const seedSpamRun = (n) => {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const id = seedPost(db, { authorId: u.spammer, body: `spam ${i}` });
    db.prepare("UPDATE posts SET created_at = ? WHERE id = ?").run(1_700_000_000 + i, id);
    ids.push(id);
  }
  return ids; // oldest first
};

// --- authz (F1 + F2) ---------------------------------------------------------

test("authz: activity peek is staff-only (anon 401, member 403)", async () => {
  seedSpamRun(2);
  const path = `/api/admin/users/${u.spammer}/recent-posts`;
  assert.equal((await call(env, path)).status, 401);
  assert.equal((await call(env, path, { session: s.member })).status, 403);
});

test("authz: hide-recent is staff-only (anon 403 at the Origin gate, member 403, banned mod 403) and changes nothing", async () => {
  const ids = seedSpamRun(3);
  const path = `/api/admin/users/${u.spammer}/hide-recent`;
  assert.equal((await call(env, path, { method: "POST", body: { count: 3 } })).status, 403);
  assert.equal((await call(env, path, { method: "POST", body: { count: 3 }, session: s.member })).status, 403);
  assert.equal((await call(env, path, { method: "POST", body: { count: 3 }, session: s.bannedMod })).status, 403);
  for (const id of ids) assert.equal(visibilityOf(id), "public");
});

test("authz: hide-recent without the CSRF token is refused (403) and changes nothing", async () => {
  const ids = seedSpamRun(1);
  const bad = new Request(`https://wempos-forum.com/api/admin/users/${u.spammer}/hide-recent`, {
    method: "POST",
    headers: { Cookie: s.mod.cookie, Origin: "https://wempos-forum.com", "Content-Type": "application/json" },
    body: JSON.stringify({ count: 1 }),
  });
  const { default: worker } = await import("../worker.mjs");
  const refused = await worker.fetch(bad, env, { waitUntil() {} });
  assert.equal(refused.status, 403);
  assert.equal(visibilityOf(ids[0]), "public");
});

test("authz: restore is staff-only (anon 403 at the Origin gate, member 403) and changes nothing", async () => {
  const hidden = seedPost(db, { authorId: u.spammer, body: "was hidden", visibility: "hidden" });
  const body = { ids: [hidden] };
  assert.equal((await call(env, "/api/admin/posts/unhide", { method: "POST", body })).status, 403);
  assert.equal((await call(env, "/api/admin/posts/unhide", { method: "POST", body, session: s.member })).status, 403);
  assert.equal((await call(env, "/api/admin/posts/unhide", { method: "POST", body, session: s.bannedMod })).status, 403);
  assert.equal(visibilityOf(hidden), "hidden");
});

test("authz: hide-recent refuses the owner account and the mod's own account", async () => {
  seedPost(db, { authorId: u.owner, body: "owner post" });
  seedPost(db, { authorId: u.mod, body: "mod post" });
  const owner = await call(env, `/api/admin/users/${u.owner}/hide-recent`, { method: "POST", body: { count: 1 }, session: s.mod });
  const self = await call(env, `/api/admin/users/${u.mod}/hide-recent`, { method: "POST", body: { count: 1 }, session: s.mod });
  assert.equal(owner.status, 403);
  assert.equal(self.status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE visibility = 'hidden'").get().n, 0);
});

// --- F1: activity peek -------------------------------------------------------

test("peek: newest first, capped at 10, includes hidden posts flagged, no secrets", async () => {
  const ids = seedSpamRun(12);
  db.prepare("UPDATE posts SET visibility = 'hidden' WHERE id = ?").run(ids[11]);
  const res = await call(env, `/api/admin/users/${u.spammer}/recent-posts`, { session: s.mod });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.member.username, "Spammer");
  assert.equal(data.posts.length, 10);
  assert.equal(data.posts[0].id, ids[11]);
  assert.equal(data.posts[0].hidden, true);
  assert.equal(data.posts[1].hidden, false);
  assert.equal(data.publicCount, 11);
  assert.equal(data.activeBan, false);
  const text = JSON.stringify(data);
  assert.ok(!/password|salt|email|ip_/i.test(text));
});

test("peek: unknown member 404, bad id 404", async () => {
  assert.equal((await call(env, "/api/admin/users/99999/recent-posts", { session: s.mod })).status, 404);
  assert.equal((await call(env, "/api/admin/users/0/recent-posts", { session: s.mod })).status, 404);
});

// --- F2: hide a spam run + restore --------------------------------------------

test("hide-recent: validates count (1..50 integer)", async () => {
  seedSpamRun(1);
  const path = `/api/admin/users/${u.spammer}/hide-recent`;
  for (const count of [0, 51, 2.5, "3", null]) {
    const res = await call(env, path, { method: "POST", body: { count }, session: s.mod });
    assert.equal(res.status, 400, `count ${JSON.stringify(count)}`);
  }
  assert.equal(HIDE_RECENT_MAX, 50);
});

test("hide-recent: hides only the newest N public posts and closes their open reports", async () => {
  const ids = seedSpamRun(5);
  db.prepare("INSERT INTO reports (post_id, reporter_id, reason, status, created_at) VALUES (?, ?, 'spam', 'open', 1)")
    .run(ids[4], u.member);
  db.prepare("INSERT INTO reports (post_id, reporter_id, reason, status, created_at) VALUES (?, ?, 'old', 'open', 1)")
    .run(ids[0], u.member);
  const res = await call(env, `/api/admin/users/${u.spammer}/hide-recent`, { method: "POST", body: { count: 3 }, session: s.mod });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.hidden, 3);
  assert.deepEqual([...data.postIds].sort((a, b) => a - b), [ids[2], ids[3], ids[4]]);
  assert.equal(visibilityOf(ids[0]), "public");
  assert.equal(visibilityOf(ids[1]), "public");
  assert.equal(visibilityOf(ids[4]), "hidden");
  const closed = db.prepare("SELECT status, resolved_by FROM reports WHERE post_id = ?").get(ids[4]);
  assert.equal(closed.status, "actioned");
  assert.equal(closed.resolved_by, u.mod);
  assert.equal(db.prepare("SELECT status FROM reports WHERE post_id = ?").get(ids[0]).status, "open");
  // Visibility law: the hidden run is gone for anonymous readers.
  assert.equal((await call(env, `/api/posts/${ids[4]}`)).status, 404);
});

test("hide-recent: nothing public left → 409", async () => {
  seedPost(db, { authorId: u.spammer, body: "already hidden", visibility: "hidden" });
  const res = await call(env, `/api/admin/users/${u.spammer}/hide-recent`, { method: "POST", body: { count: 5 }, session: s.mod });
  assert.equal(res.status, 409);
});

test("restore: un-hides moderator-hidden posts, skips staged uploads, validates ids", async () => {
  const ids = seedSpamRun(2);
  db.prepare("UPDATE posts SET visibility = 'hidden' WHERE author_id = ?").run(u.spammer);
  const staged = seedPost(db, { authorId: u.spammer, body: "staged", visibility: "hidden" });
  db.prepare("UPDATE posts SET staged_at = 1 WHERE id = ?").run(staged);
  const ok = await call(env, "/api/admin/posts/unhide", { method: "POST", body: { ids: [...ids, staged] }, session: s.mod });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).restored, 2);
  assert.equal(visibilityOf(ids[0]), "public");
  assert.equal(visibilityOf(staged), "hidden");
  for (const ids2 of [[], "1", [0], [1.5], Array.from({ length: 51 }, (_, i) => i + 1)]) {
    const res = await call(env, "/api/admin/posts/unhide", { method: "POST", body: { ids: ids2 }, session: s.mod });
    assert.equal(res.status, 400, JSON.stringify(ids2).slice(0, 20));
  }
  const again = await call(env, "/api/admin/posts/unhide", { method: "POST", body: { ids: [staged] }, session: s.mod });
  assert.equal(again.status, 409);
});

test("hidden desk payload marks staged uploads so Restore is offered only for mod-hidden posts", async () => {
  const hidden = seedPost(db, { authorId: u.spammer, body: "hid", visibility: "hidden" });
  const staged = seedPost(db, { authorId: u.spammer, body: "stg", visibility: "hidden" });
  db.prepare("UPDATE posts SET staged_at = 1 WHERE id = ?").run(staged);
  const data = await (await call(env, "/api/admin/hidden", { session: s.mod })).json();
  const byId = Object.fromEntries(data.hidden.map((row) => [row.id, row]));
  assert.equal(byId[hidden].staged, false);
  assert.equal(byId[staged].staged, true);
});

// --- client: desk tools ------------------------------------------------------

test("report card carries the activity peek toggle and the hide-recent form", () => {
  const list = createReportQueue([{
    id: 7, reason: "spam", reporter: { username: "Member" },
    post: { id: 3, body: "x", author: { id: 42, username: "Spammer" } },
  }], fakeDocument, { role: "admin" });
  const byData = (key, value) => [...list.querySelectorAll("button, form")].find((node) => node.dataset[key] === value);
  const peek = byData("action", "member-peek");
  assert.ok(peek);
  assert.equal(peek.dataset.userId, "42");
  assert.equal(peek.getAttribute("aria-expanded"), "false");
  const form = byData("form", "admin-hide-recent");
  assert.ok(form);
  assert.equal(form.dataset.userId, "42");
  assert.equal(form.dataset.username, "Spammer");
});

test("member peek renders bodies as text and flags hidden posts", () => {
  const node = createMemberPeek(fakeDocument, {
    member: { id: 42, username: "Spammer" }, publicCount: 1, activeBan: false,
    posts: [
      { id: 1, body: "<img src=x onerror=alert(1)>", hidden: false, threadId: 1, createdAt: "2026-11-21T00:00:00Z" },
      { id: 2, body: "gone", hidden: true, threadId: 1, createdAt: "2026-11-21T00:00:00Z" },
    ],
  });
  const items = node.querySelectorAll(".member-peek-item");
  assert.equal(items.length, 2);
  assert.ok(node.textContent.includes("<img src=x onerror=alert(1)>"));
  assert.equal(node.querySelectorAll(".member-peek-hidden").length, 1);
  assert.ok(!read("public/js/desk/member-tools.js").includes("innerHTML"));
});

test("member peek with no posts shows an empty state", () => {
  const node = createMemberPeek(fakeDocument, { member: { id: 1, username: "Q" }, posts: [], publicCount: 0, activeBan: false });
  assert.equal(node.querySelectorAll(".empty-state").length, 1);
});

test("hide-recent form bounds its count input and the submit asks for confirmation first", () => {
  const form = createHideRecentForm(fakeDocument, 42, "Spammer", 7);
  const input = form.querySelector("input");
  assert.equal(input.max, String(HIDE_RECENT_MAX));
  assert.equal(input.min, "1");
  const admin = read("public/js/routes/admin.js");
  const handler = admin.slice(admin.indexOf("async function submitHideRecent"));
  assert.ok(handler.indexOf("window.confirm") > -1);
  assert.ok(handler.indexOf("window.confirm") < handler.indexOf("api("));
  assert.match(admin, /"admin-hide-recent":/);
  assert.match(admin, /"post-restore":/);
});

// --- F3: jump to the latest reply ---------------------------------------------

test("latest-reply jump: absent below the threshold", () => {
  const list = new FakeNode("div");
  assert.equal(createLatestReplyJump(fakeDocument, list, LATEST_JUMP_MIN_REPLIES - 1), null);
  assert.equal(createLatestReplyJump(fakeDocument, null, 10), null);
});

test("latest-reply jump: finds the last reply card at click time", () => {
  const list = new FakeNode("div");
  const card = (id) => Object.assign(new FakeNode("article"), { className: "post-card" }, { dataset: { postId: String(id) } });
  list.append(card(1), card(2), card(3));
  const button = createLatestReplyJump(fakeDocument, list, 3);
  assert.equal(button.tagName.toLowerCase(), "button");
  assert.equal(button.type, "button");
  const late = card(4);
  late.scrollIntoView = () => {};
  list.append(late);
  button.dispatch("click", { preventDefault() {} });
  assert.equal(late.ownerFocused, true);
});

test("i18n: new wave-9 keys exist in en.json", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of [
    "desk.peek.show", "desk.peek.hide", "desk.peek.title", "desk.peek.empty", "desk.peek.hiddenTag",
    "desk.peek.banned", "desk.peek.publicCount.one", "desk.peek.publicCount.other",
    "desk.hideRecent.label", "desk.hideRecent.button", "desk.hideRecent.confirm.one", "desk.hideRecent.confirm.other",
    "admin.restore", "admin.msg.hidRecent.one", "admin.msg.hidRecent.other",
    "admin.msg.restored.one", "admin.msg.restored.other", "post.latestReply",
  ]) assert.equal(typeof en[key], "string", key);
});
