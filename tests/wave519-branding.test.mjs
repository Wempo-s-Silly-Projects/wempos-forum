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

// Self-hosting part 2 (v5.19.0): instance branding. The forum's name, tagline
// and footer live in site_settings (site_name / site_tagline / site_footer),
// edited by staff on the admin desk. With no row the owner's forum renders
// exactly today's copy; locale strings name the site through {siteName}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedUser } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import {
  BRANDING_DEFAULTS, BRANDING_LIMITS, readBranding,
} from "../api/branding.mjs";
import {
  DEFAULT_SITE_NAME, LOCALES, createTranslator, readBrand, translateStatic,
} from "../public/js/i18n.js";

const ROOT = new URL("../", import.meta.url);
const LOCALE_DIR = new URL("public/locales/", ROOT);
const readLocale = (code) => JSON.parse(readFileSync(new URL(`${code}.json`, LOCALE_DIR), "utf8"));
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");
const en = readLocale("en");

const TODAY = {
  name: "Wempo's Forum",
  tagline: "Have fun and meet new people!",
  footer: "Made by ItsWempo. Be chill, be kind, and have fun :3",
};
const MAPLE = { name: "Maple Commons", tagline: "Pancakes for everyone", footer: "Run by the Maple crew" };

async function signedIn(env, role) {
  const id = await seedUser(env.__sqlite, { username: "U" + role + Math.floor(Math.random() * 1e6), role, password: role === "member" ? "correct horse battery" : null });
  return { id, session: forgeSession(env.__sqlite, id) };
}

const owner = (env) => signedIn(env, "admin"); // stored 'admin' = public owner
const saveBranding = (env, session, body) =>
  call(env, "/api/admin/branding", { method: "POST", session, body });
const shellHtml = async (env) =>
  (await worker.fetch(new Request("https://wempos-forum.com/"), env, {})).text();

// ---- defaults: the owner's forum with no settings row ----------------------

test("defaults equal today's owner copy", () => {
  assert.deepEqual({ ...BRANDING_DEFAULTS }, TODAY);
  assert.equal(DEFAULT_SITE_NAME, TODAY.name);
});

test("no settings row: GET /api/branding answers today's copy and the shell gains no brand meta", async () => {
  const env = makeEnv();
  const data = await (await call(env, "/api/branding")).json();
  assert.deepEqual({ name: data.name, tagline: data.tagline, footer: data.footer }, TODAY);
  assert.deepEqual(await readBranding(env), TODAY);
  const html = await shellHtml(env);
  assert.doesNotMatch(html, /name="site-(name|tagline|footer)"/);
});

test("no settings row: every translated surface renders exactly today's English", () => {
  const { t } = createTranslator("en", en, en, readBrand(makeFakeDocument({ querySelector: () => null })));
  assert.equal(t("app.siteName"), "Wempo's Forum");
  assert.equal(t("shell.brand"), "Wempo's Forum");
  assert.equal(t("shell.brandHome"), "Wempo's Forum home");
  assert.equal(t("shell.tagline"), "Wempo's Forum: Have fun and meet new people!");
  assert.equal(t("feed.introTitle"), "Wempo's Forum: Have fun and meet new people!");
  assert.equal(t("shell.footer"), TODAY.footer);
  assert.equal(t("app.titleWithPage", { page: "Rules" }), "Rules · Wempo's Forum");
  assert.equal(t("auth.setupTitle"), "Set up Wempo's Forum:3");
});

test("no settings row: discovery and the 2FA issuer still say Wempo's Forum", async () => {
  const env = makeEnv();
  const md = await (await call(env, "/", { headers: { Accept: "text/markdown" } })).text();
  assert.match(md, /^# Wempo's Forum\n/);
  const openapi = await (await call(env, "/openapi.json")).json();
  assert.equal(openapi.info.title, "Wempo's Forum public read API");
  const member = await signedIn(env, "member");
  const setup = await (await call(env, "/api/me/totp/setup", {
    method: "POST", session: member.session, body: { currentPassword: "correct horse battery" },
  })).json();
  assert.match(setup.otpauth, /^otpauth:\/\/totp\/Wempo's%20Forum:.*&issuer=Wempo's%20Forum&/);
});

// ---- a set name flows everywhere --------------------------------------------

test("staff save: the name reaches the shell meta, discovery, openapi and the 2FA issuer", async () => {
  const env = makeEnv();
  const { session } = await owner(env);
  const response = await saveBranding(env, session, MAPLE);
  assert.equal(response.status, 200);
  assert.deepEqual(await readBranding(env), MAPLE);
  const html = await shellHtml(env);
  assert.ok(html.includes('<meta name="site-name" content="Maple Commons">'), html);
  assert.ok(html.includes('<meta name="site-tagline" content="Pancakes for everyone">'));
  assert.ok(html.includes('<meta name="site-footer" content="Run by the Maple crew">'));
  const md = await (await call(env, "/", { headers: { Accept: "text/markdown" } })).text();
  assert.match(md, /^# Maple Commons\n/);
  const board = await (await call(env, "/c/general", { headers: { Accept: "text/markdown" } })).text();
  assert.match(board, /^# Maple Commons — general/);
  const openapi = await (await call(env, "/openapi.json")).json();
  assert.equal(openapi.info.title, "Maple Commons public read API");
  const member = await signedIn(env, "member");
  const setup = await (await call(env, "/api/me/totp/setup", {
    method: "POST", session: member.session, body: { currentPassword: "correct horse battery" },
  })).json();
  assert.match(setup.otpauth, /^otpauth:\/\/totp\/Maple%20Commons:.*&issuer=Maple%20Commons&/);
});

test("the admin tier may save too; empty values reset to the defaults", async () => {
  const env = makeEnv();
  const admin = await signedIn(env, "moderator"); // stored 'moderator' = public admin
  assert.equal((await saveBranding(env, admin.session, MAPLE)).status, 200);
  assert.equal((await saveBranding(env, admin.session, { name: "", tagline: "", footer: "" })).status, 200);
  assert.deepEqual(await readBranding(env), TODAY);
  const rows = env.__sqlite.prepare("SELECT key FROM site_settings WHERE key LIKE 'site_%'").all();
  assert.equal(rows.length, 0);
  assert.doesNotMatch(await shellHtml(env), /name="site-name"/);
});

test("a set name and tagline paint through the translator and the static shell", () => {
  const brand = { siteName: "Maple Commons", tagline: "Pancakes for everyone", footer: "Run by the Maple crew" };
  const { t } = createTranslator("en", en, en, brand);
  assert.equal(t("app.siteName"), "Maple Commons");
  assert.equal(t("shell.brandHome"), "Maple Commons home");
  assert.equal(t("app.titleWithPage", { page: "Rules" }), "Rules · Maple Commons");
  assert.equal(t("shell.tagline"), "Maple Commons: Pancakes for everyone");
  assert.equal(t("feed.introTitle"), "Maple Commons: Pancakes for everyone");
  assert.equal(t("shell.footer"), "Run by the Maple crew");
  // A set name with no tagline/footer keeps the translated defaults.
  const nameOnly = createTranslator("en", en, en, { siteName: "Maple Commons" }).t;
  assert.equal(nameOnly("shell.tagline"), "Maple Commons: Have fun and meet new people!");
  assert.equal(nameOnly("shell.footer"), TODAY.footer);
});

test("readBrand reads the stamped metas by attribute", () => {
  const metas = {
    'meta[name="site-name"]': "Maple Commons",
    'meta[name="site-tagline"]': "Pancakes for everyone",
    'meta[name="site-footer"]': "Run by the Maple crew",
  };
  const doc = makeFakeDocument({
    querySelector: (selector) => {
      if (!(selector in metas)) return null;
      const node = new FakeNode("meta");
      node.setAttribute("content", metas[selector]);
      return node;
    },
  });
  assert.deepEqual(readBrand(doc), { siteName: "Maple Commons", tagline: "Pancakes for everyone", footer: "Run by the Maple crew" });
  assert.deepEqual(readBrand(makeFakeDocument({ querySelector: () => null })), { siteName: DEFAULT_SITE_NAME, tagline: "", footer: "" });
});

// ---- the write gate -----------------------------------------------------------

test("non-staff writes are refused: member 403, signed-out 401/403, no CSRF 403", async () => {
  const env = makeEnv();
  const member = await signedIn(env, "member");
  assert.equal((await saveBranding(env, member.session, MAPLE)).status, 403);
  const anon = await call(env, "/api/admin/branding", { method: "POST", body: MAPLE });
  assert.ok([401, 403].includes(anon.status), String(anon.status));
  const { session } = await owner(env);
  const noCsrf = await worker.fetch(new Request("https://wempos-forum.com/api/admin/branding", {
    method: "POST",
    headers: { Cookie: session.cookie, Origin: "https://wempos-forum.com", "Content-Type": "application/json" },
    body: JSON.stringify(MAPLE),
  }), env, {});
  assert.equal(noCsrf.status, 403);
  assert.deepEqual(await readBranding(env), TODAY);
});

test("overlong or malformed values are a 400 and nothing is stored", async () => {
  const env = makeEnv();
  const { session } = await owner(env);
  for (const field of ["name", "tagline", "footer"]) {
    const body = { ...MAPLE, [field]: "x".repeat(BRANDING_LIMITS[field] + 1) };
    assert.equal((await saveBranding(env, session, body)).status, 400, field);
  }
  assert.equal((await saveBranding(env, session, { ...MAPLE, name: 42 })).status, 400);
  assert.equal((await saveBranding(env, session, { ...MAPLE, name: "two\nlines" })).status, 400);
  assert.equal((await saveBranding(env, session, { ...MAPLE, name: "x".repeat(BRANDING_LIMITS.name) })).status, 200);
  assert.equal((await readBranding(env)).name, "x".repeat(BRANDING_LIMITS.name));
});

test("the word filter covers branding like the rest of the site's copy", async () => {
  const env = makeEnv();
  env.__sqlite.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('filtered_words', 'brandbadword', ?)").run(now());
  const { session } = await owner(env);
  assert.equal((await saveBranding(env, session, { ...MAPLE, name: "The brandbadword Club" })).status, 200);
  assert.doesNotMatch((await readBranding(env)).name, /brandbadword/);
});

// ---- markup is text ---------------------------------------------------------

test("markup in the name is attribute-escaped in the meta and painted as text", async () => {
  const env = makeEnv();
  const { session } = await owner(env);
  const evil = "<img src=x onerror=alert(1)>\"&'";
  assert.equal((await saveBranding(env, session, { ...MAPLE, name: evil })).status, 200);
  const html = await shellHtml(env);
  assert.ok(html.includes('<meta name="site-name" content="&lt;img src=x onerror=alert(1)&gt;&quot;&amp;\'">'), html);
  assert.ok(!html.includes("<img src=x"), "raw markup must never reach the shell");
  // The client paints through textContent only.
  const { t } = createTranslator("en", en, en, { siteName: evil });
  const node = new FakeNode("span");
  node.dataset.i18n = "shell.brand";
  const root = { querySelectorAll: (selector) => (selector === "[data-i18n]" ? [node] : []) };
  assert.equal(t("shell.brand"), evil);
  translateStatic(root);
  assert.equal(typeof node.textContent, "string");
  const i18nSource = source("public/js/i18n.js");
  assert.doesNotMatch(i18nSource, /innerHTML|outerHTML|insertAdjacentHTML/);
});

// ---- locales -----------------------------------------------------------------

test("every locale: same keys as en.json, no hard-coded site name, every {siteName} string resolves", () => {
  const enKeys = Object.keys(en).sort();
  const brandKeys = enKeys.filter((key) => en[key].includes("{siteName}"));
  assert.ok(brandKeys.length >= 7, `expected the branded strings to use {siteName}, got ${brandKeys.length}`);
  const files = readdirSync(LOCALE_DIR).filter((file) => file.endsWith(".json"));
  assert.equal(files.length, LOCALES.length);
  for (const { code } of LOCALES) {
    const table = readLocale(code);
    assert.deepEqual(Object.keys(table).sort(), enKeys, code);
    for (const [key, value] of Object.entries(table)) {
      assert.ok(!value.includes("Wempo's Forum"), `${code} ${key} still hard-codes the site name`);
    }
    const { t } = createTranslator(code, table, en, { siteName: "Maple Commons" });
    for (const key of brandKeys) {
      assert.ok(table[key].includes("{siteName}"), `${code} ${key} lacks {siteName}`);
      const painted = t(key, { page: "P" });
      assert.ok(painted.includes("Maple Commons"), `${code} ${key}: ${painted}`);
      assert.ok(!painted.includes("{siteName}"), `${code} ${key} left the placeholder`);
    }
    const defaults = createTranslator(code, table, en, {}).t;
    for (const key of brandKeys) assert.ok(defaults(key, { page: "P" }).includes("Wempo's Forum"), `${code} ${key}`);
  }
});

// ---- the desk ---------------------------------------------------------------

test("the admin desk has a branding section that saves through /api/admin/branding", () => {
  const admin = source("public/js/routes/admin.js");
  assert.match(admin, /slug: "branding"/);
  assert.match(admin, /"branding-save":/);
  const desk = source("public/js/desk/branding.js");
  assert.match(desk, /\/api\/admin\/branding/);
  assert.doesNotMatch(desk, /innerHTML|outerHTML|insertAdjacentHTML/);
});
