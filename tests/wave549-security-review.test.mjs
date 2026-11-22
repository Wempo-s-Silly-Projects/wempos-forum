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

// Wave 5.49 security review of v5.45-v5.48 (docs/security-reviews/
// 2026-11-22-v5.45-v5.48.md). Pins that lock verified behaviour — the
// thread-mute root resolution on every reply depth and on label-only rows,
// byte-identical 404s on the new owner-keyed routes, the JS length check
// staying stricter than the table CHECKs, and the export's section list —
// plus one `todo` (L1): a body or name that starts with U+0000 trips the
// table CHECK (SQLite's length() stops at the first NUL) and answers 500
// instead of a 400.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedPost, seedUser } from "./helpers/seed.mjs";
import { mutedThreadSql } from "../api/notifications.mjs";
import { PRIVATE_NOTE_MAX_CHARS, SAVED_SEARCH_NAME_MAX_CHARS } from "../constants.mjs";

const ASTRAL = "\u{1F600}"; // one code point, two UTF-16 code units

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "carol"]) id[name] = await seedUser(db, { username: name });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}
const count = (db, table) => db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
const putNote = (w, who, subject, body) =>
  call(w.env, "/api/users/" + subject + "/note", { method: "PUT", body: { body }, session: w.session(who) });
const saveSearch = (w, who, body) =>
  call(w.env, "/api/me/saved-searches", { method: "POST", body, session: w.session(who) });

test("mutedThreadSql resolves the root for a root, a level-1 and a level-2 reply; a NULL reply_id never mutes", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.bob, body: "root" });
  const one = seedPost(w.db, { authorId: w.id.carol, body: "level 1", parentId: root });
  const two = seedPost(w.db, { authorId: w.id.bob, body: "level 2", parentId: one });
  const otherRoot = seedPost(w.db, { authorId: w.id.bob, body: "other" });
  w.db.prepare("INSERT INTO thread_mutes (user_id, post_id, created_at) VALUES (?, ?, ?)").run(w.id.alice, root, now());
  const muted = (userId, postId) =>
    Boolean(w.db.prepare("SELECT " + mutedThreadSql("?", "?") + " AS m").get(userId, postId).m);
  assert.equal(muted(w.id.alice, root), true);
  assert.equal(muted(w.id.alice, one), true);
  assert.equal(muted(w.id.alice, two), true);
  assert.equal(muted(w.id.alice, otherRoot), false, "another thread is not muted");
  assert.equal(muted(w.id.carol, two), false, "only the muting member is skipped");
  assert.equal(muted(w.id.alice, null), false, "label-only rows (reply_id NULL) never match");
});

test("mute: a hidden thread answers the same 404 body as a missing id", async () => {
  const w = await world();
  const hidden = seedPost(w.db, { authorId: w.id.bob, body: "hidden", visibility: "hidden" });
  const mute = (postId) => call(w.env, "/api/posts/" + postId + "/mute", { method: "PUT", session: w.session("alice") });
  const a = await mute(hidden);
  const b = await mute(999999);
  assert.equal(a.status, 404);
  assert.equal(b.status, 404);
  assert.equal(await a.text(), await b.text());
  assert.equal(count(w.db, "thread_mutes"), 0);
});

test("saved search DELETE: another member's id answers the same 404 body as an unknown id", async () => {
  const w = await world();
  const created = await (await saveSearch(w, "bob", { name: "mine", q: "cats" })).json();
  const del = (id) => call(w.env, "/api/me/saved-searches/" + id, { method: "DELETE", session: w.session("alice") });
  const a = await del(created.savedSearch.id);
  const b = await del(999999);
  assert.equal(a.status, 404);
  assert.equal(b.status, 404);
  assert.equal(await a.text(), await b.text());
  assert.equal(count(w.db, "saved_searches"), 1);
});

test("length checks count UTF-16 units, stricter than the CHECK's code points: astral text is a 400, never a 500", async () => {
  const w = await world();
  const half = PRIVATE_NOTE_MAX_CHARS / 2;
  assert.equal((await putNote(w, "alice", "bob", ASTRAL.repeat(half))).status, 200);
  assert.equal((await putNote(w, "alice", "bob", ASTRAL.repeat(half + 1))).status, 400);
  const nameHalf = SAVED_SEARCH_NAME_MAX_CHARS / 2;
  assert.equal((await saveSearch(w, "alice", { name: ASTRAL.repeat(nameHalf), q: "cats" })).status, 201);
  assert.equal((await saveSearch(w, "alice", { name: ASTRAL.repeat(nameHalf + 1), q: "dogs" })).status, 400);
});

test("export: privateNotes and savedSearches are present; there is no thread-mute section (O7 owner decision)", async () => {
  const w = await world();
  const root = seedPost(w.db, { authorId: w.id.bob, body: "root" });
  w.db.prepare("INSERT INTO thread_mutes (user_id, post_id, created_at) VALUES (?, ?, ?)").run(w.id.alice, root, now());
  const data = await (await call(w.env, "/api/me/export", { session: w.session("alice") })).json();
  assert.ok(Array.isArray(data.privateNotes));
  assert.ok(Array.isArray(data.savedSearches));
  assert.equal(Object.hasOwn(data, "threadMutes"), false);
  assert.ok(!/thread_?mutes/i.test(JSON.stringify(Object.keys(data))));
});

test("a note body, saved-search name or q starting with U+0000 is a 400, not a 500", {
  todo: "BUG (L1, LOW): SQLite length() stops at the first NUL, so the table CHECK fails and the route answers 500",
}, async () => {
  const w = await world();
  assert.equal((await putNote(w, "alice", "bob", "\u0000note")).status, 400);
  assert.equal((await saveSearch(w, "alice", { name: "\u0000name", q: "cats" })).status, 400);
  assert.equal((await saveSearch(w, "alice", { name: "ok", q: "\u0000cats" })).status, 400);
});
