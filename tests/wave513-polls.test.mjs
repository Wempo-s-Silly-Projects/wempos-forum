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

// Wave 5.13: F1 close voting on a poll (author or staff), F2 take back my
// vote, F3 repeat-report chip on the desk's report queue.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { makeFakeDocument, countByClass } from "./helpers/fake-dom.mjs";
import { renderPollBlock } from "../public/js/polls.js";
import { createReportQueue } from "../public/js/desk/reports.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fakeDocument = makeFakeDocument();

let env, db, u, s, threadId, optionIds;

const seedPoll = (postId) => {
  const pollId = Number(db.prepare("INSERT INTO polls (post_id, question, created_at) VALUES (?, ?, ?)")
    .run(postId, "Best?", 1).lastInsertRowid);
  const ids = ["A", "B"].map((label, i) => Number(db.prepare(
    "INSERT INTO poll_options (poll_id, label, position) VALUES (?, ?, ?)",
  ).run(pollId, label, i + 1).lastInsertRowid));
  return { pollId, ids };
};
const pollPath = () => `/api/posts/${threadId}/poll`;
const closedAt = () => db.prepare("SELECT closed_at FROM polls WHERE post_id = ?").get(threadId).closed_at;
const voteCount = (userId) => db.prepare("SELECT COUNT(*) AS n FROM poll_votes WHERE user_id = ?").get(userId).n;
const detail = async (session) => (await call(env, `/api/posts/${threadId}`, session ? { session } : undefined)).json();

beforeEach(async () => {
  env = makeEnv();
  db = env.__sqlite;
  u = {
    owner: await seedUser(db, { username: "Owner", role: "admin" }),
    mod: await seedUser(db, { username: "Mod", role: "moderator" }),
    author: await seedUser(db, { username: "Author" }),
    member: await seedUser(db, { username: "Member" }),
    other: await seedUser(db, { username: "Other" }),
  };
  s = Object.fromEntries(Object.entries(u).map(([key, id]) => [key, forgeSession(db, id)]));
  threadId = seedPost(db, { authorId: u.author, body: "poll thread" });
  optionIds = seedPoll(threadId).ids;
});

// --- F1: close voting ----------------------------------------------------------

test("F1 authz: anon refused at the Origin gate, another member 403, banned author 403; nothing changes", async () => {
  assert.equal((await call(env, pollPath(), { method: "PATCH", body: { closed: true } })).status, 403);
  assert.equal((await call(env, pollPath(), { method: "PATCH", body: { closed: true }, session: s.member })).status, 403);
  seedBan(db, u.author, null);
  assert.equal((await call(env, pollPath(), { method: "PATCH", body: { closed: true }, session: s.author })).status, 403);
  assert.equal(closedAt(), null);
});

test("F1: a hidden thread's poll is 404 to a member, a non-boolean body is 400, a poll-less thread 404", async () => {
  assert.equal((await call(env, pollPath(), { method: "PATCH", body: { closed: "yes" }, session: s.author })).status, 400);
  const bare = seedPost(db, { authorId: u.author, body: "no poll" });
  assert.equal((await call(env, `/api/posts/${bare}/poll`, { method: "PATCH", body: { closed: true }, session: s.author })).status, 404);
  db.prepare("UPDATE posts SET visibility = 'hidden' WHERE id = ?").run(threadId);
  assert.equal((await call(env, pollPath(), { method: "PATCH", body: { closed: true }, session: s.member })).status, 404);
  assert.equal(closedAt(), null);
});

test("F1: the author closes voting (votes refused 409), then reopens (votes count again)", async () => {
  const closed = await call(env, pollPath(), { method: "PATCH", body: { closed: true }, session: s.author });
  assert.equal(closed.status, 200);
  assert.deepEqual(await closed.json(), { ok: true, closed: true });
  assert.ok(Number(closedAt()) > 0);
  assert.equal((await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[0] }, session: s.member })).status, 409);
  const reopened = await call(env, pollPath(), { method: "PATCH", body: { closed: false }, session: s.author });
  assert.equal(reopened.status, 200);
  assert.equal(closedAt(), null);
  assert.equal((await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[0] }, session: s.member })).status, 200);
});

test("F1: staff (stored admin and moderator) may close any poll", async () => {
  assert.equal((await call(env, pollPath(), { method: "PATCH", body: { closed: true }, session: s.mod })).status, 200);
  assert.equal((await call(env, pollPath(), { method: "PATCH", body: { closed: false }, session: s.owner })).status, 200);
});

test("F1 payload: closed rides for everyone; canManage only for the author and staff", async () => {
  assert.equal((await detail()).poll.closed, false);
  assert.equal((await detail()).poll.canManage, false);
  assert.equal((await detail(s.member)).poll.canManage, false);
  assert.equal((await detail(s.author)).poll.canManage, true);
  assert.equal((await detail(s.mod)).poll.canManage, true);
  await call(env, pollPath(), { method: "PATCH", body: { closed: true }, session: s.author });
  assert.equal((await detail()).poll.closed, true);
});

test("F1 DOM: a closed poll keeps its bars, drops vote buttons, says so", () => {
  const poll = { question: "Q", options: [{ id: 1, label: "A", count: 2 }], totalVotes: 2, viewerOption: 1, closed: true, canManage: false };
  const block = renderPollBlock(poll, fakeDocument, { id: 5 });
  assert.equal(countByClass(block, "poll-vote"), 0);
  assert.equal(countByClass(block, "poll-unvote"), 0);
  assert.equal(countByClass(block, "poll-closed"), 1);
  assert.equal(countByClass(block, "poll-bar-fill"), 1);
});

test("F1 DOM: the manage button flips between close and reopen; others never see it", () => {
  const base = { question: "Q", options: [{ id: 1, label: "A", count: 0 }], totalVotes: 0, viewerOption: null };
  const open = renderPollBlock({ ...base, closed: false, canManage: true }, fakeDocument, { id: 5 });
  const openBtn = open.querySelectorAll("button.poll-manage")[0];
  assert.equal(openBtn.dataset.action, "poll-close");
  assert.equal(openBtn.dataset.closed, "true");
  const shut = renderPollBlock({ ...base, closed: true, canManage: true }, fakeDocument, { id: 5 });
  assert.equal(shut.querySelectorAll("button.poll-manage")[0].dataset.closed, "false");
  assert.equal(countByClass(renderPollBlock({ ...base, closed: false, canManage: false }, fakeDocument, { id: 5 }), "poll-manage"), 0);
  assert.equal(countByClass(renderPollBlock({ ...base, closed: false, canManage: true }, fakeDocument, null), "poll-manage"), 0);
});

// --- F2: take back my vote -----------------------------------------------------

test("F2: anon refused; DELETE removes only the caller's vote", async () => {
  assert.equal((await call(env, pollPath(), { method: "DELETE" })).status, 403);
  await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[0] }, session: s.member });
  await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[1] }, session: s.other });
  const res = await call(env, pollPath(), { method: "DELETE", session: s.member });
  assert.equal(res.status, 200);
  assert.equal(voteCount(u.member), 0);
  assert.equal(voteCount(u.other), 1);
  assert.equal((await detail(s.member)).poll.viewerOption, null);
  assert.equal((await detail()).poll.totalVotes, 1);
});

test("F2: a closed poll refuses taking a vote back (409) and keeps it", async () => {
  await call(env, pollPath(), { method: "PUT", body: { optionId: optionIds[0] }, session: s.member });
  await call(env, pollPath(), { method: "PATCH", body: { closed: true }, session: s.author });
  assert.equal((await call(env, pollPath(), { method: "DELETE", session: s.member })).status, 409);
  assert.equal(voteCount(u.member), 1);
});

test("F2 DOM: the take-back button shows only for a voter on an open poll", () => {
  const base = { question: "Q", options: [{ id: 1, label: "A", count: 1 }], totalVotes: 1, closed: false, canManage: false };
  const voted = renderPollBlock({ ...base, viewerOption: 1 }, fakeDocument, { id: 5 });
  const btn = voted.querySelectorAll("button.poll-unvote")[0];
  assert.equal(btn.dataset.action, "poll-unvote");
  assert.equal(countByClass(renderPollBlock({ ...base, viewerOption: null }, fakeDocument, { id: 5 }), "poll-unvote"), 0);
  assert.equal(countByClass(renderPollBlock({ ...base, viewerOption: 1 }, fakeDocument, null), "poll-unvote"), 0);
});

test("F1/F2 wiring: the thread view sends PATCH and DELETE through api()", () => {
  const src = read("public/js/routes/post.js");
  assert.match(src, /"poll-close":/);
  assert.match(src, /"poll-unvote":/);
  assert.match(src, /method: "PATCH"/);
  assert.match(src, /method: "DELETE"/);
  assert.ok(!read("public/js/polls.js").includes("innerHTML"));
});

// --- F3: repeat-report chip ----------------------------------------------------

test("F3 DOM: cards on a post with several open reports carry the count chip; a lone report does not", () => {
  const report = (id, postId) => ({
    id, reason: "spam", reporter: { username: "R" + id },
    post: { id: postId, body: "x", author: { id: 42, username: "Spammer" } },
  });
  const list = createReportQueue([report(1, 3), report(2, 9), report(3, 3)], fakeDocument, { role: "admin" });
  const cards = list.querySelectorAll("article.report-card");
  const chipOf = (card) => card.querySelectorAll(".report-repeat")[0];
  for (const card of [cards[0], cards[2]]) {
    assert.equal(chipOf(card).dataset.count, "2");
    assert.equal(chipOf(card).textContent, t("desk.reports.repeat", { count: 2 }));
  }
  assert.equal(chipOf(cards[1]), undefined);
  const en = JSON.parse(read("public/locales/en.json"));
  assert.match(en["desk.reports.repeat"], /\{count\}/);
});
