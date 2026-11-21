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

// Wave 5.24 security review of v5.19.0..v5.23.0
// (docs/security-reviews/2026-11-21-v5.20-v5.23.md).
// S1: pronouns saved before a word joined the filter are masked on the
// profile at read time, the same as flair and banner text.
// Pins: TOTP algorithm can never move under a live or racing enrollment;
// export never carries 2FA secrets; pronouns markup round-trips as text;
// an unsafe SOURCE_URL never reaches the footer href; print keeps the
// source link; the new CI workflows stay read-only and pinned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedUser, sha256 } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { totpAt } from "../api/core/totp.mjs";
import { issueTotpChallenge } from "../api/twofa.mjs";
import { createPronouns } from "../public/js/profile-extras.js";
import { paintSourceLink } from "../public/js/source-link.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const PASSWORD = "correct horse battery";
const REPO = "https://github.com/Wempo-s-Silly-Projects/wempos-forum";

async function member(env, username = "alice") {
  const id = await seedUser(env.__sqlite, { username, password: PASSWORD });
  return { id, session: forgeSession(env.__sqlite, id) };
}

const post = (env, path, session, body) => call(env, path, { method: "POST", session, body });
const userRow = (env, id) =>
  env.__sqlite.prepare("SELECT totp_enabled, totp_secret, totp_pending_secret FROM users WHERE id = ?").get(id);
const algorithmOf = (env, id) =>
  env.__sqlite.prepare("SELECT algorithm FROM totp_algorithms WHERE user_id = ?").get(id)?.algorithm;

// Runs `sideEffect` right after the first() of the statement whose SQL starts
// with `prefix` — a concurrent request committing between a handler's read
// and its write.
function afterRead(env, prefix, sideEffect) {
  const realDb = env.FORUM_DB;
  const racing = Object.create(realDb);
  let fired = false;
  racing.prepare = (sql) => {
    const statement = realDb.prepare(sql);
    if (fired || !sql.startsWith(prefix)) return statement;
    return {
      bind: (...values) => {
        const bound = statement.bind(...values);
        return {
          first: async (column) => {
            const row = await bound.first(column);
            fired = true;
            sideEffect();
            return row;
          },
        };
      },
    };
  };
  env.FORUM_DB = racing;
  return () => { env.FORUM_DB = realDb; };
}

async function loginStep(env, userId, code) {
  const guestToken = "g".repeat(44);
  env.__sqlite.prepare(
    "INSERT OR IGNORE INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)",
  ).run(sha256(guestToken), "guestcsrf", now(), now() + 3600);
  const challenge = await issueTotpChallenge(env.FORUM_DB, userId);
  return post(env, "/api/auth/totp", { cookie: "__Host-wempo_session=" + guestToken, csrf: "guestcsrf" },
    { challenge, code });
}

// ---- S1: pronouns re-filtered at read ---------------------------------------

test("S1: pronouns saved before a word joined the filter are masked on the profile", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const saved = await call(env, "/api/me/pronouns", {
    method: "PUT", body: { pronouns: "badword/her" }, session: alice.session,
  });
  assert.equal(saved.status, 200);
  env.__sqlite.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('filtered_words', 'badword', ?)")
    .run(now());
  const profile = await (await call(env, "/api/users/alice")).json();
  assert.equal(typeof profile.pronouns, "string");
  assert.doesNotMatch(profile.pronouns, /badword/i);
  assert.match(profile.pronouns, /\/her$/);
});

// ---- TOTP: the algorithm never moves under a live or racing enrollment ------

test("pin: a confirm racing a re-run setup is refused and never promotes the old secret", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const first = await (await post(env, "/api/me/totp/setup", alice.session,
    { currentPassword: PASSWORD, algorithm: "SHA256" })).json();
  const code = await totpAt(first.secret, now(), 6, "SHA256");
  // Another tab re-runs setup (new secret, SHA1) right after confirm's read.
  const restore = afterRead(env, "SELECT u.totp_pending_secret", () => {
    env.__sqlite.prepare("UPDATE users SET totp_pending_secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' WHERE id = ?")
      .run(alice.id);
    env.__sqlite.prepare("UPDATE totp_algorithms SET algorithm = 'SHA1' WHERE user_id = ?").run(alice.id);
  });
  const res = await post(env, "/api/me/totp/confirm", alice.session, { code });
  restore();
  assert.equal(res.status, 409);
  const row = userRow(env, alice.id);
  assert.equal(Number(row.totp_enabled), 0);
  assert.equal(row.totp_secret, null);
  assert.equal(algorithmOf(env, alice.id), "SHA1");
});

test("pin: a setup racing a completed confirm cannot rewrite the live algorithm", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const first = await (await post(env, "/api/me/totp/setup", alice.session,
    { currentPassword: PASSWORD, algorithm: "SHA256" })).json();
  // A second setup (SHA1) passes its password/enabled read, then the first
  // tab's confirm commits before the second setup writes.
  const restore = afterRead(env, "SELECT totp_enabled, totp_secret, password_salt", () => {
    env.__sqlite.prepare(
      "UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = 1 WHERE id = ?",
    ).run(alice.id);
  });
  await post(env, "/api/me/totp/setup", alice.session, { currentPassword: PASSWORD, algorithm: "SHA1" });
  restore();
  assert.equal(Number(userRow(env, alice.id).totp_enabled), 1);
  assert.equal(userRow(env, alice.id).totp_secret, first.secret);
  assert.equal(algorithmOf(env, alice.id), "SHA256");
  // The live enrollment still signs in with its own algorithm, and only it.
  assert.equal((await loginStep(env, alice.id, await totpAt(first.secret, now(), 6, "SHA1"))).status, 401);
  assert.equal((await loginStep(env, alice.id, await totpAt(first.secret, now(), 6, "SHA256"))).status, 200);
});

test("pin: an algorithm in the setup body is refused while 2FA is on (409, row unchanged)", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const first = await (await post(env, "/api/me/totp/setup", alice.session, { currentPassword: PASSWORD })).json();
  await post(env, "/api/me/totp/confirm", alice.session, { code: await totpAt(first.secret, now(), 6) });
  const res = await post(env, "/api/me/totp/setup", alice.session, { currentPassword: PASSWORD, algorithm: "SHA256" });
  assert.equal(res.status, 409);
  assert.equal(algorithmOf(env, alice.id), "SHA1");
});

// ---- export never leaks 2FA secrets -------------------------------------------

test("pin: Download my data carries no TOTP secret, pending secret or backup-code hash", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const first = await (await post(env, "/api/me/totp/setup", alice.session,
    { currentPassword: PASSWORD, algorithm: "SHA256" })).json();
  await post(env, "/api/me/totp/confirm", alice.session, { code: await totpAt(first.secret, now(), 6, "SHA256") });
  env.__sqlite.prepare("UPDATE users SET totp_pending_secret = 'PENDINGSECRETPENDINGSECRET234567' WHERE id = ?")
    .run(alice.id);
  const hashes = env.__sqlite.prepare("SELECT * FROM totp_backup_codes WHERE user_id = ?").all(alice.id)
    .flatMap((row) => Object.values(row).filter((value) => typeof value === "string" && value.length >= 16));
  const text = await (await call(env, "/api/me/export", { session: alice.session })).text();
  assert.equal(JSON.parse(text).settings.twoFactorAlgorithm, "SHA256");
  assert.ok(!text.includes(first.secret));
  assert.ok(!text.includes("PENDINGSECRETPENDINGSECRET234567"));
  for (const hash of hashes) assert.ok(!text.includes(hash));
  assert.doesNotMatch(text, /"[^"]*secret[^"]*"\s*:/i);
});

// ---- pronouns markup round-trips as text --------------------------------------

test("pin: a pronouns XSS string is refused by the route; a stored one renders as text only", async () => {
  const env = makeEnv();
  const alice = await member(env);
  const attack = "<img src=x onerror=alert(1)>";
  const res = await call(env, "/api/me/pronouns", { method: "PUT", body: { pronouns: attack }, session: alice.session });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "pronouns_invalid");
  // A row written around the route (the table only checks length) is still
  // served as a JSON string and painted with textContent.
  const stored = "<svg onload=alert(1)>";
  env.__sqlite.prepare("INSERT INTO profile_pronouns (user_id, pronouns, updated_at) VALUES (?, ?, ?)")
    .run(alice.id, stored, now());
  const profile = await (await call(env, "/api/users/alice")).json();
  assert.equal(profile.pronouns, stored);
  const span = createPronouns(makeFakeDocument(), profile.pronouns);
  assert.equal(span.textContent, stored);
  assert.equal(span.children.length, 0);
});

// ---- SOURCE_URL: server stamp → client href -----------------------------------

function footerWithMeta(content) {
  const root = new FakeNode("html");
  const meta = new FakeNode("meta");
  meta.setAttribute("name", "source-url");
  meta.setAttribute("content", content);
  root.appendChild(meta);
  const link = new FakeNode("a");
  link.setAttribute("data-source-link", "");
  link.setAttribute("href", REPO);
  root.appendChild(link);
  return { doc: makeFakeDocument({ querySelector: (selector) => root.querySelector(selector) }), link };
}

test("pin: a javascript: or http: SOURCE_URL never becomes the footer href", async () => {
  for (const bad of ["javascript:alert(1)", "http://git.example.org/me/forum", "JaVaScRiPt:alert(1)"]) {
    const request = new Request("https://wempos-forum.com/", { headers: { Accept: "text/html" } });
    const html = await (await worker.fetch(request, makeEnv({ SOURCE_URL: bad, COMMIT_SHA: "abc1234" }), {})).text();
    const meta = /<meta name="source-url" content="([^"]*)">/.exec(html)?.[1];
    assert.equal(meta, REPO + "/tree/abc1234", bad);
    // Even a forged meta carrying the bad value is refused by the client.
    const { doc, link } = footerWithMeta(bad);
    paintSourceLink(doc);
    assert.equal(link.getAttribute("href"), REPO, bad);
  }
});

// ---- print keeps the AGPL §13 source link -------------------------------------

function printBlock(css) {
  const open = css.indexOf("{", css.search(/@media\s+print\b/));
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  return "";
}

test("pin: no print rule display:none's the footer, its paragraph, links or the source link", () => {
  const css = read("public/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = printBlock(css);
  assert.notEqual(block, "");
  const guarded = /^(footer|\.site-footer|\.site-footer p|a|\[data-source-link\]|\.site-footer \[data-source-link\]|\*)$/;
  for (const [, selectorText, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/display\s*:\s*none/.test(body)) continue;
    for (const selector of selectorText.split(",").map((part) => part.trim())) {
      assert.doesNotMatch(selector, guarded, selector + " hides the source link in print");
    }
  }
});

// ---- CI workflows added in 5.20–5.23 ------------------------------------------

test("pin: new CI workflows are read-only, never pull_request_target, every action SHA-pinned", () => {
  for (const file of ["zap-baseline.yml", "reuse.yml", "audit.yml", "gitleaks.yml", "semgrep.yml", "shellcheck.yml"]) {
    const yml = read(".github/workflows/" + file).replace(/^\s*#.*$/gm, "");
    assert.match(yml, /^permissions:\s*\n\s+contents:\s*read\s*$/m, file + " permissions");
    assert.doesNotMatch(yml, /:\s*write\b/, file + " grants a write scope");
    assert.doesNotMatch(yml, /pull_request_target/, file);
    for (const [, ref] of yml.matchAll(/uses:\s*(\S+)/g)) {
      assert.match(ref, /@[0-9a-f]{40}$/, file + ": " + ref);
    }
  }
});

test("pin: the ZAP job's local pepper is the public dummy and it reads no repository secret", () => {
  const yml = read(".github/workflows/zap-baseline.yml");
  assert.doesNotMatch(yml, /secrets\./);
  const peppers = [...yml.matchAll(/PASSWORD_PEPPER=([^'"\s]+)/g)].map((match) => match[1]);
  assert.deepEqual(peppers, ["ci-only-not-a-secret-pepper"]);
  assert.match(yml, /target:\s*http:\/\/localhost:8787/);
  assert.match(yml, /allow_issue_writing:\s*false/);
});
