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

// v5.40.0 client side: F1 the notification-preferences settings panel (one
// checkbox per kind), F2 the skip link + landmarks, F3 easy-reading spacing
// (WCAG 1.4.12) in Reading comfort.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { NOTIFICATION_KINDS } from "../api/notifications.mjs";
import {
  NOTIFICATION_PREFS_PATH, NOTIFICATION_PREF_KINDS, createNotificationPrefsList, renderNotificationPrefs,
} from "../public/js/notification-prefs.js";
import { wireSkipLink } from "../public/js/skip-link.js";
import {
  EASY_READING_CLASS, EASY_READING_STORAGE_KEY, applyEasyReading, createEasyReadingToggle, readEasyReading,
} from "../public/js/reading-comfort.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const memoryStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    data,
  };
};
const throwingStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
const boxesIn = (node) => Array.from(node.querySelectorAll("input")).filter((input) => input.type === "checkbox");
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---- F1: notification preferences panel --------------------------------------

test("F1 client kinds mirror the server allowlist exactly", () => {
  assert.deepEqual([...NOTIFICATION_PREF_KINDS], [...NOTIFICATION_KINDS]);
  assert.equal(NOTIFICATION_PREFS_PATH, "/api/me/notification-prefs");
});

test("F1 list: one labelled checkbox per kind, checked = notify; a change saves the unchecked kinds", async () => {
  const doc = makeFakeDocument();
  const saves = [];
  const list = createNotificationPrefsList(doc, { kinds: [...NOTIFICATION_KINDS], muted: ["mention"] },
    (muted) => { saves.push(muted); });
  const boxes = boxesIn(list);
  assert.equal(boxes.length, NOTIFICATION_KINDS.length);
  assert.deepEqual(boxes.map((box) => box.dataset.kind), [...NOTIFICATION_KINDS]);
  assert.deepEqual(boxes.map((box) => box.checked), NOTIFICATION_KINDS.map((kind) => kind !== "mention"));
  for (const label of list.querySelectorAll("label")) assert.ok(label.textContent.trim().length > 0);
  const reply = boxes.find((box) => box.dataset.kind === "reply");
  reply.checked = false;
  await reply.fire("change");
  assert.deepEqual(saves.at(-1), ["reply", "mention"]);
  // Unknown kinds from a newer server are not painted.
  const extra = createNotificationPrefsList(doc, { kinds: [...NOTIFICATION_KINDS, "bogus"], muted: [] }, () => {});
  assert.equal(boxesIn(extra).length, NOTIFICATION_KINDS.length);
});

test("F1 panel: loads through api(), PUTs the muted list, shows a failure and puts the box back", async () => {
  const calls = [];
  let fail = false;
  const apiFn = async (path, options = {}) => {
    calls.push([path, options]);
    if (fail) throw new Error("nope");
    if (options.method === "PUT") return { kinds: [...NOTIFICATION_KINDS], muted: options.body.muted };
    return { kinds: [...NOTIFICATION_KINDS], muted: [] };
  };
  const doc = makeFakeDocument();
  const account = new FakeNode("details");
  await renderNotificationPrefs(account, { doc, apiFn });
  assert.deepEqual(calls[0], [NOTIFICATION_PREFS_PATH, {}]);
  const boxes = boxesIn(account);
  assert.equal(boxes.length, NOTIFICATION_KINDS.length);
  const follow = boxes.find((box) => box.dataset.kind === "follow_thread");
  follow.checked = false;
  await follow.fire("change");
  await tick();
  assert.deepEqual(calls[1], [NOTIFICATION_PREFS_PATH, { method: "PUT", body: { muted: ["follow_thread"] } }]);
  fail = true;
  const chat = boxes.find((box) => box.dataset.kind === "chat_mention");
  chat.checked = false;
  await chat.fire("change");
  await tick();
  assert.equal(chat.checked, true, "a failed save puts the box back to the saved state");
  assert.equal(follow.checked, false, "the earlier saved mute stays");
  const status = account.querySelector("[role=status]");
  assert.ok(status && status.textContent.trim().length > 0, "a visible failure line");
  const failedLoad = new FakeNode("details");
  await renderNotificationPrefs(failedLoad, { doc, apiFn });
  assert.equal(boxesIn(failedLoad).length, 0);
  assert.ok(failedLoad.textContent.trim().length > 0, "a load error line");
});

test("F1 wiring: the settings area renders the panel; no HTML sinks; no storage", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /import \{ renderNotificationPrefs \} from "\.\.\/notification-prefs\.js";/);
  assert.match(feed, /renderNotificationPrefs\(account\)/);
  const src = read("public/js/notification-prefs.js");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
});

// ---- F2: skip link + landmarks -------------------------------------------------

const html = read("public/index.html");
const bodyMarkup = html.slice(html.indexOf("<body"));

test("F2 the skip link is the first focusable element and targets the one <main>", () => {
  const first = bodyMarkup.match(/<(a\s[^>]*href|button|input|select|textarea|[a-z]+\s[^>]*tabindex="0")[^>]*>/);
  assert.ok(first, "a focusable element in the body");
  assert.match(first[0], /^<a class="skip-link" href="#main-content"/);
  assert.equal((html.match(/<main\b/g) || []).length, 1, "exactly one <main>");
  assert.match(html, /<main id="main-content" class="main-content" tabindex="-1">/);
  assert.equal((html.match(/<header\b/g) || []).length, 1);
  assert.equal((html.match(/<footer\b/g) || []).length, 1);
  const order = ["<header", "<main", "<footer"].map((tag) => bodyMarkup.indexOf(tag));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "header, main, footer in order");
  for (const nav of html.match(/<nav\b[^>]*>/g) || []) assert.match(nav, /aria-label="[^"]+"/, nav);
  for (const path of ["public/js/app.js", "public/js/router.js", "public/js/dom.js"]) {
    assert.doesNotMatch(read(path), /createElement\("main"\)|role="main"/, path);
  }
  const css = read("public/styles.css");
  assert.match(css, /\.skip-link \{[^}]*transform: translateY\(-180%\)/, "hidden until focused");
  assert.match(css, /\.skip-link:focus(?:-visible)? \{[^}]*transform: translateY\(0\)/);
});

function fakePage() {
  const body = new FakeNode("body");
  const skip = new FakeNode("a");
  skip.className = "skip-link";
  skip.setAttribute("href", "#main-content");
  const header = new FakeNode("header");
  const brand = new FakeNode("a");
  brand.setAttribute("href", "/");
  const search = new FakeNode("input");
  header.append(brand, search);
  const main = new FakeNode("main");
  main.id = "main-content";
  main.setAttribute("tabindex", "-1");
  body.append(skip, header, main);
  const doc = makeFakeDocument({ body, querySelector: (selector) => body.querySelector(selector) });
  return { doc, body, skip, main, brand };
}

test("F2 first Tab lands on the skip link; activating it focuses <main> without a URL change", () => {
  const { doc, body, skip, main, brand } = fakePage();
  assert.equal(wireSkipLink(doc), true);
  const tabOrder = Array.from(body.querySelectorAll("a[href], button, input, select, textarea"));
  assert.equal(tabOrder[0], skip, "first Tab");
  tabOrder[0].focus();
  let prevented = false;
  skip.dispatch("click", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "no #fragment navigation (popstate would re-render the route)");
  assert.equal(main.ownerFocused, true);
  assert.equal(main.getAttribute("tabindex"), "-1");
  assert.notEqual(brand.ownerFocused, true);
  // Keyboard activation of a link is a click; a missing target is a no-op.
  const bare = makeFakeDocument({ querySelector: () => null });
  assert.equal(wireSkipLink(bare), false);
});

test("F2 wiring: app.js wires the skip link at boot and index.html preloads the module", () => {
  assert.match(read("public/js/app.js"), /import \{ wireSkipLink \} from "\.\/skip-link\.js";/);
  assert.match(read("public/js/app.js"), /wireSkipLink\(document\);/);
  assert.match(html, /<link rel="modulepreload" href="\/js\/skip-link\.js">/);
  assert.doesNotMatch(read("public/js/skip-link.js"), /innerHTML|localStorage|sessionStorage|api\(/);
});

// ---- F3: easy-reading spacing ----------------------------------------------------

test("F3 easy reading: off by default, stored as on/off in this browser, blocked storage reads off", () => {
  assert.equal(EASY_READING_STORAGE_KEY, "forum-easy-reading");
  assert.equal(EASY_READING_CLASS, "easy-reading");
  assert.equal(readEasyReading(memoryStorage()), false);
  assert.equal(readEasyReading(memoryStorage({ [EASY_READING_STORAGE_KEY]: "on" })), true);
  assert.equal(readEasyReading(memoryStorage({ [EASY_READING_STORAGE_KEY]: "yes" })), false);
  assert.equal(readEasyReading(throwingStorage), false);
  assert.equal(readEasyReading(null), false);
  const doc = makeFakeDocument({ documentElement: new FakeNode("html") });
  applyEasyReading(doc, true);
  assert.equal(doc.documentElement.classList.contains("easy-reading"), true);
  applyEasyReading(doc, false);
  assert.equal(doc.documentElement.classList.contains("easy-reading"), false);
});

test("F3 toggle reflects storage; toggling stores and applies; blocked storage still applies", async () => {
  const storage = memoryStorage({ [EASY_READING_STORAGE_KEY]: "on" });
  const doc = makeFakeDocument({ documentElement: new FakeNode("html") });
  const toggle = createEasyReadingToggle(doc, storage);
  const box = Array.from(toggle.children).find((child) => child.tagName === "INPUT");
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, true);
  assert.ok(toggle.textContent.trim().length > 0);
  box.checked = false;
  await box.fire("change");
  assert.equal(storage.data.get(EASY_READING_STORAGE_KEY), "off");
  assert.equal(doc.documentElement.classList.contains("easy-reading"), false);
  const blocked = createEasyReadingToggle(doc, throwingStorage);
  const blockedBox = Array.from(blocked.children).find((child) => child.tagName === "INPUT");
  blockedBox.checked = true;
  await assert.doesNotReject(blockedBox.fire("change"));
  assert.equal(doc.documentElement.classList.contains("easy-reading"), true);
});

test("F3 theme-preload paints easy reading before first paint, and only for 'on'", () => {
  const run = (stored) => {
    const root = new FakeNode("html");
    vm.runInNewContext(read("public/js/theme-preload.js"), {
      localStorage: memoryStorage(stored), document: { documentElement: root },
      matchMedia: (query) => ({ matches: false, media: query, addEventListener() {} }),
    });
    return root;
  };
  assert.equal(run({}).classList.contains("easy-reading"), false);
  assert.equal(run({ "forum-easy-reading": "on" }).classList.contains("easy-reading"), true);
  assert.equal(run({ "forum-easy-reading": "<b>" }).classList.contains("easy-reading"), false);
});

test("F3 CSS meets WCAG 1.4.12 minimums; no new font files", () => {
  const css = read("public/styles.css");
  const blocks = [...css.matchAll(/:root\.easy-reading[^{]*\{([^}]*)\}/g)].map((match) => match[1]).join("\n");
  assert.ok(blocks, ":root.easy-reading rules");
  const value = (prop) => {
    const hits = [...blocks.matchAll(new RegExp("(?:^|[;\\s])" + prop + ":\\s*([0-9.]+)(em)?\\s*;", "g"))];
    assert.ok(hits.length, prop);
    return Math.min(...hits.map((hit) => Number(hit[1])));
  };
  assert.ok(value("letter-spacing") >= 0.12);
  assert.ok(value("word-spacing") >= 0.16);
  assert.ok(value("line-height") >= 1.5);
  assert.ok(value("margin-block-end") >= 2);
  assert.doesNotMatch(blocks, /font-family|@font-face|url\(/);
});

test("F3 wiring: the toggle sits in the Reading comfort panel with its help line", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /readingComfort\.append\(createEasyReadingToggle\(document, storage\)\);/);
  assert.match(feed, /t\("readingComfort\.easyReadingHelp"\)/);
});
