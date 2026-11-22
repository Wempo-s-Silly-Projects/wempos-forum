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

// v5.23.0 F2: optional pronouns on profiles. Opt-in and empty by default (no
// row = no pronouns). PUT /api/me/pronouns is a signed-in, CSRF-checked,
// rate-limited write; the value is trimmed and must match
// ^[A-Za-z][A-Za-z /-]{0,23}$, and an empty value deletes the row. The
// profile payload carries them only where the profile itself is visible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedUser } from "./helpers/seed.mjs";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";
import { normalizePronouns, PRONOUNS_PATTERN } from "../api/pronouns.mjs";
import { createPronouns } from "../public/js/profile-extras.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const MIGRATION = "migrations/0062_profile_pronouns.sql";

async function member(env, username = "alice") {
  const id = await seedUser(env.__sqlite, { username });
  return { id, session: forgeSession(env.__sqlite, id) };
}

const putPronouns = (env, session, pronouns) =>
  call(env, "/api/me/pronouns", { method: "PUT", body: { pronouns }, session });

const pronounsRow = (env, userId) =>
  env.__sqlite.prepare("SELECT pronouns, updated_at FROM profile_pronouns WHERE user_id = ?").get(userId);

// ---- migration -----------------------------------------------------------

test("migration 0062 is CREATE-only and creates profile_pronouns", () => {
  const sql = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS profile_pronouns/);
  // The FK clause's own "ON DELETE CASCADE" is not a statement.
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  assert.match(sql, /CHECK \(length\(pronouns\) BETWEEN 1 AND 24\)/);
});

test("profile_pronouns rows are wiped with the account: users FK with ON DELETE CASCADE", () => {
  const env = makeEnv();
  const fks = env.__sqlite.prepare("PRAGMA foreign_key_list(profile_pronouns)").all();
  assert.equal(fks.length, 1);
  assert.equal(fks[0].table, "users");
  assert.equal(fks[0].from, "user_id");
  assert.equal(fks[0].on_delete, "CASCADE");
});

test("account deletion through /api/me/delete takes the pronouns row with it", async () => {
  const env = makeEnv();
  const alice = await member(env);
  await putPronouns(env, alice.session, "she/her");
  const response = await call(env, "/api/me/delete", { method: "POST", body: {}, session: alice.session });
  assert.equal(response.status, 200);
  assert.equal(pronounsRow(env, alice.id), undefined);
});

// ---- validation ----------------------------------------------------------

const ACCEPTED = [
  ["she/her", "she/her"],
  ["they/them", "they/them"],
  ["he / him", "he / him"],
  ["  xe/xem  ", "xe/xem"],
  ["Any", "Any"],
  ["e", "e"],
  ["ask-me", "ask-me"],
  ["A".repeat(24), "A".repeat(24)],
];
const REJECTED = [
  "1she", "/her", "-x", " /x", "she/her!", "<b>she</b>", "she\nher", "she\ther", "élle", "she_her",
  "A".repeat(25), "she.her", "she,her", "they/them😀", 5, true, {}, [],
];

test("normalizePronouns: the validation table", () => {
  for (const [input, expected] of ACCEPTED) assert.equal(normalizePronouns(input), expected, JSON.stringify(input));
  for (const input of REJECTED) assert.equal(normalizePronouns(input), null, JSON.stringify(input));
  assert.equal(normalizePronouns(""), "");
  assert.equal(normalizePronouns("   "), "");
  assert.equal(normalizePronouns(null), "");
  assert.equal(PRONOUNS_PATTERN.source, "^[A-Za-z][A-Za-z /-]{0,23}$");
});

test("PUT /api/me/pronouns stores every accepted value trimmed", async () => {
  const env = makeEnv();
  const alice = await member(env);
  for (const [input, expected] of ACCEPTED) {
    const response = await putPronouns(env, alice.session, input);
    assert.equal(response.status, 200, JSON.stringify(input));
    assert.deepEqual(await response.json(), { pronouns: expected });
    assert.equal(pronounsRow(env, alice.id).pronouns, expected);
  }
});

test("PUT /api/me/pronouns refuses every rejected value with a plain 400 and stores nothing", async () => {
  const env = makeEnv();
  const alice = await member(env);
  for (const input of REJECTED) {
    const response = await putPronouns(env, alice.session, input);
    assert.equal(response.status, 400, JSON.stringify(input));
    const body = await response.json();
    assert.equal(body.code, "pronouns_invalid");
    assert.equal(body.error, "Pronouns can use letters, spaces, / and - only, up to 24 characters.");
  }
  assert.equal(pronounsRow(env, alice.id), undefined);
});

test("an empty value deletes the row (opt back out)", async () => {
  const env = makeEnv();
  const alice = await member(env);
  await putPronouns(env, alice.session, "she/her");
  assert.equal(pronounsRow(env, alice.id).pronouns, "she/her");
  const response = await putPronouns(env, alice.session, "   ");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { pronouns: "" });
  assert.equal(pronounsRow(env, alice.id), undefined);
});

test("a filtered word is refused, not masked", async () => {
  const env = makeEnv();
  env.__sqlite.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('filtered_words', 'badword', ?)")
    .run(now());
  const alice = await member(env);
  const response = await putPronouns(env, alice.session, "badword/her");
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "pronouns_not_allowed");
  assert.equal(pronounsRow(env, alice.id), undefined);
});

// ---- auth, CSRF, bans, rate limit ------------------------------------------

test("anonymous writes are refused", async () => {
  const env = makeEnv();
  const response = await call(env, "/api/me/pronouns", {
    method: "PUT", body: { pronouns: "she/her" }, headers: { Origin: "https://wempos-forum.com" },
  });
  assert.ok([401, 403].includes(response.status), String(response.status));
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM profile_pronouns").get().n, 0);
});

test("a write without the CSRF token or from another origin is refused", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const noCsrf = await call(env, "/api/me/pronouns", {
    method: "PUT", body: { pronouns: "she/her" },
    headers: { Cookie: alice.session.cookie, Origin: "https://wempos-forum.com" },
  });
  assert.equal(noCsrf.status, 403);
  const crossOrigin = await call(env, "/api/me/pronouns", {
    method: "PUT", body: { pronouns: "she/her" },
    headers: { Cookie: alice.session.cookie, Origin: "https://evil.example", "X-CSRF-Token": alice.session.csrf },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(pronounsRow(env, alice.id), undefined);
});

test("a banned member cannot set pronouns", async () => {
  const env = makeEnv();
  const alice = await member(env);
  seedBan(env.__sqlite, alice.id);
  const response = await putPronouns(env, alice.session, "she/her");
  assert.equal(response.status, 403);
  assert.equal(pronounsRow(env, alice.id), undefined);
});

test("the write is rate-limited like other profile writes", async () => {
  const env = makeEnv(makeLimiters(false).bindings);
  const alice = await member(env);
  const response = await putPronouns(env, alice.session, "she/her");
  assert.equal(response.status, 429);
  assert.equal(pronounsRow(env, alice.id), undefined);
});

test("only PUT is answered", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const response = await call(env, "/api/me/pronouns", { method: "GET", session: alice.session });
  assert.ok(response.status === 404 || response.status === 405, String(response.status));
});

// ---- profile payload + visibility ------------------------------------------

test("the profile payload carries pronouns, and \"\" when none are set (opt-in)", async () => {
  const env = makeEnv();
  const alice = await member(env);
  await member(env, "bob");
  let profile = await (await call(env, "/api/users/bob")).json();
  assert.equal(profile.pronouns, "");
  await putPronouns(env, alice.session, "she/her");
  profile = await (await call(env, "/api/users/alice")).json();
  assert.equal(profile.pronouns, "she/her");
});

test("a block pair hides pronouns both ways (the unavailable payload carries none)", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const bob = await member(env, "bob");
  await putPronouns(env, alice.session, "she/her");
  env.__sqlite.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
    .run(alice.id, bob.id, now());
  const asBob = await (await call(env, "/api/users/alice", { session: bob.session })).json();
  assert.equal(asBob.unavailable, true);
  assert.equal(asBob.pronouns, undefined);
  assert.doesNotMatch(JSON.stringify(asBob), /she\/her/);
});

test("a banned member's pronouns follow the profile's existing rule (shown with the banner, like the bio)", async () => {
  const env = makeEnv();
  const alice = await member(env);
  await putPronouns(env, alice.session, "she/her");
  env.__sqlite.prepare("UPDATE users SET bio = 'hello' WHERE id = ?").run(alice.id);
  seedBan(env.__sqlite, alice.id);
  const asGuest = await (await call(env, "/api/users/alice")).json();
  assert.equal(asGuest.banned, true);
  assert.equal(asGuest.bio, "hello");
  assert.equal(asGuest.pronouns, "she/her");
});

// ---- export --------------------------------------------------------------

test("Download my data includes pronouns (null when none are set)", async () => {
  const env = makeEnv();
  const alice = await member(env);
  let data = await (await call(env, "/api/me/export", { session: alice.session })).json();
  assert.equal(data.profile.pronouns, null);
  await putPronouns(env, alice.session, "they/them");
  data = await (await call(env, "/api/me/export", { session: alice.session })).json();
  assert.equal(data.profile.pronouns, "they/them");
});

// ---- client --------------------------------------------------------------

test("createPronouns paints a textContent span, and nothing when empty", () => {
  const document = makeFakeDocument();
  assert.equal(createPronouns(document, ""), null);
  assert.equal(createPronouns(document, undefined), null);
  const span = createPronouns(document, "<b>she/her</b>");
  assert.equal(span.tagName.toLowerCase(), "span");
  assert.equal(span.className, "profile-pronouns");
  assert.equal(span.textContent, "<b>she/her</b>");
  assert.equal(span.children.length, 0);
});

test("the pronouns surfaces never use innerHTML", () => {
  for (const path of ["public/js/profile-extras.js", "public/js/profile-editor.js", "public/js/routes/profile.js", "api/pronouns.mjs"]) {
    const code = read(path).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML/, path);
  }
});

test("the profile header shows pronouns next to the name; the editor offers the optional field", () => {
  const route = read("public/js/routes/profile.js");
  assert.match(route, /createPronouns\(document, profile\.pronouns\)/);
  assert.match(route, /api\("\/api\/me\/pronouns", \{\s*method: "PUT"/);
  const editor = read("public/js/profile-editor.js");
  assert.match(editor, /name: "pronouns"/);
  assert.match(editor, /t\("profileEditor\.pronouns"\)/);
  assert.match(editor, /t\("profileEditor\.pronounsHelp"\)/);
});

test("the new strings exist in en and every locale", async () => {
  const { LOCALES } = await import("../public/js/i18n.js");
  const keys = ["profileEditor.pronouns", "profileEditor.pronounsHelp", "errors.pronounsInvalid", "errors.pronounsNotAllowed"];
  const english = JSON.parse(read("public/locales/en.json"));
  assert.equal(english["profileEditor.pronounsHelp"], "Optional. Letters, spaces, / and - only, up to 24 characters.");
  assert.equal(LOCALES.length, 45);
  for (const locale of LOCALES) {
    const code = typeof locale === "string" ? locale : locale.code;
    const table = JSON.parse(read(`public/locales/${code}.json`));
    for (const key of keys) assert.equal(typeof table[key], "string", `${code}: ${key}`);
  }
});
