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

// v5.48.0: saved searches (migration 0073). GET/POST /api/me/saved-searches
// and DELETE /api/me/saved-searches/:id — a saved search is a name plus the
// search's q/by/in, validated with api/search.mjs's own constants, visible
// ONLY to its owner (no staff bypass), at most SAVED_SEARCHES_MAX per member
// (enforced inside the INSERT). Running one is just a link to the existing
// search page; this module executes no search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";
import { makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import { EXPORT_SECTION_CAPS, SAVED_SEARCH_NAME_MAX_CHARS, SAVED_SEARCHES_MAX } from "../constants.mjs";
import { SEARCH_IN_SCOPES, SEARCH_QUERY_MAX_CHARS } from "../api/search.mjs";
import { createSavedSearches, loadSavedSearches, savedSearchLink, SAVED_SEARCHES_PATH } from "../public/js/saved-searches.js";
import { t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "migrations/0073_saved_searches.sql";
const PATH = "/api/me/saved-searches";

async function world(overrides = {}) {
  const env = makeEnv(overrides);
  const db = env.__sqlite;
  const id = {};
  for (const name of ["alice", "bob"]) id[name] = await seedUser(db, { username: name });
  id.boss = await seedUser(db, { username: "boss", role: "admin" });
  const session = (name) => forgeSession(db, id[name]);
  return { env, db, id, session };
}
const count = (db, sql, ...args) => db.prepare("SELECT COUNT(*) AS n FROM " + sql).get(...args).n;
const list = (w, who) => call(w.env, PATH, { session: w.session(who) });
const save = (w, who, body) => call(w.env, PATH, { method: "POST", body, session: w.session(who) });
const remove = (w, who, id) => call(w.env, PATH + "/" + id, { method: "DELETE", session: w.session(who) });
const insertRaw = (db, owner, name, q = "cats") => Number(db.prepare(
  "INSERT INTO saved_searches (owner_id, name, q, created_at) VALUES (?, ?, ?, ?)").run(owner, name, q, now()).lastInsertRowid);

// ---- migration ---------------------------------------------------------------

test("migration 0073 is CREATE-only; owner cascades; UNIQUE(owner_id, name); CHECKs mirror the caps", async () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS saved_searches/);
  assert.match(sql, /UNIQUE \(owner_id, name\)/);
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  const refs = sql.match(/REFERENCES [^,\n]+/g) || [];
  assert.equal(refs.length, 1);
  assert.match(refs[0], /ON DELETE CASCADE/);
  const w = await world();
  const fks = w.db.prepare("PRAGMA foreign_key_list(saved_searches)").all();
  assert.deepEqual(fks.map((fk) => [fk.table, fk.from, fk.on_delete]), [["users", "owner_id", "CASCADE"]]);
  const insert = (name, q, inScope = null) => w.db.prepare(
    "INSERT INTO saved_searches (owner_id, name, q, in_scope, created_at) VALUES (?, ?, ?, ?, ?)").run(w.id.alice, name, q, inScope, now());
  assert.throws(() => insert("", "q"), /CHECK/);
  assert.throws(() => insert("n".repeat(SAVED_SEARCH_NAME_MAX_CHARS + 1), "q"), /CHECK/);
  assert.throws(() => insert("a", ""), /CHECK/);
  assert.throws(() => insert("b", "q".repeat(SEARCH_QUERY_MAX_CHARS + 1)), /CHECK/);
  assert.throws(() => insert("c", "q", "boards"), /CHECK/);
  insert("n".repeat(SAVED_SEARCH_NAME_MAX_CHARS), "q".repeat(SEARCH_QUERY_MAX_CHARS), "replies");
  insert("Cats", "cats");
  assert.throws(() => insert("cats", "dogs"), /UNIQUE/, "names are unique per owner, case-insensitively");
});

test("cascade: deleting the account (route and raw) takes its saved searches with it", async () => {
  const w = await world();
  w.db.exec("CREATE TABLE IF NOT EXISTS gc_messages (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS gc_channels (id INTEGER PRIMARY KEY)");
  for (const [who, name] of [["alice", "one"], ["alice", "two"], ["bob", "three"]]) {
    assert.equal((await save(w, who, { name, q: "cats" })).status, 201);
  }
  assert.equal((await call(w.env, "/api/me/delete", { method: "POST", session: w.session("alice") })).status, 200);
  assert.equal(count(w.db, "saved_searches WHERE owner_id = ?", w.id.alice), 0);
  assert.equal(count(w.db, "saved_searches"), 1);
  w.db.prepare("DELETE FROM users WHERE id = ?").run(w.id.bob);
  assert.equal(count(w.db, "saved_searches"), 0);
});

// ---- route: auth, validation ---------------------------------------------------

test("auth: GET anon 401; POST/DELETE no Origin 403, anon 401, bad CSRF 403; rate limited 429; PUT 405; nothing written", async () => {
  const w = await world();
  const own = insertRaw(w.db, w.id.alice, "mine");
  assert.equal((await call(w.env, PATH)).status, 401);
  for (const [method, path] of [["POST", PATH], ["DELETE", PATH + "/" + own]]) {
    const body = { name: "x", q: "x" };
    assert.equal((await call(w.env, path, { method, body })).status, 403, method + " no origin");
    const anon = await call(w.env, path, { method, body, headers: { Origin: ORIGIN, "X-CSRF-Token": "x" } });
    assert.equal(anon.status, 401, method + " anon");
    const bad = await call(w.env, path, { method, body, session: { ...w.session("alice"), csrf: "wrong-token-wrong-token-wrong" } });
    assert.equal(bad.status, 403, method + " bad csrf");
  }
  assert.equal((await call(w.env, PATH, { method: "PUT", body: {}, session: w.session("alice") })).status, 405);
  assert.equal(count(w.db, "saved_searches"), 1);
  const env = makeEnv({ ...makeLimiters(false).bindings });
  const zed = await seedUser(env.__sqlite, { username: "zed" });
  const limited = await call(env, PATH, { method: "POST", body: { name: "x", q: "x" }, session: forgeSession(env.__sqlite, zed) });
  assert.equal(limited.status, 429);
  assert.equal(count(env.__sqlite, "saved_searches"), 0);
});

test("validation reuses api/search.mjs's constants: q 1..max, in only a search scope, by a username, name 1..40", async () => {
  const w = await world();
  assert.equal(SEARCH_QUERY_MAX_CHARS, 100);
  assert.deepEqual([...SEARCH_IN_SCOPES], ["replies"]);
  assert.equal(SAVED_SEARCH_NAME_MAX_CHARS, 40);
  const bad = [
    { name: "a", q: "" }, { name: "a", q: "   " }, { name: "a", q: "q".repeat(SEARCH_QUERY_MAX_CHARS + 1) }, { name: "a", q: 7 },
    { name: "a", q: "x", in: "boards" }, { name: "a", q: "x", in: 3 }, { name: "a", q: "x", by: "no spaces" }, { name: "a", q: "x", by: "ab" },
    { name: "", q: "x" }, { name: "  ", q: "x" }, { name: "n".repeat(SAVED_SEARCH_NAME_MAX_CHARS + 1), q: "x" }, { name: 5, q: "x" }, { q: "x" },
  ];
  for (const body of bad) assert.equal((await save(w, "alice", body)).status, 400, JSON.stringify(body));
  const raw = await call(w.env, PATH, { method: "POST", body: "nope", headers: { "Content-Type": "text/plain" }, session: w.session("alice") });
  assert.ok([400, 415].includes(raw.status));
  assert.equal(count(w.db, "saved_searches"), 0);
  const okMax = await save(w, "alice", { name: " " + "n".repeat(SAVED_SEARCH_NAME_MAX_CHARS) + " ", q: " " + "q".repeat(SEARCH_QUERY_MAX_CHARS) + " " });
  assert.equal(okMax.status, 201, "trimmed to the caps");
  const full = await (await save(w, "alice", { name: "full", q: "Cats", by: "Bob", in: "REPLIES" })).json();
  assert.equal(full.savedSearch.by, "bob");
  assert.equal(full.savedSearch.in, "replies");
  const plain = await (await save(w, "alice", { name: "plain", q: "dogs", by: "", in: "" })).json();
  assert.equal(plain.savedSearch.by, null);
  assert.equal(plain.savedSearch.in, null);
  // The module imports the search constants — it never copies the numbers.
  const src = read("api/saved-searches.mjs");
  assert.match(src, /import \{[^}]*SEARCH_QUERY_MAX_CHARS[^}]*\} from "\.\/search\.mjs"/);
  assert.match(src, /SEARCH_IN_SCOPES/);
  assert.doesNotMatch(src, /\b100\b|'replies'|"replies"/);
  // Search behavior is unchanged: the same 400s on the live route.
  assert.equal((await call(w.env, "/api/search?q=" + "q".repeat(101))).status, 400);
  assert.equal((await call(w.env, "/api/search?q=" + "q".repeat(100))).status, 200);
  assert.equal((await call(w.env, "/api/search?q=x&in=boards")).status, 400);
  assert.equal((await call(w.env, "/api/search?q=x&in=replies")).status, 200);
});

test("POST 201 returns the saved search; GET lists the owner's own, newest first, no-store; duplicate name 409", async () => {
  const w = await world();
  assert.deepEqual(await (await list(w, "alice")).json(), { savedSearches: [] });
  const first = await save(w, "alice", { name: "  Cats  ", q: "  cat pics  " });
  assert.equal(first.status, 201);
  const made = (await first.json()).savedSearch;
  assert.deepEqual(Object.keys(made).sort(), ["by", "createdAt", "id", "in", "name", "q"]);
  assert.equal(made.name, "Cats");
  assert.equal(made.q, "cat pics");
  assert.equal(typeof made.id, "number");
  assert.equal((await save(w, "alice", { name: "Dogs", q: "dogs" })).status, 201);
  const dup = await save(w, "alice", { name: "cats", q: "other" });
  assert.equal(dup.status, 409, "case-insensitive duplicate name");
  assert.equal((await save(w, "bob", { name: "Cats", q: "bob's" })).status, 201, "names are per owner");
  const res = await list(w, "alice");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const rows = (await res.json()).savedSearches;
  assert.deepEqual(rows.map((r) => r.name), ["Dogs", "Cats"]);
  assert.equal(count(w.db, "saved_searches WHERE owner_id = ?", w.id.alice), 2);
});

test("cap: SAVED_SEARCHES_MAX per member, enforced inside the INSERT; 400 at the cap; GET never returns more", async () => {
  const w = await world();
  assert.equal(SAVED_SEARCHES_MAX, 20);
  for (let i = 0; i < SAVED_SEARCHES_MAX; i++) insertRaw(w.db, w.id.alice, "s" + i);
  const over = await save(w, "alice", { name: "one too many", q: "x" });
  assert.equal(over.status, 400);
  assert.equal(count(w.db, "saved_searches WHERE owner_id = ?", w.id.alice), SAVED_SEARCHES_MAX);
  assert.equal((await save(w, "bob", { name: "bob's first", q: "x" })).status, 201, "the cap is per member");
  // Raw rows past the cap (a race the INSERT forbids) still list at most 20.
  insertRaw(w.db, w.id.alice, "extra");
  assert.equal((await (await list(w, "alice")).json()).savedSearches.length, SAVED_SEARCHES_MAX);
  const src = read("api/saved-searches.mjs");
  assert.match(src, /INSERT INTO saved_searches[^"]*" \+\s*"[^"]*WHERE \(SELECT COUNT\(\*\) FROM saved_searches WHERE owner_id = \?\) < /);
  assert.match(src, /LIMIT " \+ SAVED_SEARCHES_MAX/);
});

test("DELETE: own row 200; another member's id, staff on a member's id, unknown and malformed ids all 404 alike", async () => {
  const w = await world();
  const alices = insertRaw(w.db, w.id.alice, "mine");
  const crossOwner = await remove(w, "bob", alices);
  assert.equal(crossOwner.status, 404);
  const crossBody = await crossOwner.text();
  const unknown = await remove(w, "bob", alices + 999);
  assert.equal(unknown.status, 404);
  assert.equal(await unknown.text(), crossBody, "no existence oracle: same body for theirs and nobody's");
  assert.equal((await remove(w, "boss", alices)).status, 404, "staff have no bypass");
  for (const badId of ["abc", "0x1", "1.5", "9".repeat(30)]) {
    assert.equal((await remove(w, "alice", badId)).status, 404, badId);
  }
  assert.equal(count(w.db, "saved_searches"), 1);
  const own = await remove(w, "alice", alices);
  assert.equal(own.status, 200);
  assert.deepEqual(await own.json(), { ok: true });
  assert.equal(count(w.db, "saved_searches"), 0);
  assert.equal((await remove(w, "alice", alices)).status, 404, "already gone");
});

test("owner-only: other members and staff list only their own; a banned owner may read and delete, not save", async () => {
  const w = await world();
  await save(w, "alice", { name: "SAVEDSEARCH-ALICE", q: "savedsearch-alice-q" });
  for (const who of ["bob", "boss"]) {
    const text = await (await list(w, who)).text();
    assert.ok(!/SAVEDSEARCH-ALICE|savedsearch-alice-q/.test(text), who);
    assert.deepEqual(JSON.parse(text), { savedSearches: [] }, who);
  }
  for (const path of ["/api/users/alice", "/users/alice", "/api/me/export", "/api/session", "/api/search?q=savedsearch-alice-q"]) {
    const res = await call(w.env, path, { session: w.session("bob") });
    assert.ok(!(await res.text()).includes("SAVEDSEARCH-ALICE"), "bob " + path);
  }
  seedBan(w.db, w.id.alice);
  const rows = (await (await list(w, "alice")).json()).savedSearches;
  assert.equal(rows.length, 1);
  assert.equal((await save(w, "alice", { name: "new", q: "x" })).status, 403);
  assert.equal((await remove(w, "alice", rows[0].id)).status, 200);
});

test("export: the owner's own saved searches (name, q, by, in, createdAt); never another member's", async () => {
  const w = await world();
  assert.equal(EXPORT_SECTION_CAPS.savedSearches, SAVED_SEARCHES_MAX);
  await save(w, "alice", { name: "ALICE-SAVED", q: "cats", by: "bob", in: "replies" });
  await save(w, "bob", { name: "BOB-SAVED", q: "dogs" });
  const data = await (await call(w.env, "/api/me/export", { session: w.session("alice") })).json();
  assert.equal(data.savedSearches.length, 1);
  assert.deepEqual(data.savedSearches[0], { ...data.savedSearches[0], name: "ALICE-SAVED", q: "cats", by: "bob", in: "replies" });
  assert.deepEqual(Object.keys(data.savedSearches[0]).sort(), ["by", "createdAt", "in", "name", "q"]);
  assert.equal(data.truncated.savedSearches, false);
  assert.ok(!JSON.stringify(data).includes("BOB-SAVED"));
});

test("source pins: bound params only, owner-keyed, no SELECT *, never read by feed/search/MCP/page head", () => {
  const src = read("api/saved-searches.mjs");
  assert.doesNotMatch(src, /SELECT \*/);
  assert.match(src, /requireUser/);
  assert.match(src, /requireSignedInRead/);
  assert.match(src, /assertNotBanned/);
  assert.match(src, /rateLimit\(request, env, "write"/);
  assert.match(src, /DELETE FROM saved_searches WHERE id = \? AND owner_id = \?/);
  assert.ok(SAVED_SEARCHES_MAX < 100, "LIMIT stays under D1_MAX_BOUND_PARAMS");
  for (const sql of src.match(/"(SELECT|INSERT|UPDATE|DELETE)[^;]*?"/g) || []) {
    assert.doesNotMatch(sql, /\$\{/, "no template interpolation in SQL");
  }
  for (const file of ["api/posts-feed.mjs", "api/mcp.mjs", "api/seo.mjs", "api/search.mjs"]) {
    assert.doesNotMatch(read(file), /saved_searches/, file);
  }
  assert.match(read("worker.mjs"), /handleSavedSearchRoutes/);
});

// ---- client: the search-page panel -----------------------------------------

const ITEMS = [
  { id: 7, name: "<b>Cats</b>", q: "cat & dog?", by: null, in: null, createdAt: "2026-11-22T00:00:00.000Z" },
  { id: 9, name: "By bob", q: "jam", by: "bob", in: "replies", createdAt: "2026-11-21T00:00:00.000Z" },
];

test("client: run links are built with the URL API onto the existing search page", () => {
  assert.equal(SAVED_SEARCHES_PATH, "/api/me/saved-searches");
  assert.equal(savedSearchLink(ITEMS[0]), "/?q=cat+%26+dog%3F");
  assert.equal(savedSearchLink(ITEMS[1]), "/?q=jam&by=bob&in=replies");
  assert.equal(savedSearchLink({ q: "//evil.example" }), "/?q=%2F%2Fevil.example");
  const src = read("public/js/saved-searches.js");
  assert.match(src, /searchPagePath/);
  assert.match(src, /new URL\(/);
});

test("client: inline accessible form (no window.prompt), textContent only, labelled, capped at 40", async () => {
  const doc = makeFakeDocument();
  const panel = createSavedSearches(doc, { query: "cats", request: async () => ({ savedSearches: ITEMS }) });
  assert.ok(panel.classList.contains("saved-searches"));
  assert.equal(findByClass(panel, "saved-searches-title").textContent, t("savedSearch.title"));
  const open = findByClass(panel, "saved-search-open");
  assert.equal(open.tagName.toLowerCase(), "button");
  assert.equal(open.textContent, t("savedSearch.open"));
  assert.equal(open.getAttribute("aria-expanded"), "false");
  const form = findByClass(panel, "saved-search-form");
  assert.equal(form.tagName.toLowerCase(), "form");
  assert.equal(form.hidden, true);
  assert.equal(open.getAttribute("aria-controls"), form.id);
  const input = findByClass(panel, "saved-search-name");
  const label = findByClass(panel, "saved-search-label");
  assert.equal(label.tagName.toLowerCase(), "label");
  assert.equal(label.textContent, t("savedSearch.nameLabel"));
  assert.ok(input.id && label.getAttribute("for") === input.id);
  assert.equal(Number(input.maxLength ?? input.getAttribute("maxlength")), 40);
  assert.equal(findByClass(panel, "saved-search-submit").textContent, t("common.save"));
  assert.equal(findByClass(panel, "saved-search-cancel").textContent, t("common.cancel"));
  assert.equal(findByClass(panel, "saved-search-status").getAttribute("role"), "status");
  open.dispatch("click", { preventDefault() {} });
  assert.equal(form.hidden, false);
  assert.equal(open.getAttribute("aria-expanded"), "true");
  assert.equal(input.ownerFocused, true);
  findByClass(panel, "saved-search-cancel").dispatch("click", { preventDefault() {} });
  assert.equal(form.hidden, true);
  assert.equal(open.ownerFocused, true, "focus returns to the opener");
  await loadSavedSearches(panel);
  assert.equal(countByClass(panel, "saved-search-item"), 2);
  const run = findByClass(panel, "saved-search-run");
  assert.equal(run.textContent, "<b>Cats</b>");
  assert.equal(run.href, "/?q=cat+%26+dog%3F");
  assert.equal(findByClass(panel, "saved-search-delete").getAttribute("aria-label"), t("savedSearch.deleteLabel", { name: "<b>Cats</b>" }));
  const src = read("public/js/saved-searches.js");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bprompt\(/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
});

test("client: save POSTs {name, q}; 409 says duplicate; delete DELETEs the id; empty state; failed load removes the panel", async () => {
  const doc = makeFakeDocument();
  const calls = [];
  const fakeApi = async (path, options = {}) => {
    const method = options.method || "GET";
    calls.push([path, method, options.body]);
    if (method === "GET") return { savedSearches: [] };
    if (method === "POST") {
      if (options.body.name === "dup") {
        const error = new Error("dup");
        error.status = 409;
        throw error;
      }
      return { savedSearch: { id: 11, name: options.body.name, q: options.body.q, by: null, in: null, createdAt: "x" } };
    }
    return { ok: true };
  };
  const parent = doc.createElement("div");
  const panel = createSavedSearches(doc, { query: "  cats  ", request: fakeApi });
  parent.append(panel);
  await loadSavedSearches(panel);
  assert.equal(findByClass(panel, "saved-search-empty").textContent, t("savedSearch.empty"));
  const input = findByClass(panel, "saved-search-name");
  input.value = "  ";
  await panel.saveCurrentSearch();
  assert.equal(calls.filter((c) => c[1] === "POST").length, 0, "a blank name sends nothing");
  input.value = "  My cats  ";
  await panel.saveCurrentSearch();
  assert.deepEqual(calls.at(-1), [SAVED_SEARCHES_PATH, "POST", { name: "My cats", q: "cats" }]);
  assert.equal(findByClass(panel, "saved-search-status").textContent, t("savedSearch.saved"));
  assert.equal(countByClass(panel, "saved-search-item"), 1);
  assert.equal(findByClass(panel, "saved-search-form").hidden, true);
  input.value = "dup";
  await panel.saveCurrentSearch();
  assert.equal(findByClass(panel, "saved-search-status").textContent, t("savedSearch.duplicate"));
  findByClass(panel, "saved-search-delete").dispatch("click", { preventDefault() {} });
  await panel.pending;
  assert.deepEqual(calls.at(-1).slice(0, 2), [SAVED_SEARCHES_PATH + "/11", "DELETE"]);
  assert.equal(countByClass(panel, "saved-search-item"), 0);
  assert.equal(findByClass(panel, "saved-search-status").textContent, t("savedSearch.deleted"));
  const failing = createSavedSearches(doc, { query: "x", request: async () => { throw new Error("nope"); } });
  parent.append(failing);
  await loadSavedSearches(failing);
  assert.equal(failing.parentNode, null, "removed on a failed read");
});

test("client: the search page mounts the panel for signed-in members only", () => {
  const src = read("public/js/routes/feed.js");
  assert.match(src, /route\.name === "search"[\s\S]{0,600}session\.user[\s\S]{0,200}createSavedSearches/);
});
