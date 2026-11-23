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

// The translate module, P1 (slate 2026-11-22-translate §9): module off is
// gone; the validation laws; auth, CSRF, ban and rate-limit gates; the
// pending caps; the visibility law on suggestion reads; the bind budget;
// approve-supersedes; the owner's export; privacy; the string block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { makeAssets, makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, seedBan, seedUser } from "./helpers/seed.mjs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import {
  RATE_LIMIT_BINDINGS, TRANSLATE_PENDING_PER_KEY_MAX, TRANSLATE_PENDING_PER_MEMBER_MAX,
  TRANSLATE_REJECTED_RETENTION_DAYS,
} from "../constants.mjs";
import { moduleForPath } from "../api/core/modules.mjs";
import { TRANSLATE_SQL } from "../api/translate.mjs";
import {
  TRANSLATE_SAME_AS_EN_OK, placeholdersOf, pluralNumbersFor, suggestionProblem, translateValueMax,
} from "../public/js/translate-validate.js";
import { EXPORT_SQL, mergeApproved, serializeTable } from "../scripts/translate-export.mjs";
import { ROUTE_MODULE_LOADERS, ROUTE_OWNERS } from "../public/js/route-modules.js";
import { routeForPath, routeModuleId } from "../public/js/router.js";
import { paintTranslateLink } from "../public/js/translate-link.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const readLocale = (code) => JSON.parse(read(`public/locales/${code}.json`));
const en = readLocale("en");
const fr = readLocale("fr");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const BIDI_OVERRIDE = String.fromCharCode(0x202e);

// ASSETS that serve the real locale tables (the worker reads them there).
const localeAssets = () => makeAssets(async (request) => {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/locales/")) {
    try {
      return new Response(readFileSync(new URL("public" + path, ROOT)), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response("Not found.\n", { status: 404, headers: { "Content-Type": "text/plain" } });
    }
  }
  return new Response("<!doctype html><html><head><title>t</title></head><body>shell</body></html>", {
    status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

const storeModule = (env, on) => env.__sqlite
  .prepare("INSERT OR REPLACE INTO instance_modules (id, enabled, updated_at, updated_by) VALUES ('translate', ?, 1, NULL)")
  .run(on ? 1 : 0);

function onEnv(overrides = {}) {
  const env = makeEnv({ ASSETS: localeAssets(), HUMAN_CHECK: "off", ...overrides });
  storeModule(env, true);
  return env;
}

let serial = 0;
async function member(env, role = "member") {
  serial += 1;
  const id = await seedUser(env.__sqlite, { username: `tr${role}${serial}`, role });
  return { id, session: forgeSession(env.__sqlite, id), username: `tr${role}${serial}` };
}
const staff = (env) => member(env, "moderator"); // stored 'moderator' = public admin

const KEY = "translate.submit"; // "Suggest": no placeholders
const suggest = (env, session, { locale = "fr", key = KEY, value = "Proposer", sourceHash, credit = false } = {}) =>
  call(env, `/api/translate/${locale}/${key}/suggestions`, {
    method: "POST", session, body: { value, sourceHash: sourceHash ?? sha(en[key] ?? ""), credit },
  });

const today = () => Math.floor(Date.now() / 86400000);
function seedSuggestion(env, { userId, locale = "fr", key = KEY, value = "Proposer", status = "pending", credit = 0,
  hash, reviewedDay = null }) {
  const info = env.__sqlite.prepare(
    "INSERT INTO translate_suggestions (locale, msg_key, source_hash, value, user_id, credit, status, created_day, reviewed_day) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(locale, key, hash ?? sha(en[key] ?? "x"), value, userId, credit, status, today(), reviewedDay);
  return Number(info.lastInsertRowid);
}
const statusOf = (env, id) => env.__sqlite.prepare("SELECT status, review_note FROM translate_suggestions WHERE id = ?").get(id);

// ------------------------------------------------------------- module off

test("module off (the default): every /api/translate route answers 404 not_found", async () => {
  const env = makeEnv({ ASSETS: localeAssets(), HUMAN_CHECK: "off" });
  const { session } = await member(env);
  assert.equal(moduleForPath("/api/translate/progress"), "translate");
  assert.equal(moduleForPath("/api/translate/fr/translate.submit/suggestions"), "translate");
  for (const [path, method] of [["/api/translate/progress", "GET"], ["/api/translate/fr/keys", "GET"],
    [`/api/translate/fr/${KEY}/suggestions`, "GET"], [`/api/translate/fr/${KEY}/suggestions`, "POST"],
    ["/api/translate/review", "GET"], ["/api/translate/suggestions/1/review", "POST"],
    ["/api/translate/suggestions/1", "DELETE"]]) {
    const response = await call(env, path, { method, session, body: method === "GET" ? undefined : {} });
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).code, "not_found", path);
  }
});

test("module off: /translate is the honest not-found page and the meta says translate is off", async () => {
  const env = makeEnv({ ASSETS: localeAssets(), HUMAN_CHECK: "off" });
  const off = await worker.fetch(new Request(ORIGIN + "/translate/fr"), env, {});
  assert.equal(off.status, 404);
  assert.match(await off.text(), /<meta name="site-modules-off" content="[^"]*\btranslate\b[^"]*">/);
  storeModule(env, true);
  const on = await worker.fetch(new Request(ORIGIN + "/translate/fr"), env, {});
  assert.equal(on.status, 200);
  assert.doesNotMatch(await on.text(), /<meta name="site-modules-off" content="[^"]*\btranslate\b/);
});

test("browser: the route exists, loads lazily, and app.js swaps it for not-found when off", () => {
  assert.deepEqual(routeForPath("/translate"), { name: "translate" });
  assert.deepEqual(routeForPath("/translate/zh-Hant"), { name: "translate", locale: "zh-Hant" });
  assert.equal(routeForPath("/translate/fr/extra").name, "not-found");
  assert.equal(ROUTE_OWNERS.translate, "translate");
  assert.equal(typeof ROUTE_MODULE_LOADERS.translate, "function");
  assert.doesNotMatch(read("public/js/router.js"), /translate\.js/);
  assert.doesNotMatch(read("public/js/app.js"), /from "\.\/routes\/translate\.js"/);
  // The shared page-module gate (router.js MODULE_ROUTES) covers translate.
  assert.equal(routeModuleId("translate"), "translate");
  assert.match(read("public/js/app.js"), /routeModuleId\(route\.name\)/);
  assert.match(read("public/js/app.js"), /if \(pageModule && !siteModuleOn\(pageModule\)\) return renderRoute\(\{ name: "not-found" \}\)/);
});

test("nav: the footer Translate link paints only when the module is on", () => {
  const make = (offContent) => {
    const footer = makeFakeDocument().createElement("p");
    const doc = makeFakeDocument({
      querySelector: (selector) => {
        if (selector === 'meta[name="site-modules-off"]') return offContent === null ? null : { getAttribute: () => offContent };
        if (selector === ".site-footer p") return footer;
        return null;
      },
    });
    return { doc, footer };
  };
  const off = make("chat,translate");
  paintTranslateLink(off.doc);
  assert.equal(off.footer.querySelector("a"), null);
  const on = make("chat");
  paintTranslateLink(on.doc);
  const link = on.footer.querySelector("a");
  assert.equal(link.getAttribute("href"), "/translate");
  assert.ok(link.hasAttribute("data-app-link"));
  paintTranslateLink(on.doc);
  assert.equal(on.footer.querySelectorAll("a").length, 1, "painting twice adds one link");
});

// ------------------------------------------------------------- validation (pure)

test("validation: placeholders, plural, length, copy of English, markup", () => {
  const progress = en["translate.progress"];
  assert.deepEqual(placeholdersOf(progress), ["done", "percent", "total"]);
  const problem = (key, value) => suggestionProblem({ key, value, source: en[key] });
  assert.equal(problem("translate.progress", "{done} sur {total}"), "placeholders");
  assert.equal(problem("translate.progress", "{done} sur {total} ({percent} %) {x}"), "placeholders");
  assert.equal(problem("translate.progress", "{done} sur {total} ({percent} %) {"), "placeholders");
  assert.equal(problem("translate.progress", "{done} sur {total} ({percent} %)"), null);
  assert.equal(problem("translate.suggestions.few", "{count} propositions"), "plural");
  assert.equal(translateValueMax("Suggest"), 67);
  assert.equal(problem(KEY, "x".repeat(68)), "tooLong");
  assert.equal(problem(KEY, "x".repeat(67)), null);
  assert.equal(translateValueMax("y".repeat(900)), 1000);
  assert.equal(problem(KEY, "Suggest"), "copyOfEnglish");
  assert.equal(problem(KEY, "  suggest "), "markup", "edge spaces English lacks");
  assert.equal(problem(KEY, "SUGGEST"), "copyOfEnglish");
  assert.ok(TRANSLATE_SAME_AS_EN_OK.includes("admin.section.automod"));
  assert.equal(problem("admin.section.automod", "AutoMod"), null);
  for (const bad of ["<b>Proposer</b>", "Proposer &amp; envoyer", "Pro\nposer", "Pro" + BIDI_OVERRIDE + "poser"]) {
    assert.equal(problem(KEY, bad), "markup", JSON.stringify(bad));
  }
  assert.deepEqual(pluralNumbersFor("fr", "one"), [0, 1]);
  assert.deepEqual(pluralNumbersFor("pl", "other"), [0, 2, 5, 11, 21, 101]);
});

// ------------------------------------------------------------- validation (API)

const reasonOf = async (response) => (await response.json()).reason;

test("API validation: each law answers 422 with its reason; stale 409; unknown 404", async () => {
  const env = onEnv({ FILTERED_WORDS: "badword" });
  const { session } = await member(env);
  const progressHash = sha(en["translate.progress"]);
  const cases = [
    [{ key: "translate.progress", value: "{done} sur {total}", sourceHash: progressHash }, "placeholders"],
    [{ key: "translate.progress", value: "{done} {total} {percent} {x}", sourceHash: progressHash }, "placeholders"],
    [{ key: "translate.progress", value: "{done} de {total} ({percent} %) {", sourceHash: progressHash }, "placeholders"],
    [{ key: "translate.suggestions.few", value: "{count} propositions", sourceHash: sha("x") }, "plural"],
    [{ value: "x".repeat(68) }, "tooLong"],
    [{ value: "Suggest" }, "copyOfEnglish"],
    [{ value: "<b>Proposer</b>" }, "markup"],
    [{ value: "Proposer &amp; plus" }, "markup"],
    [{ value: "Pro\nposer" }, "markup"],
    [{ value: "Pro" + BIDI_OVERRIDE + "poser" }, "markup"],
    [{ value: "Proposer badword" }, "filtered"],
  ];
  for (const [options, reason] of cases) {
    const response = await suggest(env, session, options);
    assert.equal(response.status, 422, JSON.stringify(options));
    assert.equal(await reasonOf(response), reason, JSON.stringify(options));
  }
  const long = await suggest(env, session, { value: "x".repeat(68) });
  assert.equal((await long.json()).max, 67);
  const stale = await suggest(env, session, { sourceHash: sha("an older English text") });
  assert.equal(stale.status, 409);
  assert.equal(await reasonOf(stale), "stale");
  for (const options of [{ locale: "xx" }, { locale: "en" }, { key: "translate.nope" }]) {
    const response = await suggest(env, session, options);
    assert.equal(response.status, 404, JSON.stringify(options));
  }
  const allowed = await suggest(env, session, { key: "admin.section.automod", value: "AutoMod" });
  assert.equal(allowed.status, 201);
  const ok = await suggest(env, session, { value: "Proposer" });
  assert.equal(ok.status, 201);
  const row = env.__sqlite.prepare("SELECT * FROM translate_suggestions WHERE value = 'Proposer'").get();
  assert.equal(row.status, "pending");
  assert.equal(row.created_day, today());
});

// ------------------------------------------------------------- gates

test("gates: guest 401, banned 403, CSRF and cross-origin 403, review member 403 / admin 200", async () => {
  const env = onEnv();
  const guest = await worker.fetch(new Request(`${ORIGIN}/api/translate/fr/${KEY}/suggestions`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ value: "Proposer", sourceHash: sha(en[KEY]) }),
  }), env, {});
  assert.equal(guest.status, 401);
  const banned = await member(env);
  seedBan(env.__sqlite, banned.id);
  assert.equal((await suggest(env, banned.session)).status, 403);
  const alice = await member(env);
  const noCsrf = await suggest(env, { ...alice.session, csrf: "wrong-token" });
  assert.equal(noCsrf.status, 403);
  const crossOrigin = await worker.fetch(new Request(`${ORIGIN}/api/translate/fr/${KEY}/suggestions`, {
    method: "POST",
    headers: { Cookie: alice.session.cookie, "X-CSRF-Token": alice.session.csrf, Origin: "https://evil.example",
      "Content-Type": "application/json" },
    body: JSON.stringify({ value: "Proposer", sourceHash: sha(en[KEY]) }),
  }), env, {});
  assert.equal(crossOrigin.status, 403);
  const id = seedSuggestion(env, { userId: alice.id });
  const bob = await member(env);
  const review = (session) => call(env, `/api/translate/suggestions/${id}/review`, {
    method: "POST", session, body: { action: "approve" },
  });
  assert.equal((await review(bob.session)).status, 403);
  assert.equal((await call(env, "/api/translate/review", { session: bob.session })).status, 403);
  const admin = await staff(env);
  assert.equal((await review(admin.session)).status, 200);
  assert.equal(statusOf(env, id).status, "approved");
});

test("rate limit: the translate scope rides the write tier, and a denied limiter answers 429", async () => {
  assert.equal(RATE_LIMIT_BINDINGS.translate, "WRITE_RATE_LIMITER");
  const env = onEnv({ WRITE_RATE_LIMITER: makeLimiters(false).limiter });
  const { session } = await member(env);
  assert.equal((await suggest(env, session)).status, 429);
});

// ------------------------------------------------------------- caps

test("caps: the 201st pending row for a member, the 11th for a key, and a duplicate value are 409", async () => {
  const env = onEnv();
  const busy = await member(env);
  const keys = Object.keys(en).filter((key) => key !== KEY).slice(0, TRANSLATE_PENDING_PER_MEMBER_MAX);
  for (const key of keys) seedSuggestion(env, { userId: busy.id, key, value: "v " + key });
  const overMember = await suggest(env, busy.session);
  assert.equal(overMember.status, 409);
  assert.equal(await reasonOf(overMember), "limit");

  const key = "translate.reject";
  for (let index = 0; index < TRANSLATE_PENDING_PER_KEY_MAX; index += 1) {
    const other = await member(env);
    seedSuggestion(env, { userId: other.id, key, value: "Rejeter " + index });
  }
  const late = await member(env);
  const overKey = await suggest(env, late.session, { key, value: "Refuser" });
  assert.equal(overKey.status, 409);
  assert.equal(await reasonOf(overKey), "limit");

  const first = await member(env);
  const second = await member(env);
  assert.equal((await suggest(env, first.session, { value: "Soumettre" })).status, 201);
  const dupe = await suggest(env, second.session, { value: "soumettre " });
  assert.equal(dupe.status, 422, "edge space is markup before duplicate");
  const exact = await suggest(env, second.session, { value: "Soumettre" });
  assert.equal(exact.status, 409);
  assert.equal(await reasonOf(exact), "duplicate");
});

// ------------------------------------------------------------- visibility

test("visibility: banned and blocked authors hidden from members, shown to staff; guests see no text", async () => {
  const env = onEnv();
  const viewer = await member(env);
  const banned = await member(env);
  const blocker = await member(env);
  const quiet = await member(env);
  const named = await member(env);
  seedBan(env.__sqlite, banned.id);
  env.__sqlite.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, 1)").run(blocker.id, viewer.id);
  seedSuggestion(env, { userId: banned.id, value: "Par un banni" });
  seedSuggestion(env, { userId: blocker.id, value: "Par un bloqueur" });
  seedSuggestion(env, { userId: quiet.id, value: "Discret", credit: 0 });
  seedSuggestion(env, { userId: named.id, value: "Nommé", credit: 1 });
  const path = `/api/translate/fr/${KEY}/suggestions`;

  const asMember = await call(env, path, { session: viewer.session });
  assert.equal(asMember.status, 200);
  const memberText = await asMember.text();
  const memberItems = JSON.parse(memberText).items;
  assert.deepEqual(memberItems.map((item) => item.value).sort(), ["Discret", "Nommé"]);
  assert.doesNotMatch(memberText, new RegExp(quiet.username));
  assert.equal(memberItems.find((item) => item.value === "Discret").author, null);
  assert.equal(memberItems.find((item) => item.value === "Nommé").author, named.username);

  const admin = await staff(env);
  const asStaff = await (await call(env, path, { session: admin.session })).json();
  assert.equal(asStaff.items.length, 4);
  assert.equal(asStaff.items.find((item) => item.value === "Discret").author, quiet.username);
  const queue = await (await call(env, "/api/translate/review?locale=fr", { session: admin.session })).json();
  assert.equal(queue.items.length, 4);

  assert.equal((await call(env, path)).status, 401);
  const guestKeys = await (await call(env, "/api/translate/fr/keys?q=translate.submit")).json();
  assert.ok(guestKeys.items.some((item) => item.key === KEY));
  assert.ok(guestKeys.items.every((item) => !("pending" in item)), "guests get no suggestion counts or text");
  const memberKeys = await (await call(env, "/api/translate/fr/keys?q=translate.submit", { session: viewer.session })).json();
  assert.equal(memberKeys.items.find((item) => item.key === KEY).pending, 4);
});

// ------------------------------------------------------------- bind budget

test("bind budget: every statement binds 10 or fewer; the keys page counts bind 2 at size 50", async () => {
  for (const [name, sql] of Object.entries(TRANSLATE_SQL)) {
    assert.ok((sql.match(/\?/g) || []).length <= 10, name);
    assert.doesNotMatch(sql, /\?\d/, name + " uses positional ? only");
  }
  const env = onEnv();
  const { session } = await member(env);
  const binds = [];
  const prepare = env.FORUM_DB.prepare.bind(env.FORUM_DB);
  env.FORUM_DB.prepare = (sql) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => { binds.push({ sql, count: values.length }); return bind(...values); };
    return statement;
  };
  const page = await (await call(env, "/api/translate/fr/keys", { session })).json();
  assert.equal(page.items.length, 50);
  const counts = binds.filter((entry) => /json_each/.test(entry.sql));
  assert.equal(counts.length, 1);
  assert.equal(counts[0].count, 2);
  assert.ok(binds.every((entry) => entry.count <= 10), JSON.stringify(binds.map((entry) => entry.count)));
});

// ------------------------------------------------------------- review

test("approve supersedes the other pending rows for the key; a stale row cannot be approved", async () => {
  const env = onEnv();
  const a = await member(env);
  const b = await member(env);
  const c = await member(env);
  const winner = seedSuggestion(env, { userId: a.id, value: "Proposer" });
  const loser = seedSuggestion(env, { userId: b.id, value: "Suggérer" });
  const otherKey = seedSuggestion(env, { userId: b.id, key: "translate.reject", value: "Rejeter" });
  const admin = await staff(env);
  let batches = 0;
  const batch = env.FORUM_DB.batch.bind(env.FORUM_DB);
  env.FORUM_DB.batch = (statements) => { batches += 1; return batch(statements); };
  const response = await call(env, `/api/translate/suggestions/${winner}/review`, {
    method: "POST", session: admin.session, body: { action: "approve" },
  });
  assert.equal(response.status, 200);
  assert.equal(batches, 1, "one batch");
  assert.equal(statusOf(env, winner).status, "approved");
  assert.deepEqual({ ...statusOf(env, loser) }, { status: "rejected", review_note: "superseded" });
  assert.equal(statusOf(env, otherKey).status, "pending");

  const stale = seedSuggestion(env, { userId: c.id, value: "Ancien", hash: sha("old english") });
  const refused = await call(env, `/api/translate/suggestions/${stale}/review`, {
    method: "POST", session: admin.session, body: { action: "approve" },
  });
  assert.equal(refused.status, 409);
  assert.equal(await reasonOf(refused), "stale");
  const rejected = await call(env, `/api/translate/suggestions/${stale}/review`, {
    method: "POST", session: admin.session, body: { action: "reject", note: "old" },
  });
  assert.equal(rejected.status, 200);
  assert.equal(statusOf(env, stale).status, "rejected");
});

test("withdraw: only the author's own pending row is deleted", async () => {
  const env = onEnv();
  const author = await member(env);
  const other = await member(env);
  const id = seedSuggestion(env, { userId: author.id });
  assert.equal((await call(env, `/api/translate/suggestions/${id}`, { method: "DELETE", session: other.session })).status, 404);
  assert.equal((await call(env, `/api/translate/suggestions/${id}`, { method: "DELETE", session: author.session })).status, 200);
  assert.equal(statusOf(env, id), undefined);
});

// ------------------------------------------------------------- export

const LOCALE_TEST_SHARE = 0.08;
function passesI18nChecks(table, english) {
  const enKeys = Object.keys(english).sort();
  assert.deepEqual(Object.keys(table).sort(), enKeys);
  let same = 0;
  for (const key of enKeys) {
    assert.equal(typeof table[key], "string", key);
    assert.ok(table[key].trim().length > 0, key);
    assert.deepEqual(placeholdersOf(table[key]), placeholdersOf(english[key]), key);
    if (table[key] === english[key]) same += 1;
  }
  assert.ok(same / enKeys.length <= LOCALE_TEST_SHARE);
}

test("export: merges approved rows in en key order, drops stale rows, writes the i18n format, no names", () => {
  assert.doesNotMatch(EXPORT_SQL, /user|username|credit/i);
  assert.match(EXPORT_SQL, /status = 'approved'/);
  const rows = [
    { id: 1, locale: "fr", msg_key: KEY, value: "Proposer une idée", source_hash: sha(en[KEY]) },
    { id: 2, locale: "fr", msg_key: KEY, value: "Proposer !", source_hash: sha(en[KEY]) },
    { id: 3, locale: "fr", msg_key: "translate.reject", value: "Périmé", source_hash: sha("old") },
    { id: 4, locale: "fr", msg_key: "translate.gone", value: "Clé retirée", source_hash: sha("x") },
    { id: 5, locale: "fr", msg_key: "translate.progress", value: "{done} sur {total}", source_hash: sha(en["translate.progress"]) },
    { id: 6, locale: "xx", msg_key: KEY, value: "Nope", source_hash: sha(en[KEY]) },
  ];
  const { tables, counts } = mergeApproved({ en, tables: new Map([["fr", fr]]), rows });
  const out = tables.get("fr");
  assert.equal(out[KEY], "Proposer !", "the newest approved row wins");
  assert.equal(out["translate.reject"], fr["translate.reject"], "stale row dropped");
  assert.equal(out["translate.progress"], fr["translate.progress"], "invalid row dropped");
  assert.ok(!("translate.gone" in out));
  assert.deepEqual(Object.keys(out), Object.keys(fr), "existing key order kept");
  assert.deepEqual(counts, { fr: 1 });
  passesI18nChecks(out, en);
  assert.equal(serializeTable(fr), read("public/locales/fr.json"), "byte-identical to the shipped format");
  const text = serializeTable(out);
  assert.ok(text.endsWith("}\n"));
  assert.equal(fr[KEY], readLocale("fr")[KEY], "input table not mutated");
});

// ------------------------------------------------------------- privacy

test("privacy: no ip/ua/timestamp columns; deleting a member cascades; old rejected rows prune on review", async () => {
  const migration = read("migrations/0096_translate.sql").replace(/--.*$/gm, "");
  assert.doesNotMatch(migration, /\b(ip|ip_hash|ua|user_agent)\b|_at\b/i);
  assert.match(migration, /user_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  const env = onEnv();
  env.__sqlite.exec("PRAGMA foreign_keys = ON");
  const gone = await member(env);
  seedSuggestion(env, { userId: gone.id });
  env.__sqlite.prepare("DELETE FROM users WHERE id = ?").run(gone.id);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM translate_suggestions WHERE user_id = ?").get(gone.id).n, 0);

  const author = await member(env);
  const old = seedSuggestion(env, { userId: author.id, key: "translate.title", value: "Vieux", status: "rejected",
    reviewedDay: today() - TRANSLATE_REJECTED_RETENTION_DAYS - 1 });
  const recent = seedSuggestion(env, { userId: author.id, key: "translate.intro", value: "Récent", status: "rejected",
    reviewedDay: today() - 5 });
  const fresh = seedSuggestion(env, { userId: author.id, value: "Proposer" });
  const admin = await staff(env);
  await call(env, `/api/translate/suggestions/${fresh}/review`, {
    method: "POST", session: admin.session, body: { action: "reject" },
  });
  assert.equal(statusOf(env, old), undefined);
  assert.equal(statusOf(env, recent).status, "rejected");
});

// ------------------------------------------------------------- strings

test("strings: translate.* keys form one contiguous block in every table, and the module keys exist", () => {
  for (const code of ["en", "fr", "ar", "zh-Hant", "sr-Latn"]) {
    const keys = Object.keys(readLocale(code));
    const indexes = keys.map((key, index) => (key.startsWith("translate.") ? index : -1)).filter((index) => index >= 0);
    assert.ok(indexes.length >= 40, code);
    assert.equal(indexes.at(-1) - indexes[0] + 1, indexes.length, code + " contiguous");
  }
  assert.ok("translate.nav" in en && "translate.moduleDesc" in en);
});

test("progress: done/total per locale from the shipped tables", async () => {
  const env = onEnv();
  const response = await call(env, "/api/translate/progress");
  assert.equal(response.status, 200);
  const { locales } = await response.json();
  const french = locales.find((locale) => locale.code === "fr");
  assert.equal(french.total, Object.keys(en).length);
  assert.ok(french.done > french.total * 0.9 && french.done <= french.total);
  assert.ok(!locales.some((locale) => locale.code === "en"));
});
