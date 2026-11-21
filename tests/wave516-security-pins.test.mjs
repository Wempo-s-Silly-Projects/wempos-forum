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

// Wave 5.16 security review of v5.12.0..v5.15.0 (docs/drafts/security-review-5.16.md).
// S1: a close that lands between a vote's (or a take-back's) poll read and its
// write must still win — the write itself re-checks that voting is open.
// Pins: a reply never carries a closable poll; a post edit can never move a
// thread onto a staff-only board.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedPost, seedUser } from "./helpers/seed.mjs";
import { POLL_BY_POST_SQL } from "../api/polls.mjs";

let env, db, realDb, u, s, threadId, optionIds;

const pollPath = (id = threadId) => `/api/posts/${id}/poll`;
const voteRows = (userId) => db.prepare("SELECT option_id FROM poll_votes WHERE user_id = ?").all(userId);
const closedAt = () => db.prepare("SELECT closed_at FROM polls WHERE post_id = ?").get(threadId).closed_at;

// Simulates a concurrent close: the handler's poll read sees voting OPEN, and
// the close commits right after that read, before the handler's write runs.
function closeRightAfterPollRead() {
  const racing = Object.create(realDb);
  racing.prepare = (sql) => {
    const statement = realDb.prepare(sql);
    if (sql !== POLL_BY_POST_SQL) return statement;
    return {
      bind: (...values) => {
        const bound = statement.bind(...values);
        return {
          first: async (column) => {
            const row = await bound.first(column);
            db.prepare("UPDATE polls SET closed_at = 1 WHERE post_id = ?").run(threadId);
            return row;
          },
        };
      },
    };
  };
  env.FORUM_DB = racing;
}

beforeEach(async () => {
  env = makeEnv();
  db = env.__sqlite;
  realDb = env.FORUM_DB;
  u = {
    author: await seedUser(db, { username: "Author" }),
    member: await seedUser(db, { username: "Member" }),
    other: await seedUser(db, { username: "Other" }),
  };
  s = Object.fromEntries(Object.entries(u).map(([key, id]) => [key, forgeSession(db, id)]));
  threadId = seedPost(db, { authorId: u.author, body: "poll thread" });
  const pollId = Number(db.prepare("INSERT INTO polls (post_id, question, created_at) VALUES (?, ?, ?)")
    .run(threadId, "Best?", 1).lastInsertRowid);
  optionIds = ["A", "B"].map((label, i) => Number(db.prepare(
    "INSERT INTO poll_options (poll_id, label, position) VALUES (?, ?, ?)",
  ).run(pollId, label, i + 1).lastInsertRowid));
});

test("S1: a vote racing a close is refused (409) and never lands on the closed poll", async () => {
  closeRightAfterPollRead();
  const res = await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[0] }, session: s.member });
  env.FORUM_DB = realDb;
  assert.equal(res.status, 409);
  assert.deepEqual(voteRows(u.member), []);
});

test("S1: a vote change racing a close is refused (409) and the earlier vote stands", async () => {
  assert.equal((await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[0] }, session: s.member })).status, 200);
  closeRightAfterPollRead();
  const res = await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[1] }, session: s.member });
  env.FORUM_DB = realDb;
  assert.equal(res.status, 409);
  assert.deepEqual(voteRows(u.member).map((row) => row.option_id), [optionIds[0]]);
});

test("S1: taking a vote back while a close lands is refused (409) and the vote is kept", async () => {
  assert.equal((await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[0] }, session: s.member })).status, 200);
  closeRightAfterPollRead();
  const res = await call(env, pollPath(), { method: "DELETE", session: s.member });
  env.FORUM_DB = realDb;
  assert.equal(res.status, 409);
  assert.equal(voteRows(u.member).length, 1);
});

test("S1: on an open poll, taking back a vote you never cast is a harmless 200 and touches no one else", async () => {
  await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[1] }, session: s.other });
  const res = await call(env, pollPath(), { method: "DELETE", session: s.member });
  assert.equal(res.status, 200);
  assert.deepEqual(voteRows(u.other).map((row) => row.option_id), [optionIds[1]]);
});

test("pin: a member cannot close another member's poll, and a reply has no poll to close", async () => {
  assert.equal((await call(env, pollPath(), { method: "PATCH", body: { closed: true }, session: s.member })).status, 403);
  const reply = seedPost(db, { authorId: u.member, body: "a reply", parentId: threadId });
  assert.equal((await call(env, pollPath(reply), { method: "PATCH", body: { closed: true }, session: s.member })).status, 404);
  assert.equal((await call(env, pollPath(reply), { method: "DELETE", session: s.member })).status, 404);
  assert.equal(closedAt(), null);
});

test("pin: editing a post can never move it onto a staff-only board", async () => {
  for (const board of ["polls", "updates"]) {
    const res = await call(env, `/api/posts/${threadId}`, {
      method: "PATCH",
      session: s.author,
      body: { body: "edited " + board, board },
    });
    assert.equal(res.status, 200);
    const row = db.prepare("SELECT body, board FROM posts WHERE id = ?").get(threadId);
    assert.equal(row.body, "edited " + board);
    assert.equal(row.board, "general");
  }
});
