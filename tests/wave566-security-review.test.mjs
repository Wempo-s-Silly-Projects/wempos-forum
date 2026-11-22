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

// v5.66.0 security review of v5.62-v5.65: regression pins for the social-link
// surface across ALL profile socials (not only the 17 added in v5.65), the
// editor's HTML pattern attributes, the PATCH /api/me gates, the bind budget
// and the best-effort reply bump's try scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnv } from "./helpers/d1.mjs";
import { ORIGIN, call, forgeSession, seedUser } from "./helpers/seed.mjs";
import worker from "../worker.mjs";
import { D1_MAX_BOUND_PARAMS } from "../constants.mjs";
import { SOCIAL_PLATFORMS, normalizeSocialHandle } from "../api/core/shapers.mjs";
import {
  SOCIAL_PATTERNS,
  buildSocialLinks,
  socialInputPattern,
} from "../public/js/profile-editor.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const KEYS = SOCIAL_PLATFORMS.map((platform) => platform.key);

// One valid handle per platform (every key the server knows).
const VALID = {
  youtube: "Wempo.Tube-1", x: "wempo_x", reddit: "wempo-r", github: "octo-cat", discord: "wempo#1234",
  gitlab: "wempo.lab", instagram: "wempo.gram", tiktok: "wempo.tok", twitch: "wempo_tv",
  facebook: "zuck.page", tumblr: "staff-blog", indiegogo: "my-cool-gadget", shopify: "my-shop",
  substack: "wempo-news", kickstarter: "wempo_games", cameo: "some.star", linktree: "wempo.links",
  beacons: "wempo_b", soundcloud: "wempo-sc", spotify: "0OdUWJ0sBjDrqHygGUXeCF", patreon: "wempo-p",
  kofi: "wempo_k", buymeacoffee: "wempo_", paypal: "WempoPay", cashapp: "Wempo_1", venmo: "Wempo-V",
  polytoria: "wempo_poly",
};

// Hostile inputs every platform must refuse: URLs, script schemes, whitespace
// (incl. a trailing newline a non-anchored "$" would let through), percent
// escapes, path tricks and Unicode lookalikes (Cyrillic a, fullwidth a, ZWSP).
const HOSTILE = [
  "javascript:alert(1)", "https://evil.example/x", "//evil.example", "a b", " wempo", "wempo\n",
  "x\ty", "%2Fevil", "a/b", "a?b", "a@b", "аbcde", "ａbcde", "wem​po",
];

test("every server regex is anchored, flag-free and ASCII-only", () => {
  for (const { key, regex } of SOCIAL_PLATFORMS) {
    assert.ok(regex.source.startsWith("^") && regex.source.endsWith("$"), key);
    assert.equal(regex.flags, "", key + " carries no flags (no m/i/u/s)");
    assert.doesNotMatch(regex.source, /\\[sSwWdDpP]|\\u|\\x|\[\^/, key + " uses explicit ASCII classes only");
    assert.equal(regex.test(VALID[key]), true, key + " accepts its sample");
    for (const bad of HOSTILE) assert.equal(regex.test(bad), false, key + " refuses " + JSON.stringify(bad));
  }
});

test("normalizeSocialHandle strips exactly one leading $ and only for cashapp", () => {
  assert.equal(normalizeSocialHandle("cashapp", "$Wempo"), "Wempo");
  assert.equal(normalizeSocialHandle("cashapp", "$$Wempo"), "$Wempo");
  assert.equal(normalizeSocialHandle("cashapp", "Wem$po"), "Wem$po");
  for (const key of KEYS.filter((k) => k !== "cashapp")) assert.equal(normalizeSocialHandle(key, "$abcde"), "$abcde", key);
  assert.equal(normalizeSocialHandle("cashapp", 42), 42);
  assert.equal(normalizeSocialHandle("cashapp", null), null);
});

test("editor pattern attributes compile under the HTML v flag and agree with the server", () => {
  // Browsers compile the pattern attribute as new RegExp(`^(?:${p})$`, "v");
  // an invalid pattern is silently ignored, switching the hint off.
  for (const { key, regex } of SOCIAL_PLATFORMS) {
    const source = socialInputPattern(key);
    let compiled;
    assert.doesNotThrow(() => { compiled = new RegExp(`^(?:${source})$`, "v"); }, key + ": " + source);
    assert.equal(compiled.test(VALID[key]), true, key);
    if (key === "cashapp") assert.equal(compiled.test("$" + VALID[key]), true, "cashapp accepts a pasted $");
    for (const bad of HOSTILE) assert.equal(compiled.test(bad), regex.test(bad), key + " " + JSON.stringify(bad));
  }
});

test("link building: fixed https host per platform; hostile stored values never become an href", () => {
  for (const key of KEYS) {
    const [valid] = buildSocialLinks({ [key]: VALID[key] }, null).filter((link) => link.key === key);
    if (valid.url !== undefined) {
      const url = new URL(valid.url);
      assert.equal(url.protocol, "https:", key);
      assert.equal(url.username + url.password, "", key + " has no credentials part");
      assert.ok(SOCIAL_PATTERNS[key].test(valid.text), key);
      // The handle can only sit in the subdomain label or the path, never steer the host.
      const host = url.hostname.toLowerCase();
      const label = VALID[key].toLowerCase();
      assert.ok(!host.includes(label) || host.startsWith(label + "."), key + " host " + host);
    }
    for (const bad of HOSTILE) {
      const links = buildSocialLinks({ [key]: bad }, null).filter((link) => link.key === key);
      for (const link of links) assert.equal(link.url, undefined, key + " " + JSON.stringify(bad));
    }
  }
});

test("profile editor/renderer source has no innerHTML or insertAdjacentHTML sink", () => {
  for (const path of ["public/js/profile-editor.js", "public/js/routes/profile.js"]) {
    const code = read(path).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.write\(/, path);
  }
});

// ---- server ---------------------------------------------------------------

async function world() {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = await seedUser(db, { username: "alice" });
  return { env, db, id, session: forgeSession(db, id) };
}
const socialRow = (w) =>
  w.db.prepare("SELECT " + SOCIAL_PLATFORMS.map((p) => p.column).join(", ") + " FROM users WHERE id = ?").get(w.id);

test("cross-route pin: PATCH /api/me refuses every hostile value for every social key; nothing is written", async () => {
  const w = await world();
  for (const key of KEYS) {
    for (const bad of HOSTILE) {
      const res = await call(w.env, "/api/me", { method: "PATCH", body: { socials: { [key]: bad } }, session: w.session });
      assert.equal(res.status, 400, key + " " + JSON.stringify(bad));
      const text = await res.text();
      // The error names the platform, never echoes the member's input or SQL.
      assert.ok(!text.includes(JSON.stringify(bad).slice(1, -1)), key + " echoes input: " + text);
      assert.doesNotMatch(text, /SQLITE|UPDATE users|\n\s+at \S/i);
    }
  }
  for (const value of Object.values(socialRow(w))) assert.equal(value, null);
});

test("column names come from SOCIAL_PLATFORMS only: unknown or column-shaped keys are refused", async () => {
  const w = await world();
  for (const key of ["__proto__", "constructor", "social_youtube", "bio", "role", "youtube = 'x', role", "YouTube"]) {
    const body = JSON.parse(`{"socials":{${JSON.stringify(key)}:"wempo"}}`);
    const res = await call(w.env, "/api/me", { method: "PATCH", body, session: w.session });
    assert.equal(res.status, 400, key);
  }
  assert.equal(w.db.prepare("SELECT role FROM users WHERE id = ?").get(w.id).role, "member");
});

test("PATCH /api/me keeps the same-origin and CSRF gates for socials", async () => {
  const w = await world();
  const send = (headers) => worker.fetch(new Request(ORIGIN + "/api/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: w.session.cookie, ...headers },
    body: JSON.stringify({ socials: { github: "octo" } }),
  }), w.env, { waitUntil() {} });
  assert.equal((await send({ Origin: "https://evil.example", "X-CSRF-Token": w.session.csrf })).status, 403);
  assert.equal((await send({ Origin: ORIGIN })).status, 403);
  assert.equal((await send({ "X-CSRF-Token": w.session.csrf })).status, 403);
  assert.equal(socialRow(w).social_github, null);
  assert.equal((await send({ Origin: ORIGIN, "X-CSRF-Token": w.session.csrf })).status, 200);
  assert.equal(socialRow(w).social_github, "octo");
});

test("a full PATCH (every social + every profile field) stays under the bind budget", async () => {
  // UPDATE binds: one per social + bio, accent, banner color, banner text,
  // flair + the three WHERE binds (id, ban user id, now).
  const worst = SOCIAL_PLATFORMS.length + 5 + 3;
  assert.ok(worst < D1_MAX_BOUND_PARAMS, String(worst));
  const w = await world();
  const res = await call(w.env, "/api/me", {
    method: "PATCH",
    body: { bio: "hi", socials: { ...VALID }, profileAccent: "#4d8fc4", bannerColor: "#4d8fc4", bannerText: "b", flair: "f" },
    session: w.session,
  });
  assert.equal(res.status, 200, await res.clone().text());
  const row = socialRow(w);
  for (const { key, column } of SOCIAL_PLATFORMS) assert.equal(row[column], VALID[key], key);
});

test("every social column refuses a 121-char value at the database (0002 + 0077 CHECKs)", async () => {
  const w = await world();
  for (const { column } of SOCIAL_PLATFORMS) {
    assert.throws(() => w.db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run("a".repeat(121), w.id), /CHECK/, column);
  }
});

test("best-effort bump: the try block wraps only the bump, never the reply INSERT", () => {
  const source = read("api/posts-write.mjs");
  const fn = source.slice(source.indexOf("export async function bumpThreadForReply"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
  const tryBlock = body.slice(body.indexOf("try {"), body.indexOf("} catch"));
  assert.match(tryBlock, /REPLY_BUMP_SQL/);
  assert.doesNotMatch(tryBlock, /INSERT|batch\(/);
  assert.match(body, /console\.error\(/, "a failed bump is logged");
  for (const path of ["api/replies.mjs", "api/mcp.mjs"]) {
    const src = read(path);
    assert.ok(src.includes("THREAD_REPLY_INSERT_SQL"), path);
    assert.doesNotMatch(src, /try\s*\{[^}]*THREAD_REPLY_INSERT_SQL[^}]*\}\s*catch\s*\([^)]*\)\s*\{\s*console\./, path);
  }
});
