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

// Wave 5.33 — security review of v5.27.0..v5.31.0
// (docs/security-reviews/2026-11-21-v5.28-v5.31.md). RED-first fixes:
//   M1: String.prototype.replace with a STRING replacement expands $' $` $& $$
//       — member text in the per-page head (api/seo.mjs) and staff branding in
//       the shell stamp (worker.mjs) could splice the rest of the shell into a
//       content="..." attribute. Fixed with function replacements.
//   L1: the admin guide did not say how to revoke a leaked AUTOMOD_KEY.
// Plus pins for the checks that passed (referrer host parsing, AutoMod key
// compare, ban cap).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call, seedPost, seedUser } from "./helpers/seed.mjs";
import { AUTOMOD_MAX_BAN_HOURS } from "../api/automod.mjs";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");
const SHELL = source("public/index.html");
const shellAssets = () => makeAssets(() => new Response(SHELL, {
  status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
}));
const seoEnv = (overrides = {}) => makeEnv({ ASSETS: shellAssets(), SITE_ORIGIN: "https://forum.example", ...overrides });
const decode = (value) => value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const count = (text, needle) => text.split(needle).length - 1;
const metaContent = (html, attr, key) => {
  const tag = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`));
  return tag ? decode(tag[1]) : null;
};
const DOLLARS = "Price $' and $` and $& and $$ end";

// ---- M1: replacement-pattern splice ---------------------------------------

test("M1: $-patterns in a thread's first line stay literal in the head", async () => {
  const env = seoEnv();
  const authorId = await seedUser(env.__sqlite, { username: "dollar1" });
  const postId = seedPost(env.__sqlite, { authorId, body: DOLLARS, board: "general", visibility: "public" });
  const html = await (await call(env, `/posts/${postId}`)).text();
  assert.equal(count(html, "</head>"), 1, "the shell's </head> is not duplicated");
  assert.equal(count(html, "<body"), count(SHELL, "<body"), "the shell body is not spliced into the head");
  const head = html.slice(0, html.indexOf("</head>"));
  const title = head.match(/<title>([^<]*)<\/title>/);
  assert.ok(title, "one title");
  assert.equal(decode(title[1]), DOLLARS + " — Wempo's Forum");
  // v5.96.0 B2: a title-only body gets the fallback sentence, still literal.
  assert.equal(metaContent(head, "name", "description"), DOLLARS + " — a discussion in General on Wempo's Forum");
  assert.equal(metaContent(head, "property", "og:title"), DOLLARS + " — Wempo's Forum");
  // v5.96.0 B1: the body <h1> uses a function replacer too.
  const h1 = html.match(/<h1 class="server-thread-title">([^<]*)<\/h1>/);
  assert.ok(h1, "server thread title present");
  assert.equal(decode(h1[1]), DOLLARS);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(ld.find((block) => block["@type"] === "DiscussionForumPosting").headline, DOLLARS);
});

test("M1: $-patterns in saved branding stay literal in the shell stamp and head", async () => {
  const env = seoEnv();
  env.__sqlite.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('site_name', ?, 1)").run("Club $' $&");
  const html = await (await call(env, "/")).text();
  assert.equal(count(html, "</head>"), 1);
  assert.equal(count(html, "<body"), count(SHELL, "<body"));
  assert.equal(metaContent(html, "name", "site-name"), "Club $' $&");
  assert.equal(metaContent(html, "property", "og:site_name"), "Club $' $&");
});

test("M1: both head insertions use a function replacement (source pin)", () => {
  assert.match(source("api/seo.mjs"), /\.replace\("<\/head>", \(\) => /);
  assert.match(source("worker.mjs"), /\.replace\("<\/head>", \(\) => /);
  assert.doesNotMatch(source("api/seo.mjs"), /\.replace\("<\/head>", [a-z]/);
  assert.doesNotMatch(source("worker.mjs"), /\.replace\("<\/head>", [a-z]/);
});

// ---- L1: leaked AutoMod key revocation is documented ----------------------

test("L1: the admin guide says how to revoke a leaked AUTOMOD_KEY", () => {
  const guide = source("docs/admin-guide.md");
  const section = guide.slice(guide.indexOf("## AutoMod API"), guide.indexOf("## What a hide or ban does"));
  assert.match(section, /wrangler secret put AUTOMOD_KEY/);
  assert.match(section, /leak/i);
  assert.match(section, /wrangler secret delete AUTOMOD_KEY/);
  assert.match(section, /AUTOMOD_ENABLED/);
});

// ---- pins: analytics referrer host parsing --------------------------------

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
async function visit(env, referer) {
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  await worker.fetch(new Request("https://wempos-forum.com/", { headers: { "User-Agent": BROWSER, Referer: referer } }), env, ctx);
  await Promise.allSettled(pending);
}
const hosts = (env) => env.__sqlite.prepare("SELECT referrer_host FROM referrer_counts ORDER BY referrer_host").all()
  .map((row) => row.referrer_host);

test("referrer: IDN becomes punycode; port, userinfo, path dropped; IPv6, long, non-http dropped", async () => {
  const env = makeEnv({ ANALYTICS_ENABLED: "true" });
  await visit(env, "https://xn--bcher-kva.example/x");
  await visit(env, "https://user:pass@Mixed.Example:8443/secret?q=1");
  await visit(env, "http://[2001:db8::1]:8080/");
  await visit(env, "https://" + "a".repeat(60) + "." + "b".repeat(60) + "." + "c".repeat(60) + "." + "d".repeat(60) + "." + "e".repeat(60) + ".example/");
  await visit(env, "data:text/html,hi");
  await visit(env, "ftp://files.example/");
  const stored = hosts(env);
  assert.deepEqual(stored, ["mixed.example", "xn--bcher-kva.example"]);
  for (const host of stored) assert.match(host, /^[a-z0-9.-]{1,253}$/);
  assert.ok(!JSON.stringify(stored).includes("pass"));
});

test("referrer: a Unicode IDN host is normalised to punycode by the URL parser", async () => {
  const { referrerHost } = await import("../api/analytics.mjs");
  const request = new Request("https://wempos-forum.com/", { headers: { Referer: "https://bücher.example/x" } });
  assert.equal(referrerHost(request, new URL("https://wempos-forum.com/"), {}), "xn--bcher-kva.example");
});

// ---- pins: AutoMod key compare + ban cap ----------------------------------

test("AutoMod: key compared over SHA-256 digests with a full XOR sweep; bans clamp to 24h", () => {
  const code = source("api/automod.mjs");
  assert.match(code, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(code, /diff \|= a\[i\] \^ b\[i\]/);
  assert.doesNotMatch(code, /match\[1\] === |=== env\.AUTOMOD_KEY/);
  assert.equal(AUTOMOD_MAX_BAN_HOURS, 24);
  assert.match(code, /Math\.min\(Math\.floor\(hours\), AUTOMOD_MAX_BAN_HOURS\)/);
});

test("AutoMod: an over-long ban request is cut to 24h and staff are refused", async () => {
  const key = "fake-automod-key-for-tests-only-5330";
  const env = makeEnv({ AUTOMOD_KEY: key, AUTOMOD_ENABLED: "true" });
  const memberId = await seedUser(env.__sqlite, { username: "target1" });
  const staffId = await seedUser(env.__sqlite, { username: "staff1", role: "admin" });
  const act = (id) => call(env, "/api/automod/action", {
    method: "POST",
    body: { type: "profile", id, action: "ban", reason: "spam", ban_hours: 10000 },
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
  });
  const res = await act(memberId);
  assert.equal(res.status, 200);
  const ban = env.__sqlite.prepare("SELECT created_at, expires_at FROM bans WHERE user_id = ?").get(memberId);
  assert.ok(ban.expires_at - ban.created_at <= 24 * 3600);
  assert.equal((await act(staffId)).status, 403);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM bans WHERE user_id = ?").get(staffId).n, 0);
});
