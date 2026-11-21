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

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { canViewPost } from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";

const DAY = 86400;
let env;
const ids = {};
const users = {};

before(async () => {
  env = makeEnv();
  const db = env.__sqlite;
  users.alice = await seedUser(db, { username: "Alice" });
  users.banned = await seedUser(db, { username: "Banned" });
  users.expired = await seedUser(db, { username: "Expired" });
  seedBan(db, users.banned, null);
  seedBan(db, users.expired, -DAY);
  ids.publicRoot = seedPost(db, { authorId: users.alice, body: "Public root title\nbody text" });
  ids.hiddenRoot = seedPost(db, { authorId: users.alice, body: "HIDDEN-ROOT", visibility: "hidden" });
  ids.bannedRoot = seedPost(db, { authorId: users.banned, body: "BANNED-ROOT" });
  ids.expiredRoot = seedPost(db, { authorId: users.expired, body: "Expired-ban root" });
  ids.replyUnderHidden = seedPost(db, { authorId: users.alice, body: "REPLY-UNDER-HIDDEN", parentId: ids.hiddenRoot });
  ids.publicReply = seedPost(db, { authorId: users.alice, body: "PUBLIC-REPLY", parentId: ids.publicRoot });
  ids.nestedPublic = seedPost(db, { authorId: users.expired, body: "NESTED-PUBLIC", parentId: ids.publicReply });
  ids.hiddenReply = seedPost(db, { authorId: users.alice, body: "HIDDEN-REPLY", parentId: ids.publicRoot, visibility: "hidden" });
  ids.nestedUnderHidden = seedPost(db, { authorId: users.alice, body: "NESTED-UNDER-HIDDEN", parentId: ids.hiddenReply });
  ids.bannedReply = seedPost(db, { authorId: users.banned, body: "BANNED-REPLY", parentId: ids.publicRoot });
});

const row = (id) => env.__sqlite.prepare("SELECT id, author_id, parent_id, visibility FROM posts WHERE id = ?").get(id);

test("canViewPost: anonymous viewer", async () => {
  assert.equal(await canViewPost(env, row(ids.publicRoot), null), true);
  assert.equal(await canViewPost(env, row(ids.hiddenRoot), null), false);
  assert.equal(await canViewPost(env, row(ids.bannedRoot), null), false);
  assert.equal(await canViewPost(env, row(ids.expiredRoot), null), true, "expired ban restores content");
  assert.equal(await canViewPost(env, row(ids.replyUnderHidden), null), false, "hidden ancestor never leaks");
  assert.equal(await canViewPost(env, row(ids.nestedUnderHidden), null), false, "hidden level-1 parent blocks level 2");
  assert.equal(await canViewPost(env, row(ids.nestedPublic), null), true);
  assert.equal(await canViewPost(env, null, null), false);
});

test("canViewPost: staff bypass the nuke rule, members do not", async () => {
  const member = { id: users.alice, role: "member" };
  const owner = { id: 999, role: "owner" };
  assert.equal(await canViewPost(env, row(ids.hiddenRoot), member), false, "even the author");
  assert.equal(await canViewPost(env, row(ids.hiddenRoot), owner), true);
  assert.equal(await canViewPost(env, row(ids.bannedRoot), { id: 999, role: "admin" }), true);
  assert.equal(await canViewPost(env, row(ids.replyUnderHidden), owner), true);
});

test("canViewPost: a block pair hides content both directions", async () => {
  const db = env.__sqlite;
  const carol = await seedUser(db, { username: "Carol" });
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, 1)").run(carol, users.alice);
  assert.equal(await canViewPost(env, row(ids.publicRoot), { id: carol, role: "member" }), false);
  const carolPost = seedPost(db, { authorId: carol, body: "carol" });
  assert.equal(await canViewPost(env, row(carolPost), { id: users.alice, role: "member" }), false);
  db.prepare("DELETE FROM blocks").run();
});

// Minimal well-formedness check: prolog, balanced tags, no raw ampersands.
function assertWellFormedXml(xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  const stack = [];
  for (const [, closing, name, selfClosing] of xml.replace(/^<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (selfClosing) continue;
    if (closing) assert.equal(stack.pop(), name, "mismatched </" + name + ">");
    else stack.push(name);
  }
  assert.deepEqual(stack, [], "unclosed tags");
  assert.doesNotMatch(xml, /&(?!(amp|lt|gt|quot|apos);)/);
}

test("/sitemap.xml lists only public roots by unbanned authors, and is well-formed", async () => {
  const response = await call(env, "/sitemap.xml");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^application\/xml/);
  const xml = await response.text();
  assertWellFormedXml(xml);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const locSet = new Set(locs);
  const has = (id) => locSet.has("https://wempos-forum.com/posts/" + id);
  assert.ok(has(ids.publicRoot));
  assert.ok(has(ids.expiredRoot));
  for (const key of ["hiddenRoot", "bannedRoot", "replyUnderHidden", "publicReply", "hiddenReply", "bannedReply"]) {
    assert.ok(!has(ids[key]), key + " must not be in the sitemap");
  }
  assert.ok(locSet.has("https://wempos-forum.com/users/Alice"));
  assert.ok(locSet.has("https://wempos-forum.com/users/Expired"));
  assert.ok(!locSet.has("https://wempos-forum.com/users/Banned"));
  assert.ok(locSet.has("https://wempos-forum.com/"));
});

const markdown = (path) => call(env, path, { headers: { Accept: "text/markdown" } });

test("markdown: a hidden post is 404, a banned author's post is 404", async () => {
  for (const id of [ids.hiddenRoot, ids.bannedRoot, ids.replyUnderHidden]) {
    const response = await markdown("/posts/" + id);
    assert.equal(response.status, 404, "post " + id);
    assert.match(response.headers.get("Vary") || "", /Accept/);
    const text = await response.text();
    assert.doesNotMatch(text, /HIDDEN|BANNED/);
  }
});

test("markdown: a public post keeps public replies and drops hidden/banned ones", async () => {
  const response = await markdown("/posts/" + ids.publicRoot);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^text\/markdown/);
  assert.match(response.headers.get("Vary") || "", /Accept/);
  const text = await response.text();
  assert.match(text, /^# Public root title/);
  assert.match(text, /PUBLIC-REPLY/);
  assert.match(text, /NESTED-PUBLIC/);
  assert.doesNotMatch(text, /HIDDEN-REPLY/);
  assert.doesNotMatch(text, /NESTED-UNDER-HIDDEN/);
  assert.doesNotMatch(text, /BANNED-REPLY/);
  assert.match(text, /## Replies \(2\)/);
});

test("markdown: the home feed omits hidden and banned roots", async () => {
  const response = await markdown("/");
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /Public root title/);
  assert.doesNotMatch(text, /HIDDEN-ROOT|BANNED-ROOT/);
  assert.match(response.headers.get("Link") || "", /api-catalog/);
});

test("HTML requests for /posts/<id> go to ASSETS and still carry Vary: Accept", async () => {
  const response = await call(env, "/posts/" + ids.publicRoot, { headers: { Accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Vary") || "", /Accept/);
  assert.match(await response.text(), /shell/);
});
