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

// Wave 5.50 (v5.50.0) — the author's TL;DR (migration 0074, api/thread-summaries.mjs):
// GET/PUT/DELETE /api/posts/:id/summary. Roots only; GET obeys canViewPost
// (404 otherwise); writes are session + CSRF + the write rate limit, author
// or staff only, banned members refused, and the public text runs the word
// filter (refused, never masked into storage) and refuses bidi controls,
// NUL/C0/C1 controls and line separators. Cascades on both references.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { EXPORT_SECTION_CAPS, THREAD_SUMMARY_MAX_CHARS } from "../constants.mjs";
import { createThreadSummary, loadThreadSummary, threadSummaryPath } from "../public/js/thread-summary.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "migrations/0074_thread_summaries.sql";

async function world(overrides = {}) {
  const env = makeEnv(overrides);
  const db = env.__sqlite;
  db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('filtered_words', 'badword', ?)").run(now());
  const id = {};
  for (const name of ["alice", "bob", "carol"]) id[name] = await seedUser(db, { username: name });
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const root = seedPost(db, { authorId: id.alice, body: "alice root" });
  const reply = seedPost(db, { authorId: id.bob, body: "bob reply", parentId: root });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, root, reply, session };
}
const count = (db, sql, ...args) => db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n;
const path = (postId) => "/api/posts/" + postId + "/summary";
const getSum = (w, who, postId = w.root) => call(w.env, path(postId), who ? { session: w.session(who) } : {});
const putSum = (w, who, body, postId = w.root) => call(w.env, path(postId), { method: "PUT", body: { body }, session: w.session(who) });
const delSum = (w, who, postId = w.root) => call(w.env, path(postId), { method: "DELETE", session: w.session(who) });

// ---- migration ---------------------------------------------------------------

test("migration 0074 is CREATE-only; both references cascade; the 1-280 CHECK; one row per root", async () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS thread_summaries/);
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  const refs = sql.match(/REFERENCES [^,\n]+/g) || [];
  assert.equal(refs.length, 2);
  for (const ref of refs) assert.match(ref, /ON DELETE CASCADE/);
  const w = await world();
  const fks = w.db.prepare("PRAGMA foreign_key_list(thread_summaries)").all();
  assert.deepEqual(fks.map((fk) => fk.table).sort(), ["posts", "users"]);
  for (const fk of fks) assert.equal(fk.on_delete, "CASCADE");
  const insert = (body) => w.db.prepare(
    "INSERT INTO thread_summaries (post_id, body, updated_by, updated_at) VALUES (?, ?, ?, ?)").run(w.root, body, w.id.alice, now());
  assert.throws(() => insert(""), /CHECK/);
  assert.throws(() => insert("x".repeat(281)), /CHECK/);
  insert("x".repeat(280));
  assert.throws(() => insert("dup"), /UNIQUE|PRIMARY/);
});

test("cascade: deleting the thread, the post row, or the writer's account takes the summary with it", async () => {
  const w = await world();
  w.db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");
  const second = seedPost(w.db, { authorId: w.id.carol, body: "carol root" });
  const third = seedPost(w.db, { authorId: w.id.carol, body: "carol root two" });
  assert.equal((await putSum(w, "alice", "alice tldr")).status, 200);
  assert.equal((await putSum(w, "carol", "carol tldr", second)).status, 200);
  assert.equal((await putSum(w, "boss", "boss tldr on carol", third)).status, 200);
  assert.equal(count(w.db, "thread_summaries"), 3);
  // The author's own delete route.
  assert.equal((await call(w.env, "/api/posts/" + w.root, { method: "DELETE", session: w.session("alice") })).status, 200);
  assert.equal(count(w.db, "thread_summaries WHERE post_id = ?", w.root), 0, "thread delete cascades");
  // A raw post-row delete.
  w.db.prepare("DELETE FROM posts WHERE id = ?").run(second);
  assert.equal(count(w.db, "thread_summaries WHERE post_id = ?", second), 0, "post row delete cascades");
  // The writer (staff) deletes their account: the summary they wrote goes.
  assert.equal((await call(w.env, "/api/me/delete", { method: "POST", session: w.session("boss") })).status, 200);
  assert.equal(count(w.db, "thread_summaries"), 0, "updated_by account delete cascades");
});

// ---- auth, method, root-only, author-or-staff ---------------------------------

test("auth: PUT/DELETE no Origin 403, anon 401, bad CSRF 403, rate limited 429; POST 405; nothing written", async () => {
  const w = await world();
  for (const method of ["PUT", "DELETE"]) {
    assert.equal((await call(w.env, path(w.root), { method, body: { body: "x" } })).status, 403, method + " no origin");
    const anon = await call(w.env, path(w.root), { method, body: { body: "x" }, headers: { Origin: ORIGIN, "X-CSRF-Token": "x" } });
    assert.equal(anon.status, 401, method + " anon");
    const bad = await call(w.env, path(w.root), { method, body: { body: "x" }, session: { ...w.session("alice"), csrf: "wrong-token-wrong-token-wrong" } });
    assert.equal(bad.status, 403, method + " bad csrf");
  }
  assert.equal((await call(w.env, path(w.root), { method: "POST", body: { body: "x" }, session: w.session("alice") })).status, 405);
  const env = makeEnv({ ...makeLimiters(false).bindings });
  const zed = await seedUser(env.__sqlite, { username: "zed" });
  const zroot = seedPost(env.__sqlite, { authorId: zed, body: "zed root" });
  const limited = await call(env, path(zroot), { method: "PUT", body: { body: "x" }, session: forgeSession(env.__sqlite, zed) });
  assert.equal(limited.status, 429);
  assert.equal(count(w.db, "thread_summaries"), 0);
  assert.equal(count(env.__sqlite, "thread_summaries"), 0);
});

test("roots only: GET on a reply 404s, PUT/DELETE on a reply 400; unknown or malformed ids 404", async () => {
  const w = await world();
  assert.equal((await getSum(w, null, w.reply)).status, 404);
  assert.equal((await putSum(w, "bob", "reply tldr", w.reply)).status, 400);
  assert.equal((await delSum(w, "bob", w.reply)).status, 400);
  assert.equal((await getSum(w, null, 999999)).status, 404);
  assert.equal((await putSum(w, "alice", "x", 999999)).status, 404);
  assert.equal((await call(w.env, "/api/posts/0/summary")).status, 404);
  assert.equal(count(w.db, "thread_summaries"), 0);
});

test("author or staff: the author and staff write; another member 403; a banned author 403 on PUT and DELETE", async () => {
  const w = await world();
  assert.equal((await putSum(w, "bob", "not mine")).status, 403);
  assert.equal(count(w.db, "thread_summaries"), 0);
  const own = await putSum(w, "alice", "  The short version.  ");
  assert.equal(own.status, 200);
  assert.equal((await own.json()).summary.body, "The short version.", "trimmed");
  const staff = await putSum(w, "boss", "Staff tidy-up.");
  assert.equal(staff.status, 200);
  assert.equal(w.db.prepare("SELECT updated_by FROM thread_summaries WHERE post_id = ?").get(w.root).updated_by, w.id.boss);
  assert.equal((await delSum(w, "bob")).status, 403);
  assert.equal(count(w.db, "thread_summaries"), 1);
  seedBan(w.db, w.id.alice);
  assert.equal((await putSum(w, "alice", "banned edit")).status, 403);
  assert.equal((await delSum(w, "alice")).status, 403);
  assert.equal(count(w.db, "thread_summaries"), 1);
  assert.equal((await delSum(w, "boss")).status, 200);
  assert.equal(count(w.db, "thread_summaries"), 0);
  assert.equal((await delSum(w, "boss")).status, 200, "idempotent");
});

// ---- the public text ----------------------------------------------------------

test("text: empty/non-string 400, 281 characters 400, 280 ok; the word filter refuses (nothing masked into storage)", async () => {
  const w = await world();
  assert.equal(THREAD_SUMMARY_MAX_CHARS, 280);
  for (const body of ["", "   ", null, 7, ["x"]]) assert.equal((await putSum(w, "alice", body)).status, 400, JSON.stringify(body));
  assert.equal((await putSum(w, "alice", "y".repeat(281))).status, 400);
  assert.equal((await putSum(w, "alice", "😀".repeat(280))).status, 200, "280 code points, not UTF-16 units");
  const filtered = await putSum(w, "alice", "this is a badword summary");
  assert.equal(filtered.status, 400);
  assert.equal(w.db.prepare("SELECT body FROM thread_summaries WHERE post_id = ?").get(w.root).body, "😀".repeat(280));
  assert.equal(count(w.db, "thread_summaries WHERE body LIKE '%#%'"), 0);
});

test("text: bidi embeddings/overrides/isolates, NUL, C0, DEL/C1 and line separators are refused with 400", async () => {
  const w = await world();
  const bad = ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩",
    "\u0000", "\u0001", "\u0009", "\n", "\r", "\u001F", "\u007F", "\u0085", "\u009F", " ", " "];
  for (const ch of bad) {
    const res = await putSum(w, "alice", "safe " + ch + " text");
    assert.equal(res.status, 400, "U+" + ch.codePointAt(0).toString(16));
  }
  assert.equal(count(w.db, "thread_summaries"), 0);
  assert.equal((await putSum(w, "alice", "plain marks ‎‏ stay allowed")).status, 200);
});

// ---- reads + visibility ---------------------------------------------------------

test("GET: guests and members read a public root's summary; none = null; no writer identity is exposed", async () => {
  const w = await world();
  const empty = await getSum(w, null);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { summary: null });
  await putSum(w, "boss", "TLDRTXT staff wrote this");
  for (const who of [null, "bob", "alice"]) {
    const res = await getSum(w, who);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(Object.keys(data.summary).sort(), ["body", "updatedAt"]);
    assert.equal(data.summary.body, "TLDRTXT staff wrote this");
  }
});

test("visibility: hidden root, banned author and block pair (both ways) 404 with no text; expired ban and staff read", async () => {
  const w = await world();
  const write = (postId, body) => w.db.prepare(
    "INSERT INTO thread_summaries (post_id, body, updated_by, updated_at) VALUES (?, ?, ?, ?)").run(postId, body, w.id.boss, now());
  const hidden = seedPost(w.db, { authorId: w.id.alice, body: "hidden", visibility: "hidden" });
  const bannedRoot = seedPost(w.db, { authorId: w.id.carol, body: "carol" });
  const expired = await seedUser(w.db, { username: "expired" });
  const expiredRoot = seedPost(w.db, { authorId: expired, body: "expired" });
  write(hidden, "HIDDENSUMTXT");
  write(bannedRoot, "BANNEDSUMTXT");
  write(w.root, "ALICESUMTXT");
  write(expiredRoot, "EXPIREDSUMTXT");
  seedBan(w.db, w.id.carol);
  seedBan(w.db, expired, -3600);
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.bob, w.id.alice, now());
  const refused = [[null, hidden], ["bob", hidden], [null, bannedRoot], ["alice", bannedRoot], ["bob", w.root]];
  for (const [who, postId] of refused) {
    const res = await getSum(w, who, postId);
    assert.equal(res.status, 404, (who || "guest") + " " + postId);
    assert.doesNotMatch(await res.text(), /SUMTXT/);
  }
  // The other side of the block pair: alice cannot read bob's thread summary.
  const bobRoot = seedPost(w.db, { authorId: w.id.bob, body: "bob root" });
  write(bobRoot, "BOBSUMTXT");
  assert.equal((await getSum(w, "alice", bobRoot)).status, 404);
  // A block pair also refuses the write path.
  assert.equal((await putSum(w, "alice", "x", bobRoot)).status, 404);
  assert.equal((await getSum(w, null, expiredRoot)).status, 200);
  for (const postId of [hidden, bannedRoot, w.root]) {
    assert.equal((await getSum(w, "boss", postId)).status, 200, "staff " + postId);
  }
});

// ---- export ---------------------------------------------------------------------

test("export: summaries the member WROTE (post id, body, time); never ones others wrote on their threads", async () => {
  const w = await world();
  assert.ok(EXPORT_SECTION_CAPS.threadSummaries >= 1);
  await putSum(w, "boss", "BOSS-WROTE");
  const carolRoot = seedPost(w.db, { authorId: w.id.carol, body: "carol" });
  await putSum(w, "carol", "CAROL-WROTE", carolRoot);
  const alice = await (await call(w.env, "/api/me/export", { session: w.session("alice") })).json();
  assert.deepEqual(alice.threadSummaries, []);
  assert.ok(!JSON.stringify(alice).includes("BOSS-WROTE"));
  const carol = await (await call(w.env, "/api/me/export", { session: w.session("carol") })).json();
  assert.equal(carol.threadSummaries.length, 1);
  assert.deepEqual(Object.keys(carol.threadSummaries[0]).sort(), ["body", "postId", "updatedAt"]);
  assert.equal(carol.threadSummaries[0].postId, carolRoot);
  assert.equal(carol.truncated.threadSummaries, false);
});

// ---- source pins ------------------------------------------------------------------

test("source pins: bound params only, hard LIMIT, canViewPost, no SELECT *, the feed and POST_SELECT untouched", () => {
  const src = read("api/thread-summaries.mjs");
  assert.doesNotMatch(src, /SELECT \*/);
  assert.match(src, /canViewPost/);
  assert.match(src, /requireUser/);
  assert.match(src, /assertNotBanned/);
  assert.match(src, /rateLimit\(request, env, "write"/);
  assert.match(src, /applyWordFilter/);
  assert.match(src, /LIMIT 1/);
  for (const sql of src.match(/"(SELECT|INSERT|UPDATE|DELETE)[^;]*?"/g) || []) {
    assert.doesNotMatch(sql, /\$\{/, "no template interpolation in SQL");
  }
  assert.doesNotMatch(read("api/posts-feed.mjs"), /thread_summaries/);
  assert.doesNotMatch(read("api/core/shapers.mjs"), /thread_summaries/, "POST_SELECT never joins the summary");
  assert.match(read("worker.mjs"), /handleThreadSummaryRoutes/);
});

// ---- client ----------------------------------------------------------------------

test("client: the box is textContent-only, masks spoilers, and an editor shows only when allowed", async () => {
  const doc = makeFakeDocument();
  assert.equal(threadSummaryPath(42), "/api/posts/42/summary");
  assert.throws(() => threadSummaryPath("1/../x"), RangeError);
  const fakeApi = async () => ({ summary: { body: "<b>hi</b> ||secret plot||", updatedAt: "2026-11-22T00:00:00.000Z" } });
  const reader = createThreadSummary(doc, { postId: 1, canEdit: false, request: fakeApi });
  await loadThreadSummary(reader);
  assert.equal(reader.hidden, false);
  assert.equal(findByClass(reader, "thread-tldr-title").textContent, t("tldr.title"));
  const body = findByClass(reader, "thread-tldr-body");
  assert.match(body.textContent, /<b>hi<\/b>/);
  assert.doesNotMatch(body.textContent, /secret plot/);
  assert.equal(findByClass(reader, "thread-tldr-input"), null, "no editor for readers");
  const editor = createThreadSummary(doc, { postId: 1, canEdit: true, request: fakeApi });
  await loadThreadSummary(editor);
  const input = findByClass(editor, "thread-tldr-input");
  assert.equal(input.value, "<b>hi</b> ||secret plot||", "the editor prefills the raw text");
  assert.equal(Number(input.maxLength ?? input.getAttribute("maxlength")), 280);
  assert.equal(input.getAttribute("aria-label"), t("tldr.label"));
  const src = read("public/js/thread-summary.js");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
  assert.match(src, /maskSpoilers\(/);
});

test("client: no summary hides the box from readers; save PUTs collapsed text, empty save DELETEs; a failed read removes it", async () => {
  const doc = makeFakeDocument();
  const parent = doc.createElement("div");
  const none = createThreadSummary(doc, { postId: 3, canEdit: false, request: async () => ({ summary: null }) });
  parent.append(none);
  await loadThreadSummary(none);
  assert.equal(none.parentNode, null, "nothing to show a reader");
  const calls = [];
  const fakeApi = async (p, options = {}) => {
    calls.push([p, options.method || "GET", options.body]);
    if (options.method === "PUT") return { summary: { body: options.body.body, updatedAt: "2026-11-22T00:00:01.000Z" } };
    return { summary: null };
  };
  const box = createThreadSummary(doc, { postId: 3, canEdit: true, request: fakeApi });
  parent.append(box);
  await loadThreadSummary(box);
  assert.equal(box.parentNode, parent, "editors see the empty box");
  const input = findByClass(box, "thread-tldr-input");
  input.value = "  line one\n\nline   two  ";
  await box.saveThreadSummary();
  assert.deepEqual(calls.at(-1), ["/api/posts/3/summary", "PUT", { body: "line one line two" }]);
  assert.equal(findByClass(box, "thread-tldr-body").textContent, "line one line two");
  assert.equal(findByClass(box, "thread-tldr-status").textContent, t("tldr.saved"));
  input.value = "   ";
  await box.saveThreadSummary();
  assert.deepEqual(calls.at(-1).slice(0, 2), ["/api/posts/3/summary", "DELETE"]);
  assert.equal(findByClass(box, "thread-tldr-status").textContent, t("tldr.removed"));
  const failing = createThreadSummary(doc, { postId: 3, canEdit: true, request: async () => { throw new Error("nope"); } });
  parent.append(failing);
  await loadThreadSummary(failing);
  assert.equal(failing.parentNode, null);
});

test("client: the thread page mounts the box on roots, above the replies, editor for the author or staff", () => {
  const src = read("public/js/routes/post.js");
  assert.match(src, /createThreadSummary/);
  const mount = src.indexOf("createThreadSummary(document");
  assert.ok(mount > 0 && mount < src.indexOf('addHeading(main, t("post.repliesTitle")'), "above the replies");
});
