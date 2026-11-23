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

// v5.84 load order: the first load no longer carries the staff desk, the fun
// extras, the embed players, the mention picker (+ fuzzysort), the profile
// editor or the chat widget. These pins walk the static import graph
// (scripts/import-graph.mjs) and check the lazy seams keep every feature
// reachable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGraph, moduleEntries, modulePreloads } from "../scripts/import-graph.mjs";
import {
  ACTION_OWNERS, FORM_OWNERS, ROUTE_MODULE_LOADERS, ROUTE_OWNERS, lazyHandler, loadRouteModule,
} from "../public/js/route-modules.js";
import * as funGate from "../public/js/fun-gate.js";
import { FUN_STORAGE_KEY } from "../public/js/fun/settings.js";
import {
  CHAT_WIDGET_FALLBACK_DELAY_MS, CHAT_WIDGET_IDLE_TIMEOUT_MS, loadChatWidget, scheduleChatWidget,
} from "../public/js/chat-widget-loader.js";
import { attachMentionPicker } from "../public/js/mention-lazy.js";
import { embedParagraph } from "../public/js/embeds/lazy.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Modules that must never be fetched by a page that does not use them.
const LAZY_ONLY = [
  /^\/js\/desk\//,
  /^\/js\/fun\//,
  /^\/js\/embeds\/(?:model|waveform|media|youtube|embeds)\.js$/,
  /^\/js\/mention-picker\.js$/,
  /^\/js\/vendor\/fuzzysort\.min\.js$/,
  /^\/js\/profile-editor\.js$/,
  /^\/js\/routes\/(?:admin|twofa|appeals|reports)\.js$/,
  /^\/js\/chat-widget\.js$/,
  // The translate module's page and its validator (docs/translating.md).
  /^\/js\/routes\/translate\.js$/,
  /^\/js\/translate-validate\.js$/,
  // The search module's full-text page (docs/modules.md).
  /^\/js\/routes\/full-search\.js$/,
];
const offenders = (graph) => graph.modules.map((m) => m.path).filter((path) => LAZY_ONLY.some((re) => re.test(path)));

test("the static import graph of app.js holds no desk, fun, embed player, mention picker or profile editor", () => {
  const graph = buildGraph(["/js/app.js"]);
  assert.ok(graph.count > 20, "the walk reached app.js's imports: " + graph.count);
  assert.deepEqual(offenders(graph), []);
  assert.ok(!graph.modules.some((m) => m.path.startsWith("/js/routes/") && m.path !== "/js/routes/account-nav.js"),
    "only the header chrome route module is on the boot path");
});

test("Saturday Fools (v5.86) is never on the static first-load graph", () => {
  const eager = buildGraph(moduleEntries(), modulePreloads()).modules.map((m) => m.path);
  for (const path of ["/js/fun/saturday-fools.js", "/js/fun/saturday-fools/index.js", "/js/desk/saturday-fools.js"]) {
    assert.ok(!eager.includes(path), path + " is not eager");
  }
  assert.ok(LAZY_ONLY.some((re) => re.test("/js/fun/saturday-fools.js")), "covered by the fun/ lazy-only rule");
});

test("the real first load (index.html entries + modulepreload hints) stays free of them too", () => {
  const graph = buildGraph(moduleEntries(), modulePreloads());
  assert.deepEqual(offenders(graph), []);
  assert.ok(moduleEntries().includes("/js/chat-widget-loader.js"));
  assert.ok(!moduleEntries().includes("/js/chat-widget.js"), "the widget itself is imported at idle");
  assert.ok(!modulePreloads().includes("/js/mention-picker.js"));
});

test("every lazy-only module is still reachable through a dynamic import()", () => {
  const routes = buildGraph().lazy.filter((edge) => edge.from === "/js/route-modules.js").map((edge) => edge.path);
  const all = buildGraph([...moduleEntries(), ...routes, "/js/chat-widget.js", "/js/fun/index.js", "/js/fun/saturday-fools.js",
    "/js/embeds/embeds.js", "/js/mention-picker.js"]);
  const lazyTargets = new Set(all.lazy.map((edge) => edge.path));
  for (const path of ["/js/chat-widget.js", "/js/fun/index.js", "/js/fun/settings.js", "/js/fun/saturday-fools.js",
    "/js/embeds/embeds.js",
    "/js/mention-picker.js", "/js/routes/admin.js", "/js/routes/post.js", "/js/routes/translate.js",
    "/js/routes/full-search.js"]) {
    assert.ok(lazyTargets.has(path), path + " has a dynamic import() edge");
  }
  const reachable = new Set(all.modules.map((m) => m.path));
  for (const path of ["/js/desk/reports.js", "/js/desk/modules.js", "/js/embeds/model.js", "/js/embeds/waveform.js", "/js/profile-editor.js",
    "/js/vendor/fuzzysort.min.js", "/js/fun/sketch.js", "/js/fun/saturday-fools/index.js",
    "/js/translate-validate.js"]) {
    assert.ok(reachable.has(path), path + " loads with its feature");
  }
});

// ---------------------------------------------------------------- handler owners

// Top-level keys of `export const NAME = { … }` in a module's source.
function exportedKeys(source, name) {
  const start = source.indexOf(`export const ${name} = {`);
  if (start < 0) return [];
  const keys = [];
  let index = source.indexOf("{", start) + 1;
  let depth = 1;
  let expectKey = true;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === "/" && source[index + 1] === "/") { index = source.indexOf("\n", index); continue; }
    if (char === "/" && source[index + 1] === "*") { index = source.indexOf("*/", index) + 2; continue; }
    if (char === "\"" || char === "'" || char === "`") {
      let end = index + 1;
      while (source[end] !== char) end += source[end] === "\\" ? 2 : 1;
      if (depth === 1 && expectKey && /^\s*:/.test(source.slice(end + 1, end + 20))) keys.push(source.slice(index + 1, end));
      index = end + 1;
      expectKey = false;
      continue;
    }
    if ("{([".includes(char)) depth += 1;
    else if ("})]".includes(char)) depth -= 1;
    else if (char === "," && depth === 1) expectKey = true;
    else if (depth === 1 && expectKey && /[A-Za-z_$]/.test(char)) {
      const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(source.slice(index));
      if (match) keys.push(match[1]);
      expectKey = false;
    }
    index += 1;
  }
  return keys;
}

const ownedBy = (table, key) => Object.entries(table).filter(([, owner]) => owner === key).map(([name]) => name).sort();

test("the owner tables list exactly each lazy module's ACTIONS and FORM_HANDLERS keys", () => {
  assert.equal(exportedKeys("export const ACTIONS = {\n  a: 1,\n  \"b-c\": () => { x: 1 },\n};", "ACTIONS").join(), "a,b-c");
  for (const key of Object.keys(ROUTE_MODULE_LOADERS)) {
    const source = read(`public/js/routes/${key}.js`);
    assert.deepEqual(ownedBy(ACTION_OWNERS, key), exportedKeys(source, "ACTIONS").sort(), key + " ACTIONS");
    assert.deepEqual(ownedBy(FORM_OWNERS, key), exportedKeys(source, "FORM_HANDLERS").sort(), key + " FORM_HANDLERS");
  }
});

test("no lazy handler name collides with a handler app.js still registers eagerly", () => {
  for (const path of ["public/js/wall.js", "public/js/passkeys.js", "public/js/account-security.js",
    "public/js/routes/account-nav.js"]) {
    const source = read(path);
    for (const name of exportedKeys(source, "ACTIONS")) assert.ok(!Object.hasOwn(ACTION_OWNERS, name), path + " " + name);
    for (const name of exportedKeys(source, "FORM_HANDLERS")) assert.ok(!Object.hasOwn(FORM_OWNERS, name), path + " " + name);
  }
  for (const name of ["confirm-block", "confirm-delete", "confirm-cancel"]) assert.ok(!Object.hasOwn(ACTION_OWNERS, name));
});

test("every routed page names a loadable module, and app.js dispatches through the lazy tables", () => {
  for (const owner of Object.values(ROUTE_OWNERS)) assert.ok(ROUTE_MODULE_LOADERS[owner], owner);
  const app = read("public/js/app.js");
  assert.match(app, /loadRouteModule\(owner\)/);
  assert.match(app, /if \(version !== state\.renderVersion\) return;\n {2}setRouteTitle\(route\);/,
    "the renderVersion race guard runs after the module arrives");
  assert.match(app, /await lazyHandler\("form", type\)/);
  assert.match(app, /await lazyHandler\("action", button\.dataset\.action\)/);
});

test("loadRouteModule imports once, and forgets a failed import so the next try retries", async () => {
  let calls = 0;
  const module = { ACTIONS: { ping: () => "pong" }, FORM_HANDLERS: {} };
  const loaders = { pages: () => { calls += 1; return Promise.resolve(module); } };
  const [first, second] = await Promise.all([loadRouteModule("pages", loaders), loadRouteModule("pages", loaders)]);
  assert.equal(first, module);
  assert.equal(second, module);
  assert.equal(calls, 1);
  let failing = 0;
  const flaky = { appeals: () => (failing++ === 0 ? Promise.reject(new Error("offline")) : Promise.resolve(module)) };
  await assert.rejects(loadRouteModule("appeals", flaky));
  await tick();
  assert.equal(await loadRouteModule("appeals", flaky), module);
  await assert.rejects(loadRouteModule("nope", {}));
});

test("lazyHandler finds an owned handler and answers null for a name no module owns", async () => {
  const reports = { ACTIONS: { report: () => "opened" }, FORM_HANDLERS: { report: () => "sent" } };
  const loaders = { reports: () => Promise.resolve(reports) };
  assert.equal((await lazyHandler("action", "report", loaders))(), "opened");
  assert.equal((await lazyHandler("form", "report", loaders))(), "sent");
  assert.equal(await lazyHandler("form", "chat-lobby-send", loaders), null, "the chat lobby's own forms stay unowned");
  assert.equal(await lazyHandler("action", "toString", loaders), null);
});

// ---------------------------------------------------------------- fun extras gate

const memoryStorage = (value) => ({ getItem: () => (value === undefined ? null : JSON.stringify(value)) });

test("fun gate: the storage key mirrors fun/settings.js; switches read safely", () => {
  assert.equal(funGate.FUN_GATE_STORAGE_KEY, FUN_STORAGE_KEY);
  assert.equal(funGate.anyFunOn(memoryStorage()), false);
  assert.equal(funGate.anyFunOn(memoryStorage({ confetti: false })), false);
  assert.equal(funGate.anyFunOn(memoryStorage({ sketch: true })), true);
  assert.equal(funGate.funSwitchOn("sketch", memoryStorage({ sketch: true })), true);
  assert.equal(funGate.funSwitchOn("sounds", memoryStorage({ sketch: true })), false);
  assert.equal(funGate.anyFunOn({ getItem: () => { throw new Error("blocked"); } }), false);
  assert.equal(funGate.anyFunOn({ getItem: () => "[true]" }), false);
});

test("fun gate: all off loads nothing; on load the watcher is seeded and the eggs installed", async () => {
  const off = memoryStorage();
  assert.equal(await funGate.enhanceFunView(new FakeNode("main"), off), undefined);
  funGate.noteUnreadCount(3, off);
  const calls = [];
  const fun = {
    noteUnreadCount: (count) => calls.push(["unread", count]),
    startFunExtras: () => calls.push(["eggs"]),
    enhanceFunView: (root) => calls.push(["view", root.tagName]),
  };
  await funGate.loadFunExtras(() => Promise.resolve(fun));
  assert.deepEqual(calls, [["unread", 3], ["eggs"]], "seeded with the last count before any rise can chime");
  funGate.noteUnreadCount(5, off);
  await funGate.enhanceFunView(new FakeNode("main"), off);
  assert.deepEqual(calls.slice(2), [["unread", 5], ["view", "MAIN"]]);
  assert.equal(await funGate.loadFunExtras(() => Promise.reject(new Error("unused"))), fun, "imported once");
});

test("fun gate: app.js, the composer, settings and sign-out reach fun/ only through the gate or import()", () => {
  const app = read("public/js/app.js");
  assert.match(app, /from "\.\/fun-gate\.js"/);
  assert.doesNotMatch(app, /from "\.\/fun\//);
  assert.match(read("public/js/routes/feed.js"), /await loadFunExtras\(\)/);
  assert.match(read("public/js/routes/composer.js"), /funSwitchOn\("sketch"\)/);
  assert.match(read("public/js/routes/account-nav.js"), /import\("\.\.\/fun\/settings\.js"\)/);
  assert.match(read("public/js/routes/account-nav.js"), /await lastFunWipe;/);
});

// ---------------------------------------------------------------- chat widget

test("chat widget: imported at idle with a deadline, or on a short timeout without requestIdleCallback", async () => {
  const idle = [];
  let loads = 0;
  scheduleChatWidget({ requestIdleCallback: (fn, options) => idle.push([fn, options]) }, () => { loads += 1; return Promise.resolve(); });
  assert.equal(idle.length, 1);
  assert.equal(idle[0][1].timeout, CHAT_WIDGET_IDLE_TIMEOUT_MS);
  assert.equal(loads, 0, "nothing loads before the idle slot");
  idle[0][0]();
  assert.equal(loads, 1);
  const timers = [];
  scheduleChatWidget({ setTimeout: (fn, ms) => timers.push([fn, ms]) }, () => { loads += 1; return Promise.resolve(); });
  assert.equal(timers[0][1], CHAT_WIDGET_FALLBACK_DELAY_MS);
  timers[0][0]();
  assert.equal(loads, 2);
  assert.ok(CHAT_WIDGET_IDLE_TIMEOUT_MS <= 3000, "the launcher and unread badge still appear promptly");
});

test("chat widget: one import shared by the idle slot and the profile Chat button; a failure retries", async () => {
  let calls = 0;
  const widget = { openChatThread: () => "opened" };
  const failing = () => { calls += 1; return Promise.reject(new Error("offline")); };
  await assert.rejects(loadChatWidget(failing));
  await tick();
  const ok = () => { calls += 1; return Promise.resolve(widget); };
  assert.equal(await loadChatWidget(ok), widget);
  assert.equal(await loadChatWidget(ok), widget);
  assert.equal(calls, 2);
  assert.match(read("public/js/routes/profile.js"), /const \{ openChatThread \} = await loadChatWidget\(\);/);
  assert.doesNotMatch(read("public/js/routes/profile.js"), /from "\.\.\/chat-widget\.js"/);
});

// ---------------------------------------------------------------- mention picker

test("mention picker: the real picker loads and attaches on the field's first focus, once", async () => {
  const document = makeFakeDocument();
  const textarea = new FakeNode("textarea");
  const attached = [];
  let loads = 0;
  const load = () => { loads += 1; return Promise.resolve({ attachMentionPicker: (field, doc) => attached.push([field, doc]) }); };
  attachMentionPicker(textarea, document, load);
  assert.equal(loads, 0, "nothing loads until the field is used");
  textarea.dispatch("focus");
  textarea.dispatch("focus");
  await tick();
  assert.equal(loads, 1);
  assert.deepEqual(attached, [[textarea, document]]);
  for (const path of ["public/js/routes/composer.js", "public/js/chat-widget-lobby.js"]) {
    assert.match(read(path), /from "\.\.?\/mention-lazy\.js"/, path);
  }
});

test("mention picker: an already-focused field attaches at once; an offline import retries on the next focus", async () => {
  const textarea = new FakeNode("textarea");
  const document = makeFakeDocument({ activeElement: textarea });
  let loads = 0;
  attachMentionPicker(textarea, document, () => { loads += 1; return Promise.resolve({ attachMentionPicker() {} }); });
  assert.equal(loads, 1);
  const other = new FakeNode("textarea");
  let tries = 0;
  attachMentionPicker(other, makeFakeDocument(), () => {
    tries += 1;
    return tries === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ attachMentionPicker() {} });
  });
  other.dispatch("focus");
  await tick();
  other.dispatch("focus");
  await tick();
  assert.equal(tries, 2);
});

// ---------------------------------------------------------------- embeds

const renderText = (document) => (text) => {
  const paragraph = document.createElement("p");
  paragraph.className = "post-body";
  paragraph.textContent = text;
  return paragraph;
};

test("embeds: a paragraph with no embeddable link loads no player at all", () => {
  const document = makeFakeDocument();
  let loads = 0;
  const result = embedParagraph(document, "just words\n\nhttps://example.org/page", renderText(document),
    { origin: "https://forum.test" }, () => { loads += 1; return Promise.resolve({}); });
  assert.equal(result, null);
  assert.equal(loads, 0);
});

test("embeds: the host paints at once with the plain link, then holds the player's figure", async () => {
  const document = makeFakeDocument();
  const figure = document.createElement("figure");
  const calls = [];
  const embeds = {
    createEmbed(doc, run, options) {
      calls.push([run, options.origin]);
      const host = doc.createElement("div");
      host.append(figure);
      return host;
    },
  };
  const nodes = embedParagraph(document, "Intro\n\nhttps://youtu.be/dQw4w9WgXcQ", renderText(document),
    { origin: "https://forum.test" }, () => Promise.resolve(embeds));
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].className, "post-body");
  const host = nodes[1];
  assert.equal(host.className, "post-body");
  assert.equal(host.dataset.embed, "youtube");
  assert.equal(host.children[0].className, "embed-pending", "the readable link holds the seat");
  await tick();
  assert.deepEqual(calls, [["https://youtu.be/dQw4w9WgXcQ", "https://forum.test"]]);
  assert.equal(host.children[0], figure);
});

test("embeds: a failed player import leaves the plain link in place", async () => {
  const document = makeFakeDocument();
  const [host] = embedParagraph(document, "/media/clip.mp4", renderText(document), { origin: "https://forum.test" },
    () => Promise.reject(new Error("offline")));
  await tick();
  assert.equal(host.dataset.embed, "video");
  assert.equal(host.children[0].className, "embed-pending");
});
