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

// v5.47.0 F1: private notes about members (migration 0072). GET/PUT/DELETE
// /api/users/:username/note — one note per (owner, subject), PUT upserts,
// visible ONLY to its owner (never the subject, other members, staff or
// guests). A banned or block-paired subject's note stays readable and
// deletable by its owner: it is the owner's own data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";
import { makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import { EXPORT_SECTION_CAPS, PRIVATE_NOTE_MAX_CHARS, PRIVATE_NOTES_MAX } from "../constants.mjs";
import { createPrivateNoteBox, loadPrivateNote, privateNotePath } from "../public/js/private-note.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "migrations/0072_private_notes.sql";

async function world(overrides = {}) {
  const env = makeEnv(overrides);
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob", "carol"]) id[name] = await seedUser(db, { username: name });
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}
const count = (db, sql, ...args) => db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n;
const notePath = (name) => "/api/users/" + encodeURIComponent(name) + "/note";
const getNote = (w, who, subject) => call(w.env, notePath(subject), { session: w.session(who) });
const putNote = (w, who, subject, body) => call(w.env, notePath(subject), { method: "PUT", body: { body }, session: w.session(who) });
const delNote = (w, who, subject) => call(w.env, notePath(subject), { method: "DELETE", session: w.session(who) });

// ---- migration ---------------------------------------------------------------

test("migration 0072 is CREATE-only; both references cascade; PK, CHECKs", async () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS private_notes/);
  assert.match(sql, /PRIMARY KEY \(owner_id, subject_id\)/);
  assert.match(sql, /CHECK \(owner_id <> subject_id\)/);
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  const refs = sql.match(/REFERENCES [^,\n]+/g) || [];
  assert.equal(refs.length, 2);
  for (const ref of refs) assert.match(ref, /ON DELETE CASCADE/);
  const w = await world();
  const fks = w.db.prepare("PRAGMA foreign_key_list(private_notes)").all();
  assert.deepEqual(fks.map((fk) => fk.table), ["users", "users"]);
  for (const fk of fks) assert.equal(fk.on_delete, "CASCADE");
  const insert = (o, s, body) => w.db.prepare(
    "INSERT INTO private_notes (owner_id, subject_id, body, updated_at) VALUES (?, ?, ?, ?)").run(o, s, body, now());
  assert.throws(() => insert(w.id.alice, w.id.alice, "self"), /CHECK/);
  assert.throws(() => insert(w.id.alice, w.id.bob, "x".repeat(281)), /CHECK/);
  assert.throws(() => insert(w.id.alice, w.id.bob, ""), /CHECK/);
  insert(w.id.alice, w.id.bob, "x".repeat(280));
  assert.throws(() => insert(w.id.alice, w.id.bob, "dup"), /UNIQUE|PRIMARY/);
});

test("cascade: deleting the owner OR the subject takes the note rows with it", async () => {
  const w = await world();
  // Fleet tables 0043 references are absent from the forum schema; stub them
  // like wave540/wave546 so a users DELETE can run.
  w.db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");
  for (const [owner, subject] of [["alice", "bob"], ["alice", "carol"], ["bob", "carol"], ["carol", "bob"], ["bob", "alice"]]) {
    assert.equal((await putNote(w, owner, subject, owner + " on " + subject)).status, 200);
  }
  assert.equal(count(w.db, "private_notes"), 5);
  // Owner side: alice deletes her account -> her 2 notes AND bob's note about her go.
  assert.equal((await call(w.env, "/api/me/delete", { method: "POST", session: w.session("alice") })).status, 200);
  assert.equal(count(w.db, "private_notes WHERE owner_id = ?", w.id.alice), 0, "owner delete cascades");
  assert.equal(count(w.db, "private_notes WHERE subject_id = ?", w.id.alice), 0, "subject delete cascades");
  assert.equal(count(w.db, "private_notes"), 2);
  // Subject side, raw: deleting carol's row drops bob's note about carol.
  w.db.prepare("DELETE FROM users WHERE id = ?").run(w.id.carol);
  assert.equal(count(w.db, "private_notes WHERE subject_id = ?", w.id.carol), 0);
  assert.equal(count(w.db, "private_notes"), 0, "carol's own note about bob went with her too");
});

// ---- route: auth, validation ---------------------------------------------------

test("auth: GET anon 401; PUT/DELETE no Origin 403, anon 401, bad CSRF 403, rate limited 429; POST 405; nothing written", async () => {
  const w = await world();
  assert.equal((await call(w.env, notePath("bob"))).status, 401);
  for (const method of ["PUT", "DELETE"]) {
    assert.equal((await call(w.env, notePath("bob"), { method, body: { body: "x" } })).status, 403, method + " no origin");
    const anon = await call(w.env, notePath("bob"), { method, body: { body: "x" }, headers: { Origin: ORIGIN, "X-CSRF-Token": "x" } });
    assert.equal(anon.status, 401, method + " anon");
    const s = w.session("alice");
    const bad = await call(w.env, notePath("bob"), { method, body: { body: "x" }, session: { ...s, csrf: "wrong-token-wrong-token-wrong" } });
    assert.equal(bad.status, 403, method + " bad csrf");
  }
  assert.equal((await call(w.env, notePath("bob"), { method: "POST", body: { body: "x" }, session: w.session("alice") })).status, 405);
  const env = makeEnv({ ...makeLimiters(false).bindings });
  const zed = await seedUser(env.__sqlite, { username: "zed" });
  await seedUser(env.__sqlite, { username: "yan" });
  const limited = await call(env, notePath("yan"), { method: "PUT", body: { body: "x" }, session: forgeSession(env.__sqlite, zed) });
  assert.equal(limited.status, 429);
  assert.equal(count(w.db, "private_notes"), 0);
  assert.equal(count(env.__sqlite, "private_notes"), 0);
});

test("validation: unknown member 404, yourself 400, empty body 400 (use DELETE), over the cap 400, bad JSON 400/415", async () => {
  const w = await world();
  assert.equal(PRIVATE_NOTE_MAX_CHARS, 280);
  assert.equal((await getNote(w, "alice", "nobody-here")).status, 404);
  assert.equal((await putNote(w, "alice", "nobody-here", "x")).status, 404);
  assert.equal((await delNote(w, "alice", "nobody-here")).status, 404);
  assert.equal((await call(w.env, "/api/users/%E0%A4%A/note", { session: w.session("alice") })).status, 404);
  assert.equal((await getNote(w, "alice", "alice")).status, 400);
  assert.equal((await putNote(w, "alice", "alice", "me")).status, 400);
  for (const body of ["", "   ", null, 7, ["x"]]) {
    assert.equal((await putNote(w, "alice", "bob", body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await putNote(w, "alice", "bob", "y".repeat(281))).status, 400);
  assert.equal((await putNote(w, "alice", "bob", " " + "y".repeat(280) + " ")).status, 200, "trimmed to the cap");
  const raw = await call(w.env, notePath("bob"), { method: "PUT", body: "nope", headers: { "Content-Type": "text/plain" }, session: w.session("alice") });
  assert.ok([400, 415].includes(raw.status));
  assert.equal(count(w.db, "private_notes"), 1);
});

test("PUT upserts one note per owner+subject; GET reads it back; DELETE removes; usernames are case-insensitive", async () => {
  const w = await world();
  assert.deepEqual(await (await getNote(w, "alice", "bob")).json(), { note: null });
  const first = await putNote(w, "alice", "BoB", "  met at the jam  ");
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.equal(saved.note.body, "met at the jam");
  assert.equal(typeof saved.note.updatedAt, "string");
  assert.equal((await putNote(w, "alice", "bob", "second take")).status, 200);
  assert.equal(count(w.db, "private_notes WHERE owner_id = ?", w.id.alice), 1);
  const back = await (await getNote(w, "alice", "bob")).json();
  assert.equal(back.note.body, "second take");
  assert.deepEqual(Object.keys(back.note).sort(), ["body", "updatedAt"]);
  assert.equal((await getNote(w, "alice", "bob")).headers.get("Cache-Control"), "no-store");
  const gone = await delNote(w, "alice", "bob");
  assert.equal(gone.status, 200);
  assert.deepEqual(await gone.json(), { note: null });
  assert.equal(count(w.db, "private_notes"), 0);
  assert.equal((await delNote(w, "alice", "bob")).status, 200, "DELETE is idempotent");
});

test("owner-only: the subject, another member, staff and guests never read the note", async () => {
  const w = await world();
  await putNote(w, "alice", "bob", "PRIVNOTE-ALICE-ON-BOB");
  for (const who of ["bob", "carol", "boss"]) {
    const res = await getNote(w, who, "bob" === who ? "alice" : "bob");
    assert.equal(res.status, 200, who);
    const text = await res.text();
    assert.ok(!text.includes("PRIVNOTE-ALICE-ON-BOB"), who + " reads alice's note");
    assert.deepEqual(JSON.parse(text), { note: null }, who);
  }
  // Staff have no bypass: boss deleting "bob's note" touches only boss's row.
  assert.equal((await delNote(w, "boss", "bob")).status, 200);
  assert.equal(count(w.db, "private_notes"), 1);
  assert.equal((await call(w.env, notePath("bob"))).status, 401);
  // The subject's public face and own export carry nothing.
  for (const path of ["/api/users/bob", "/users/bob", "/api/me/export", "/api/session"]) {
    const res = await call(w.env, path, { session: w.session("bob") });
    assert.ok(!(await res.text()).includes("PRIVNOTE"), "bob " + path);
  }
});

test("a banned or block-paired subject: the owner still reads, edits and deletes their own note", async () => {
  const w = await world();
  await putNote(w, "alice", "bob", "before the ban");
  await putNote(w, "alice", "carol", "before the block");
  seedBan(w.db, w.id.bob);
  w.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(w.id.carol, w.id.alice, now());
  assert.equal((await (await getNote(w, "alice", "bob")).json()).note.body, "before the ban");
  assert.equal((await (await getNote(w, "alice", "carol")).json()).note.body, "before the block");
  assert.equal((await putNote(w, "alice", "carol", "after the block")).status, 200);
  assert.equal((await delNote(w, "alice", "bob")).status, 200);
  assert.equal((await delNote(w, "alice", "carol")).status, 200);
  assert.equal(count(w.db, "private_notes"), 0);
});

test("a banned OWNER may read and delete but not write", async () => {
  const w = await world();
  await putNote(w, "alice", "bob", "mine");
  seedBan(w.db, w.id.alice);
  assert.equal((await (await getNote(w, "alice", "bob")).json()).note.body, "mine");
  assert.equal((await putNote(w, "alice", "bob", "new")).status, 403);
  assert.equal((await delNote(w, "alice", "bob")).status, 200);
});

test("per-owner cap: PRIVATE_NOTES_MAX new subjects, editing an existing note still works at the cap", async () => {
  const w = await world();
  assert.ok(Number.isSafeInteger(PRIVATE_NOTES_MAX) && PRIVATE_NOTES_MAX >= 100);
  const insert = w.db.prepare("INSERT INTO users (username, username_key, password_hash, password_salt, role, created_at) VALUES (?, ?, 'x', 'x', 'member', ?)");
  const note = w.db.prepare("INSERT INTO private_notes (owner_id, subject_id, body, updated_at) VALUES (?, ?, 'n', ?)");
  for (let i = 0; i < PRIVATE_NOTES_MAX; i++) {
    const subject = Number(insert.run("filler" + i, "filler" + i, now()).lastInsertRowid);
    note.run(w.id.alice, subject, now());
  }
  assert.equal((await putNote(w, "alice", "bob", "one too many")).status, 400);
  assert.equal((await putNote(w, "alice", "filler0", "edit at the cap")).status, 200);
  assert.equal(count(w.db, "private_notes WHERE owner_id = ?", w.id.alice), PRIVATE_NOTES_MAX);
});

test("export: the owner's own notes (subject username, body, updatedAt); never notes about the caller", async () => {
  const w = await world();
  assert.equal(EXPORT_SECTION_CAPS.privateNotes, PRIVATE_NOTES_MAX);
  await putNote(w, "alice", "bob", "ALICE-ON-BOB");
  await putNote(w, "bob", "alice", "BOB-ON-ALICE");
  const data = await (await call(w.env, "/api/me/export", { session: w.session("alice") })).json();
  assert.equal(data.privateNotes.length, 1);
  assert.deepEqual(Object.keys(data.privateNotes[0]).sort(), ["body", "subject", "updatedAt"]);
  assert.equal(data.privateNotes[0].subject, "bob");
  assert.equal(data.privateNotes[0].body, "ALICE-ON-BOB");
  assert.equal(data.truncated.privateNotes, false);
  assert.ok(!JSON.stringify(data).includes("BOB-ON-ALICE"));
});

test("source pins: bound params only, hard LIMIT, owner-keyed queries, no SELECT *", () => {
  const src = read("api/private-notes.mjs");
  assert.doesNotMatch(src, /SELECT \*/);
  assert.match(src, /requireUser/);
  assert.match(src, /rateLimit\(request, env, "write"/);
  assert.match(src, /LIMIT 1/);
  for (const sql of src.match(/"(SELECT|INSERT|UPDATE|DELETE)[^;]*?"/g) || []) {
    assert.doesNotMatch(sql, /\$\{/, "no template interpolation in SQL");
  }
  assert.doesNotMatch(read("api/posts-feed.mjs"), /private_notes/);
  assert.doesNotMatch(read("api/mcp.mjs"), /private_notes/);
  assert.doesNotMatch(read("api/seo.mjs"), /private_notes/);
  assert.doesNotMatch(read("api/search.mjs"), /private_notes/);
  assert.match(read("worker.mjs"), /handlePrivateNoteRoutes/);
});

// ---- client: the profile box ---------------------------------------------------

test("client: the box is textContent-only, labelled, capped at 280, and starts disabled", () => {
  const doc = makeFakeDocument();
  assert.equal(privateNotePath("a b/c"), "/api/users/a%20b%2Fc/note");
  const box = createPrivateNoteBox(doc, { username: "<b>bob</b>" });
  assert.ok(box.classList.contains("private-note"));
  assert.equal(findByClass(box, "private-note-title").textContent, t("privateNote.title"));
  assert.equal(findByClass(box, "private-note-hint").textContent, t("privateNote.hint"));
  const input = findByClass(box, "private-note-input");
  assert.equal(input.tagName.toLowerCase(), "textarea");
  assert.equal(Number(input.maxLength ?? input.getAttribute("maxlength")), 280);
  assert.equal(input.getAttribute("aria-label"), t("privateNote.label"));
  assert.equal(input.disabled, true);
  assert.equal(findByClass(box, "private-note-save").textContent, t("privateNote.save"));
  assert.equal(findByClass(box, "private-note-delete").textContent, t("privateNote.delete"));
  assert.equal(findByClass(box, "private-note-status").getAttribute("role"), "status");
  const src = read("public/js/private-note.js");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
});

test("client: load fills the note; save PUTs, empty save DELETEs; a failed read removes the box", async () => {
  const doc = makeFakeDocument();
  const calls = [];
  const fakeApi = async (path, options = {}) => {
    calls.push([path, options.method || "GET", options.body]);
    if ((options.method || "GET") === "GET") return { note: { body: "hello <i>x</i>", updatedAt: "2026-11-22T00:00:00.000Z" } };
    if (options.method === "PUT") return { note: { body: options.body.body, updatedAt: "2026-11-22T00:00:01.000Z" } };
    return { note: null };
  };
  const parent = doc.createElement("div");
  const box = createPrivateNoteBox(doc, { username: "bob", request: fakeApi });
  parent.append(box);
  await loadPrivateNote(box);
  const input = findByClass(box, "private-note-input");
  assert.equal(input.value, "hello <i>x</i>");
  assert.equal(input.disabled, false);
  input.value = "  updated  ";
  await box.savePrivateNote();
  assert.deepEqual(calls.at(-1), ["/api/users/bob/note", "PUT", { body: "updated" }]);
  assert.equal(findByClass(box, "private-note-status").textContent, t("privateNote.saved"));
  input.value = "   ";
  await box.savePrivateNote();
  assert.deepEqual(calls.at(-1).slice(0, 2), ["/api/users/bob/note", "DELETE"]);
  assert.equal(findByClass(box, "private-note-status").textContent, t("privateNote.deleted"));
  assert.equal(input.value, "");
  await box.deletePrivateNote();
  assert.equal(calls.at(-1)[1], "DELETE");

  const failing = createPrivateNoteBox(doc, { username: "bob", request: async () => { throw new Error("nope"); } });
  parent.append(failing);
  await loadPrivateNote(failing);
  assert.equal(failing.parentNode, null, "removed on a failed read");
  const saveFails = createPrivateNoteBox(doc, {
    username: "bob",
    request: async (path, options = {}) => { if (options.method) throw new Error("x"); return { note: null }; },
  });
  await loadPrivateNote(saveFails);
  findByClass(saveFails, "private-note-input").value = "x";
  await saveFails.savePrivateNote();
  assert.equal(findByClass(saveFails, "private-note-status").textContent, t("privateNote.saveError"));
});

test("client: the profile shows the box only to signed-in viewers on someone else's profile", () => {
  const src = read("public/js/routes/profile.js");
  assert.match(src, /createPrivateNoteBox/);
  assert.match(src, /session\.user && session\.user\.id !== profile\.id[\s\S]{0,400}createPrivateNoteBox/);
});
