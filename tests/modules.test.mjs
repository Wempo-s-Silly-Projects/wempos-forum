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

// Per-deployment modules (docs/modules.md): the registry, the resolution
// order (env hard-off > instance_modules row > default), dependencies, the
// router's 404 gate, the owner-only desk API, /api/site, the shell meta the
// browser reads, and a pin that every mapped feature keeps today's default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, makeRequest, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import {
  MODULES, MODULE_OFF, MODULE_ON, dependentsOf, isModuleOn, moduleEnvName, moduleForPath, resolveModules,
} from "../api/core/modules.mjs";
import { offSiteModules, siteModuleOn } from "../public/js/site-modules.js";
import { createModulesPanel } from "../public/js/desk/modules.js";
import { buildGraph, moduleEntries, modulePreloads } from "../scripts/import-graph.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const en = JSON.parse(read("public/locales/en.json"));

// The features this foundation maps, with today's default (wempos-forum.com).
const MAPPED = {
  "automod": MODULE_ON, "analytics": MODULE_ON, "web-vitals": MODULE_ON, "human-check": MODULE_ON,
  "chat": MODULE_ON, "polls": MODULE_ON, "wall": MODULE_ON, "fun": MODULE_ON,
  "saturday-fools": MODULE_ON, "link-previews": MODULE_ON, "embeds": MODULE_ON,
  // New modules ship off (the default-off rule); the owner turns them on.
  "search": MODULE_OFF,
};

const states = (env, rows = {}) => resolveModules(env, new Map(Object.entries(rows)));
const enabled = (env, rows) => Object.fromEntries([...states(env, rows)].map(([id, s]) => [id, s.enabled]));

// The production [vars] block of wrangler.toml, parsed (strings only).
function wranglerVars() {
  const text = read("wrangler.toml");
  const block = text.slice(text.indexOf("[vars]") + 6, text.indexOf("\n[", text.indexOf("[vars]")));
  return Object.fromEntries([...block.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
}

async function member(env, role = "member") {
  const id = await seedUser(env.__sqlite, { username: "m" + role + Math.floor(Math.random() * 1e9), role });
  return { id, session: forgeSession(env.__sqlite, id) };
}
const owner = (env) => member(env, "admin"); // stored 'admin' = public owner
const staff = (env) => member(env, "moderator"); // stored 'moderator' = public admin
const storeRow = (env, id, on) => env.__sqlite
  .prepare("INSERT INTO instance_modules (id, enabled, updated_at, updated_by) VALUES (?, ?, 1, NULL)")
  .run(id, on ? 1 : 0);
const putModule = (env, session, body) => call(env, "/api/admin/modules", { method: "PUT", session, body });

// ------------------------------------------------------------------ registry

test("registry: unique ids, known deps, no cycles, translated label + description keys", () => {
  const ids = MODULES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Object.isFrozen(MODULES));
  for (const module of MODULES) {
    assert.ok(Object.isFrozen(module), module.id);
    assert.match(module.id, /^[a-z][a-z0-9-]*$/);
    assert.ok([MODULE_ON, MODULE_OFF].includes(module.default), module.id);
    for (const dep of module.deps) assert.ok(ids.includes(dep), module.id + " -> " + dep);
    assert.ok(!dependentsOf(module.id).includes(module.id), module.id + " depends on itself");
    assert.ok(module.labelKey in en, module.labelKey);
    assert.ok(module.descriptionKey in en, module.descriptionKey);
  }
});

test("every mapped feature keeps today's default, and every new module is registered off", () => {
  assert.deepEqual(Object.fromEntries(MODULES.map((m) => [m.id, m.default])), MAPPED);
});

test("moduleEnvName upper-cases and swaps dashes", () => {
  assert.equal(moduleEnvName("link-previews"), "MODULE_LINK_PREVIEWS");
  assert.equal(moduleEnvName("chat"), "MODULE_CHAT");
});

test("each existing switch is wired: legacy env names and owned API paths", () => {
  const byId = Object.fromEntries(MODULES.map((m) => [m.id, m]));
  assert.equal(byId.automod.envKill, "AUTOMOD_ENABLED");
  assert.equal(byId.analytics.envKill, "ANALYTICS_ENABLED");
  assert.equal(byId["human-check"].envKill, "HUMAN_CHECK");
  assert.equal(byId["human-check"].readOnly, true);
  assert.equal(byId["saturday-fools"].envKill, "SATURDAY_FOOLS");
  assert.deepEqual([...byId["saturday-fools"].deps], ["fun"]);
  const owned = {
    "/api/automod/queue": "automod", "/api/automod": "automod", "/api/vitals": "web-vitals",
    "/api/chat": "chat", "/api/chat/12": "chat", "/api/dm/threads": "chat", "/api/dm/groups/3": "chat",
    "/api/posts/9/poll": "polls", "/api/users/4/wall": "wall", "/api/wall/7/pin": "wall",
    "/api/link-preview": "link-previews",
    "/api/search/full": "search", "/api/search/backfill": "search",
  };
  // The classic member + thread search is core: never gated by the module.
  assert.equal(moduleForPath("/api/search"), null);
  for (const [path, id] of Object.entries(owned)) assert.equal(moduleForPath(path), id, path);
  // Staff read-back of stored history stays reachable when a module is off.
  for (const path of ["/api/admin/automod", "/api/admin/analytics", "/api/admin/site-health", "/api/admin/chat",
    "/api/admin/dms", "/api/admin/dm-reports", "/api/posts/9", "/api/presence", "/api/site", "/api/admin/modules"]) {
    assert.equal(moduleForPath(path), null, path);
  }
});

// ------------------------------------------------------------ resolution order

test("production wrangler.toml vars resolve exactly today's behaviour", () => {
  const vars = { ...wranglerVars(), AUTOMOD_KEY: "runner-key" };
  assert.equal(vars.ANALYTICS_ENABLED, "true");
  assert.equal(vars.AUTOMOD_ENABLED, "true");
  const expected = { ...Object.fromEntries(Object.keys(MAPPED).map((id) => [id, true])) };
  // Saturday Fools is on only where SATURDAY_FOOLS = "on" (its own lane).
  expected["saturday-fools"] = vars.SATURDAY_FOOLS === "on";
  // New modules stay off until the owner turns them on from the desk.
  expected.search = false;
  assert.deepEqual(enabled(vars), expected);
});

test("a fresh self-hosted copy (no vars): opt-in modules stay off, the rest on", () => {
  assert.deepEqual(enabled({}), {
    "automod": false, "analytics": false, "web-vitals": true, "human-check": true, "chat": true,
    "polls": true, "wall": true, "fun": true, "saturday-fools": false, "link-previews": true, "embeds": true,
    "search": false,
  });
  const reasons = states({});
  // The search module needs its own SEARCH_DB binding, even when stored on.
  assert.equal(states({}, { search: true }).get("search").reason, "setup");
  assert.equal(states({ SEARCH_DB: {} }, { search: true }).get("search").enabled, true);
  assert.equal(reasons.get("automod").reason, "env");
  assert.equal(reasons.get("chat").reason, "default");
});

test("resolution: a D1 row overrides the default both ways", () => {
  assert.equal(enabled({}, { chat: false }).chat, false);
  assert.equal(states({}, { chat: false }).get("chat").reason, "stored");
  assert.equal(enabled({ ANALYTICS_ENABLED: "true" }, { analytics: true }).analytics, true);
});

test("resolution: env hard-off wins over a D1 row that says on", () => {
  assert.equal(enabled({ MODULE_CHAT: "off" }, { chat: true }).chat, false);
  assert.equal(states({ MODULE_CHAT: " OFF " }, { chat: true }).get("chat").reason, "env");
  assert.equal(enabled({ MODULE_LINK_PREVIEWS: "off" }, { "link-previews": true })["link-previews"], false);
  // Legacy switches: anything but the exact "on" value is a hard off.
  assert.equal(enabled({ ANALYTICS_ENABLED: "false" }, { analytics: true }).analytics, false);
  assert.equal(enabled({ AUTOMOD_ENABLED: "TRUE", AUTOMOD_KEY: "k" }, { automod: true }).automod, false);
  assert.equal(enabled({ SATURDAY_FOOLS: "off" }, { "saturday-fools": true })["saturday-fools"], false);
  // MODULE_<ID>=on never forces a module on over a stored off.
  assert.equal(enabled({ MODULE_CHAT: "on" }, { chat: false }).chat, false);
});

test("resolution: missing setup keeps AutoMod off even with the env and a row on", () => {
  const env = { AUTOMOD_ENABLED: "true" };
  assert.equal(states(env, { automod: true }).get("automod").reason, "setup");
  assert.equal(enabled({ ...env, AUTOMOD_KEY: "  " }).automod, false);
  assert.equal(enabled({ ...env, AUTOMOD_KEY: "k" }).automod, true);
  assert.equal(enabled({ ...env, AUTOMOD_KEY: "k" }, { automod: false }).automod, false);
});

test("human check is read-only: HUMAN_CHECK decides, a D1 row is ignored", () => {
  assert.equal(enabled({ HUMAN_CHECK: "off" }, { "human-check": true })["human-check"], false);
  assert.equal(enabled({ HUMAN_CHECK: "altcha" }, { "human-check": false })["human-check"], true);
  assert.equal(enabled({}, { "human-check": false })["human-check"], true);
});

test("dependencies: turning a dependency off turns its dependents off", () => {
  const on = { SATURDAY_FOOLS: "on" };
  assert.equal(enabled(on)["saturday-fools"], true);
  const off = states(on, { fun: false });
  assert.equal(off.get("fun").enabled, false);
  assert.equal(off.get("saturday-fools").enabled, false);
  assert.equal(off.get("saturday-fools").reason, "dep");
  assert.equal(enabled({ ...on, MODULE_FUN: "off" })["saturday-fools"], false);
  assert.deepEqual(dependentsOf("fun"), ["saturday-fools"]);
});

test("isModuleOn reads D1 once per request and throws on an unknown id", async () => {
  const env = makeEnv();
  storeRow(env, "polls", false);
  let reads = 0;
  const prepare = env.FORUM_DB.prepare.bind(env.FORUM_DB);
  env.FORUM_DB.prepare = (sql) => { if (/instance_modules/.test(sql)) reads += 1; return prepare(sql); };
  const request = new Request("https://wempos-forum.com/");
  assert.equal(await isModuleOn(env, "polls", request), false);
  assert.equal(await isModuleOn(env, "wall", request), true);
  assert.equal(reads, 1);
  await assert.rejects(isModuleOn(env, "nope", request), /Unknown module/);
});

test("a failed D1 read falls back to the defaults (today's behaviour)", async () => {
  const env = makeEnv();
  env.__sqlite.exec("DROP TABLE instance_modules");
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await isModuleOn(env, "chat"), true);
  } finally {
    console.error = original;
  }
});

// ---------------------------------------------------------------- route gate

test("off module routes answer 404 before any handler; on routes reach their handler", async () => {
  const env = makeEnv();
  const { id, session } = await member(env);
  const postId = seedPost(env.__sqlite, { authorId: id, body: "hello" });
  const paths = [`/api/posts/${postId}/poll`, `/api/users/${id}/wall`, "/api/chat", "/api/dm/threads",
    "/api/link-preview?url=https%3A%2F%2Fexample.com%2F"];
  const before = await Promise.all(paths.map((path) => call(env, path, { session })));
  for (const [index, response] of before.entries()) {
    const body = await response.json();
    assert.ok(!(response.status === 404 && body.error === "Not found."), paths[index] + " " + response.status);
  }
  for (const module of ["polls", "wall", "chat", "link-previews"]) storeRow(env, module, false);
  for (const path of paths) {
    const response = await call(env, path, { session });
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).error, "Not found.", path);
  }
  const vitals = await worker.fetch(new Request("https://wempos-forum.com/api/vitals", { method: "POST", body: "{}" }),
    makeEnv({ MODULE_WEB_VITALS: "off" }), {});
  assert.equal(vitals.status, 404);
});

test("AutoMod: env + key on, owner switched off -> /api/automod/* answers 404", async () => {
  const env = makeEnv({ AUTOMOD_ENABLED: "true", AUTOMOD_KEY: "runner-key-0123456789" });
  const auth = { headers: { Authorization: "Bearer runner-key-0123456789" } };
  assert.equal((await call(env, "/api/automod/queue", auth)).status, 200);
  storeRow(env, "automod", false);
  assert.equal((await call(env, "/api/automod/queue", auth)).status, 404);
});

test("analytics: the owner's off row stops new page counts", async () => {
  const env = makeEnv({ ANALYTICS_ENABLED: "true" });
  const count = async () => {
    const pending = [];
    const headers = { Accept: "text/html", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0" };
    await worker.fetch(new Request("https://wempos-forum.com/rules", { headers }), env,
      { waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    return env.__sqlite.prepare("SELECT COALESCE(SUM(views), 0) AS n FROM page_view_counts").get().n;
  };
  const first = await count();
  assert.ok(first >= 1, "counted while on: " + first);
  storeRow(env, "analytics", false);
  assert.equal(await count(), first);
});

// ------------------------------------------------------------- owner-only API

test("owner writes: guest, member and staff refused; CSRF required; owner saves", async () => {
  const env = makeEnv();
  const body = { id: "chat", enabled: false };
  assert.equal((await call(env, "/api/admin/modules", { method: "PUT", body })).status, 403);
  assert.equal((await putModule(env, (await member(env)).session, body)).status, 403);
  assert.equal((await putModule(env, (await staff(env)).session, body)).status, 403);
  const boss = await owner(env);
  const noCsrf = makeRequest("/api/admin/modules", { method: "PUT", body, session: boss.session });
  noCsrf.headers.delete("X-CSRF-Token");
  assert.equal((await worker.fetch(noCsrf, env, {})).status, 403);
  const crossSite = makeRequest("/api/admin/modules", { method: "PUT", body, session: boss.session });
  crossSite.headers.set("Origin", "https://evil.example");
  assert.equal((await worker.fetch(crossSite, env, {})).status, 403);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM instance_modules").get().n, 0);
  const saved = await putModule(env, boss.session, body);
  assert.equal(saved.status, 200);
  const data = await saved.json();
  assert.equal(data.saved, true);
  assert.equal(data.modules.find((m) => m.id === "chat").enabled, false);
  const row = env.__sqlite.prepare("SELECT enabled, updated_by FROM instance_modules WHERE id = 'chat'").get();
  assert.deepEqual({ ...row }, { enabled: 0, updated_by: boss.id });
  assert.equal((await putModule(env, boss.session, { id: "chat", enabled: true })).status, 200);
  assert.equal(env.__sqlite.prepare("SELECT enabled FROM instance_modules WHERE id = 'chat'").get().enabled, 1);
});

test("owner writes: a banned owner is refused by the guarded write", async () => {
  const env = makeEnv();
  const boss = await owner(env);
  seedBan(env.__sqlite, boss.id);
  const response = await putModule(env, boss.session, { id: "chat", enabled: false });
  assert.equal(response.status, 403);
  assert.equal(env.__sqlite.prepare("SELECT COUNT(*) AS n FROM instance_modules").get().n, 0);
});

test("owner writes: unknown id, read-only module and non-boolean are 400; write is rate limited", async () => {
  const env = makeEnv();
  const boss = await owner(env);
  for (const body of [{ id: "nope", enabled: true }, { id: "human-check", enabled: false },
    { id: "chat", enabled: "false" }, ["chat"], { enabled: true }]) {
    assert.equal((await putModule(env, boss.session, body)).status, 400, JSON.stringify(body));
  }
  const limited = makeEnv({ WRITE_RATE_LIMITER: { limit: async () => ({ success: false }) } });
  const limitedOwner = await owner(limited);
  assert.equal((await putModule(limited, limitedOwner.session, { id: "chat", enabled: false })).status, 429);
});

test("owner read: GET /api/admin/modules is owner-only and explains each state", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "/api/admin/modules")).status, 401);
  assert.equal((await call(env, "/api/admin/modules", { session: (await staff(env)).session })).status, 403);
  storeRow(env, "fun", false);
  const data = await (await call(env, "/api/admin/modules", { session: (await owner(env)).session })).json();
  assert.deepEqual(data.modules.map((m) => m.id), MODULES.map((m) => m.id));
  const fun = data.modules.find((m) => m.id === "fun");
  assert.deepEqual({ enabled: fun.enabled, reason: fun.reason, stored: fun.stored, dependents: fun.dependents },
    { enabled: false, reason: "stored", stored: false, dependents: ["saturday-fools"] });
  const automod = data.modules.find((m) => m.id === "automod");
  assert.deepEqual({ enabled: automod.enabled, reason: automod.reason, envVar: automod.envVar },
    { enabled: false, reason: "env", envVar: "AUTOMOD_ENABLED" });
  assert.equal(data.modules.find((m) => m.id === "chat").envVar, "MODULE_CHAT");
});

// ------------------------------------------------------------------ /api/site

test("/api/site lists only the ON module ids, nothing secret", async () => {
  const env = makeEnv({ AUTOMOD_ENABLED: "true", AUTOMOD_KEY: "secret-runner-key", ANALYTICS_ENABLED: "true" });
  storeRow(env, "wall", false);
  const response = await call(env, "/api/site");
  assert.equal(response.status, 200);
  const text = await response.text();
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data), ["modules"]);
  assert.deepEqual(data.modules, ["automod", "analytics", "web-vitals", "human-check", "chat", "polls", "fun",
    "link-previews", "embeds"]);
  assert.doesNotMatch(text, /secret-runner-key|AUTOMOD_|MODULE_|stored|updated_by/);
  assert.equal((await call(env, "/api/site", { method: "POST", body: {} })).status, 405);
});

// --------------------------------------------------------- shell + browser side

const shell = async (env) => (await worker.fetch(new Request("https://wempos-forum.com/"), env, {})).text();

test("shell: only the default-off modules ride the meta by default; off browser modules join it", async () => {
  // SEARCH_DB present (any binding object): the search module's setup is done.
  const env = makeEnv({ HUMAN_CHECK: "off", SEARCH_DB: {} });
  assert.match(await shell(env), /<meta name="site-modules-off" content="search">/);
  storeRow(env, "search", true);
  assert.doesNotMatch(await shell(env), /site-modules-off/);
  storeRow(env, "chat", false);
  storeRow(env, "embeds", false);
  storeRow(env, "polls", false); // server-only: not in the meta
  assert.match(await shell(env), /<meta name="site-modules-off" content="chat,embeds">/);
});

const docWith = (content) => makeFakeDocument({
  querySelector: (selector) => (content !== null && selector === 'meta[name="site-modules-off"]'
    ? { getAttribute: () => content } : null),
});

test("site-modules.js: no meta = everything on; the meta lists what is off", () => {
  assert.equal(siteModuleOn("chat", docWith(null)), true);
  assert.equal(siteModuleOn("chat", undefined), true);
  assert.deepEqual([...offSiteModules(docWith(" chat, embeds ,"))], ["chat", "embeds"]);
  assert.equal(siteModuleOn("embeds", docWith("chat,embeds")), false);
  assert.equal(siteModuleOn("fun", docWith("chat,embeds")), true);
  assert.equal(siteModuleOn("chat", { querySelector: () => { throw new Error("boom"); } }), true);
});

async function withDocument(doc, fn) {
  const had = Object.hasOwn(globalThis, "document");
  const previous = globalThis.document;
  globalThis.document = doc;
  try {
    return await fn();
  } finally {
    if (had) globalThis.document = previous;
    else delete globalThis.document;
  }
}

test("browser gates: fun, embeds, link previews, chat widget and vitals skip when off", async () => {
  const { anyFunOn } = await import("../public/js/fun-gate.js");
  const { embedParagraph } = await import("../public/js/embeds/lazy.js");
  const { addPreviewButtons } = await import("../public/js/link-preview.js");
  const { scheduleChatWidget } = await import("../public/js/chat-widget-loader.js");
  const { startVitals } = await import("../public/js/vitals.js");
  const storage = { getItem: () => JSON.stringify({ sketch: true }) };
  const fakeDoc = makeFakeDocument();
  const render = (run) => { const node = new FakeNode("a"); node.textContent = String(run); return node; };
  const youtube = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const off = docWith("fun,embeds,link-previews,chat,web-vitals");
  await withDocument(off, async () => {
    assert.equal(anyFunOn(storage), false);
    assert.equal(embedParagraph(fakeDoc, youtube, render, { origin: "https://wempos-forum.com" }, () => new Promise(() => {})), null);
    assert.equal(addPreviewButtons(fakeDoc, new FakeNode("article")), 0);
    let scheduled = 0;
    scheduleChatWidget({ document: off, setTimeout: () => { scheduled += 1; } }, () => Promise.resolve());
    assert.equal(scheduled, 0);
    let idle = 0;
    startVitals({ win: {}, doc: off, nav: {}, loc: { pathname: "/", search: "" }, whenIdle: () => { idle += 1; } });
    assert.equal(idle, 0);
  });
  await withDocument(docWith(null), async () => {
    assert.equal(anyFunOn(storage), true);
    assert.notEqual(embedParagraph(fakeDoc, youtube, render, { origin: "https://wempos-forum.com" }, () => new Promise(() => {})), null);
    let scheduled = 0;
    scheduleChatWidget({ document: docWith(null), setTimeout: () => { scheduled += 1; } }, () => Promise.resolve());
    assert.equal(scheduled, 1);
    let idle = 0;
    startVitals({ win: {}, doc: docWith(null), nav: {}, loc: { pathname: "/", search: "" }, whenIdle: () => { idle += 1; } });
    assert.equal(idle, 1);
  });
});

// ---------------------------------------------------------------------- desk

const rowOf = (panel, id) => Array.from(panel.querySelectorAll("li")).find((li) => li.dataset.module === id);
const inputOf = (row) => Array.from(row.querySelectorAll("input"))[0];

test("desk Modules page: switches, locked rows, dependency notes; a toggle PUTs and repaints", async () => {
  const modules = [
    { id: "fun", labelKey: "fun.title", descriptionKey: "modules.desc.fun", deps: [], dependents: ["saturday-fools"],
      readOnly: false, enabled: true, reason: "default", stored: null },
    { id: "saturday-fools", labelKey: "modules.label.saturdayFools", descriptionKey: "modules.desc.saturdayFools",
      deps: ["fun"], dependents: [], readOnly: false, enabled: false, reason: "env", stored: null },
    { id: "human-check", labelKey: "modules.label.humanCheck", descriptionKey: "modules.desc.humanCheck",
      deps: [], dependents: [], readOnly: true, enabled: true, reason: "default", stored: null },
  ];
  const calls = [];
  const request = async (path, options) => {
    calls.push([path, options]);
    return { saved: true, modules: modules.map((m) => (m.id === "fun" ? { ...m, enabled: false, reason: "stored" } : m)) };
  };
  const panel = createModulesPanel({ modules }, makeFakeDocument(), request);
  assert.equal(panel.querySelectorAll("li").length, 3);
  assert.equal(inputOf(rowOf(panel, "fun")).checked, true);
  assert.equal(inputOf(rowOf(panel, "fun")).disabled, false);
  assert.equal(inputOf(rowOf(panel, "saturday-fools")).disabled, true, "env hard-off is locked");
  assert.equal(inputOf(rowOf(panel, "human-check")).disabled, true, "read-only is locked");
  assert.equal(rowOf(panel, "fun").querySelectorAll("p").length, 2, "description + also-turns-off note");
  assert.equal(rowOf(panel, "saturday-fools").querySelectorAll("p").length, 3, "description + locked + needs");
  const input = inputOf(rowOf(panel, "fun"));
  input.checked = false;
  input.dispatch("change");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["/api/admin/modules", { method: "PUT", body: { id: "fun", enabled: false } }]]);
  assert.equal(inputOf(rowOf(panel, "fun")).checked, false);
  assert.equal(rowOf(panel, "fun").querySelectorAll("p").length, 1, "no also-off note once off");
});

test("desk: the Modules section is owner-only and lazy (never on the first-load graph)", () => {
  const admin = read("public/js/routes/admin.js");
  assert.match(admin, /\{ slug: "modules", labelKey: "admin\.section\.modules", ownerOnly: true \}/);
  assert.match(admin, /const sectionAllowed = \(section, user\) => !section\.ownerOnly \|\| user\.role === "owner";/);
  assert.match(admin, /DESK_BUILDERS\[route\.section\] && sectionAllowed\(requested, user\)/);
  const first = buildGraph(moduleEntries(), modulePreloads()).modules.map((m) => m.path);
  assert.ok(!first.includes("/js/desk/modules.js"));
  assert.ok(first.includes("/js/site-modules.js"), "the tiny meta reader rides the boot path");
});

test("docs/modules.md names the env switches and the default-off rule for new modules", () => {
  const doc = read("docs/modules.md");
  for (const needle of ["MODULE_<ID>=off", "AUTOMOD_ENABLED", "ANALYTICS_ENABLED", "HUMAN_CHECK", "SATURDAY_FOOLS",
    "/api/admin/modules", "/api/site", "default \"off\""]) {
    assert.ok(doc.includes(needle), needle);
  }
  for (const module of MODULES) assert.ok(doc.includes("`" + module.id + "`"), module.id);
});
