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

// Owner order (Nov 22): HUMAN_CHECK picks the human/bot gate. Pins the one
// mode resolver (default anubis), each mode's behaviour (anubis: per-form
// ALTCHA skipped, HTML navigations through the anubisGate seam; altcha:
// Batch F unchanged; off: nothing), and the gate's exempt-path table.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, makeRequest } from "./helpers/seed.mjs";
import { DEFAULT_HUMAN_CHECK_MODE, HUMAN_CHECK_MODES, STATIC_HTML_PAGES } from "../constants.mjs";
import { humanCheckMode, requireHumanCheck } from "../api/core/human-check.mjs";
import { anubisGate, anubisGateApplies, isAnubisExemptPath } from "../api/core/anubis-gate.mjs";

const KEY = "altcha-test-hmac-key-0123456789abcdef";
const post = () => new Request("https://wempos-forum.com/api/posts", { method: "POST" });
const nav = (path, init = {}) => new Request("https://wempos-forum.com" + path, {
  method: "GET", headers: { Accept: "text/html,application/xhtml+xml" }, ...init,
});
const shell = async (env) =>
  (await worker.fetch(makeRequest("/", { headers: { Accept: "text/html" } }), env, {})).text();

test("modes live in constants.mjs; the default is anubis", () => {
  assert.deepEqual({ ...HUMAN_CHECK_MODES }, { ANUBIS: "anubis", ALTCHA: "altcha", OFF: "off" });
  assert.ok(Object.isFrozen(HUMAN_CHECK_MODES));
  assert.equal(DEFAULT_HUMAN_CHECK_MODE, "anubis");
});

test("humanCheckMode: unset, empty or unknown is anubis; values are trimmed and case-folded", () => {
  assert.equal(humanCheckMode({}), "anubis");
  assert.equal(humanCheckMode(undefined), "anubis");
  assert.equal(humanCheckMode({ HUMAN_CHECK: "" }), "anubis");
  assert.equal(humanCheckMode({ HUMAN_CHECK: "turnstile" }), "anubis");
  assert.equal(humanCheckMode({ HUMAN_CHECK: 7 }), "anubis");
  assert.equal(humanCheckMode({ HUMAN_CHECK: "anubis" }), "anubis");
  assert.equal(humanCheckMode({ HUMAN_CHECK: " ALTCHA " }), "altcha");
  assert.equal(humanCheckMode({ HUMAN_CHECK: "Off" }), "off");
});

test("anubis mode (default): a configured ALTCHA key asks for no per-form proof", async () => {
  for (const extra of [{}, { HUMAN_CHECK: "anubis" }]) {
    const env = makeEnv({ ALTCHA_HMAC_KEY: KEY, ...extra });
    await requireHumanCheck(post(), env, {});
    assert.equal((await call(env, "/api/altcha/challenge")).status, 404);
    assert.doesNotMatch(await shell(env), /name="human-check"/);
  }
});

test("anubis mode: HTML navigations still reach the shell while no container is bound", async () => {
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY });
  const res = await worker.fetch(makeRequest("/", { headers: { Accept: "text/html" } }), env, {});
  assert.equal(res.status, 200);
  assert.match(await res.text(), /shell/);
});

test("altcha mode: today's Batch F behaviour, unchanged", async () => {
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY, HUMAN_CHECK: "altcha" });
  await assert.rejects(requireHumanCheck(post(), env, {}),
    (error) => error.status === 403 && /Human verification is required/.test(error.message));
  assert.equal((await call(env, "/api/altcha/challenge")).status, 200);
  assert.match(await shell(env), /<meta name="human-check" content="altcha">/);
  const legacy = makeEnv({ TURNSTILE_SECRET: "legacy-owner-secret", HUMAN_CHECK: "altcha" });
  await assert.rejects(requireHumanCheck(post(), legacy, {}), (error) => error.status === 403);
  const keyless = makeEnv({ HUMAN_CHECK: "altcha" });
  await requireHumanCheck(post(), keyless, {});
  assert.doesNotMatch(await shell(keyless), /name="human-check"/);
});

test("off mode: no per-form proof, no challenge endpoint, no gate", async () => {
  let gateCalls = 0;
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY, HUMAN_CHECK: "off", ANUBIS: { fetch: () => { gateCalls += 1; } } });
  await requireHumanCheck(post(), env, {});
  assert.equal((await call(env, "/api/altcha/challenge")).status, 404);
  const html = await shell(env);
  assert.doesNotMatch(html, /name="human-check"/);
  assert.match(html, /shell/);
  assert.equal(gateCalls, 0);
});

const EXEMPT = [
  "/api/posts", "/api/", "/api/altcha/challenge",
  "/feed.xml", "/c/general/feed.xml", "/llms.txt",
  "/.well-known/api-catalog", "/.well-known/mcp/server-card.json",
  "/robots.txt", "/sitemap.xml", "/openapi.json", "/auth.md",
  "/mcp",
  "/.within.website/x/cmd/anubis/api/pass-challenge", "/.within.website/x/cmd/anubis/static/js/main.mjs",
  ...STATIC_HTML_PAGES, ...STATIC_HTML_PAGES.map((page) => page.replace(/\.html$/, "")),
  "/js/app.js", "/js/vendor/altcha-lib/v1/index.js", "/locales/en.json", "/icons/icon-192.png",
  "/styles.css", "/responsive.css", "/fun.css", "/sw.js", "/og-image.png", "/og-image.svg",
  "/favicon.ico", "/manifest.webmanifest", "/fonts/x.woff2",
];
const GATED = [
  "/", "/c/general", "/posts/12", "/users/Ann", "/week", "/settings", "/search",
  "/api", "/apiary", "/mcp/x", "/feed", "/c/general/feed", "/js", "/locales",
  "/.within.websitex/", "/offline.htmlx", "/robots.txt/x",
];

test("isAnubisExemptPath: the exempt table", () => {
  for (const path of EXEMPT) assert.equal(isAnubisExemptPath(path), true, path);
  for (const path of GATED) assert.equal(isAnubisExemptPath(path), false, path);
  for (const junk of [undefined, null, "", "relative", 42]) assert.equal(isAnubisExemptPath(junk), true, String(junk));
});

test("anubisGateApplies: only GET/HEAD HTML navigations to non-exempt paths", () => {
  assert.equal(anubisGateApplies(nav("/")), true);
  assert.equal(anubisGateApplies(nav("/posts/1", { method: "HEAD" })), true);
  assert.equal(anubisGateApplies(nav("/posts/1?x=1")), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(anubisGateApplies(nav("/", { method })), false, method);
  }
  assert.equal(anubisGateApplies(nav("/", { headers: { Accept: "application/json" } })), false);
  assert.equal(anubisGateApplies(nav("/", { headers: { Accept: "text/markdown" } })), false);
  assert.equal(anubisGateApplies(new Request("https://wempos-forum.com/")), false, "no Accept header");
  assert.equal(anubisGateApplies(nav("/api/posts")), false);
  assert.equal(anubisGateApplies(nav("/js/app.js")), false);
  assert.equal(anubisGateApplies(nav("/.within.website/x/cmd/anubis/api/pass-challenge")), false);
});

test("anubisGate: no ANUBIS binding passes through; a bound one is reserved (still null, untouched)", async () => {
  assert.equal(await anubisGate(nav("/"), {}), null);
  let touched = 0;
  const bound = { ANUBIS: { fetch: () => { touched += 1; return new Response("challenge"); } } };
  assert.equal(await anubisGate(nav("/"), bound), null);
  assert.equal(await anubisGate(nav("/api/posts"), bound), null);
  assert.equal(touched, 0);
});

test("production wrangler.toml pins ALTCHA while no ANUBIS binding exists", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const topVars = toml.split(/^\[vars\]$/m)[1].split(/^\[/m)[0];
  const pinned = (topVars.match(/^HUMAN_CHECK\s*=\s*"([^"]*)"/m) ?? [])[1];
  const anubisBound = /^\s*(binding|name)\s*=\s*"ANUBIS"/m.test(toml);
  if (!anubisBound) assert.equal(pinned, "altcha", "without the Anubis server, production must keep the ALTCHA check");
});
