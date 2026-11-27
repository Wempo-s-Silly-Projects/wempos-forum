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

// Wave 5.12 security review (docs/archive/drafts/security-review-5.12.md): zero
// confirmed defects in v5.8.0..v5.11.0, so these pin the riskiest surfaces
// the review traced — the lobby @mention label parse in the bell filter,
// the stored-role QOTD boundary, and publicChainSql at depth 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { archivePostRowsStatement } from "../api/core/archive.mjs";
import { ROLE_ADMIN_DB, ROLE_MEMBER_DB, ROLE_OWNER_DB } from "../api/core/roles.mjs";
import { chatMentionLabel } from "../api/notifications.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";

const json = async (env, path, session) => {
  const res = await call(env, path, session ? { session } : {});
  assert.equal(res.status, 200, path);
  return res.json();
};

const labelRow = (db, userId, label) => db.prepare(
  "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) VALUES (?, NULL, NULL, ?, ?)",
).run(userId, now(), label);

const bellLabels = async (env, session) => {
  const body = await json(env, "/api/me/notifications", session);
  return JSON.stringify(body);
};

test("wave512 pin: chatMentionLabel keeps the exact server-built shape the bell filter parses", () => {
  assert.equal(chatMentionLabel("Zz_Mixed"), "You were mentioned by Zz_Mixed in chat");
});

test("wave512 pin: a mixed-case banned actor's lobby mention drops (lower(label) meets username_key)", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const viewer = await seedUser(db, { username: "viewer" });
  const actor = await seedUser(db, { username: "Zz_Mixed" });
  seedBan(db, actor);
  labelRow(db, viewer, chatMentionLabel("Zz_Mixed"));
  assert.ok(!(await bellLabels(env, forgeSession(db, viewer))).includes("Zz_Mixed"));
});

test("wave512 pin: an underscore in a banned name is data, never a LIKE wildcard for another member", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const viewer = await seedUser(db, { username: "viewer" });
  seedBan(db, await seedUser(db, { username: "zz_x" }));
  await seedUser(db, { username: "zzax" });
  labelRow(db, viewer, chatMentionLabel("zz_x"));
  labelRow(db, viewer, chatMentionLabel("zzax"));
  const bell = await bellLabels(env, forgeSession(db, viewer));
  assert.ok(!bell.includes("mentioned by zz_x in chat"), "banned actor hidden");
  assert.ok(bell.includes("mentioned by zzax in chat"), "look-alike member untouched");
});

test("wave512 pin: label-only rows outside the exact chat shape, or naming no account, always show", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const viewer = await seedUser(db, { username: "viewer" });
  seedBan(db, await seedUser(db, { username: "zzbanned" }));
  labelRow(db, viewer, "You were mentioned by zzbanned in chatroom");
  labelRow(db, viewer, chatMentionLabel("nobodyhere"));
  labelRow(db, viewer, "Your appeal was accepted");
  const bell = await bellLabels(env, forgeSession(db, viewer));
  for (const needle of ["in chatroom", "nobodyhere", "Your appeal was accepted"]) assert.ok(bell.includes(needle), needle);
});

test("wave512 pin: QOTD keys on STORED roles, never on a role-looking username", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const ownerNamedMember = await seedUser(db, { username: "member", role: ROLE_OWNER_DB });
  const adminNamedRegular = await seedUser(db, { username: "regular", role: ROLE_ADMIN_DB });
  const memberNamedOwner = await seedUser(db, { username: "owner", role: ROLE_MEMBER_DB });
  const memberNamedAdmin = await seedUser(db, { username: "admin", role: ROLE_MEMBER_DB });
  const qotd = async () => (await json(env, "/api/traditions/qotd")).qotd;
  seedPost(db, { authorId: memberNamedOwner, body: "QOTD: not the owner" });
  seedPost(db, { authorId: memberNamedAdmin, body: "QOTD: not an admin" });
  assert.equal(await qotd(), null);
  const fromAdmin = seedPost(db, { authorId: adminNamedRegular, body: "QOTD: stored moderator is an admin" });
  assert.equal((await qotd()).id, fromAdmin);
  db.prepare("DELETE FROM posts").run();
  const fromOwner = seedPost(db, { authorId: ownerNamedMember, body: "QOTD: stored admin is the owner" });
  assert.equal((await qotd()).id, fromOwner);
});

async function depthTwoWorld({ rootHidden = false, rootAuthorBanned = false } = {}) {
  const env = makeEnv();
  const db = env.__sqlite;
  const rootAuthor = await seedUser(db, { username: "rootauthor" });
  const writer = await seedUser(db, { username: "deepwriter" });
  const root = seedPost(db, { authorId: rootAuthor, body: "root", visibility: rootHidden ? "hidden" : "public" });
  const mid = seedPost(db, { authorId: rootAuthor, body: "mid", parentId: root });
  const deep = seedPost(db, { authorId: writer, body: "deep", parentId: mid });
  if (rootAuthorBanned) seedBan(db, rootAuthor);
  return { env, db, writer, root, deep };
}

const deepCounts = async (env) => {
  const board = (await json(env, "/api/leaderboard")).allTime.leaderboard;
  const row = board.find((entry) => entry.username === "deepwriter");
  const profile = await json(env, "/api/users/deepwriter");
  const user = profile.user || profile;
  return { board: row ? row.replies : 0, profile: Number(user.repliesCount ?? profile.repliesCount) };
};

test("wave512 pin: publicChainSql at depth 2 — a grandchild reply counts only when the root is public and unbanned", async () => {
  assert.deepEqual(await deepCounts((await depthTwoWorld()).env), { board: 1, profile: 1 }, "control");
  assert.deepEqual(await deepCounts((await depthTwoWorld({ rootHidden: true })).env), { board: 0, profile: 0 }, "hidden root");
  assert.deepEqual(await deepCounts((await depthTwoWorld({ rootAuthorBanned: true })).env), { board: 0, profile: 0 }, "banned root author");
});

test("wave512 pin: the archive judges a depth-2 reply by its root at deletion time", async () => {
  for (const [opts, expected] of [[{}, "public"], [{ rootHidden: true }, "hidden"], [{ rootAuthorBanned: true }, "hidden"]]) {
    const w = await depthTwoWorld(opts);
    await archivePostRowsStatement(w.env.FORUM_DB, "p.id = ?", [w.deep], "post-delete", now()).run();
    const row = w.db.prepare("SELECT visibility FROM post_archive WHERE original_post_id = ?").get(w.deep);
    assert.equal(row.visibility, expected, JSON.stringify(opts));
  }
});
