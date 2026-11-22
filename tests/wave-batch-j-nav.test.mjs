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

// Batch J (navigation, keyboard and reading polish): pins the vendored MIT
// libraries byte for byte with their REUSE licensing, the global shortcuts
// (tinykeys; ignored while typing; can be turned off), the "?" help dialog,
// the route progress bar (NProgress), the Floating UI badge tooltips, the
// outline's active-entry highlight (IntersectionObserver), AutoAnimate
// lists, sortable tables (tablesort, aria-sort), CountUp counters, the
// Headroom header, reduced motion everywhere, the ux.* strings and wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { FakeNode, makeFakeDocument, findByClass } from "./helpers/fake-dom.mjs";
import {
  GLOBAL_KEY_BINDINGS, GLOBAL_SHORTCUT_ROWS, bindGlobalKeys, createShortcutHelp, ignoreGlobalKey,
  readGlobalKeysOn, writeGlobalKeysOn,
} from "../public/js/global-keys.js";
import { createRouteProgress } from "../public/js/route-progress.js";
import { TOOLTIP_SELECTOR, hideTooltip, prepareTooltipTrigger, showTooltip } from "../public/js/tooltips.js";
import { createThreadOutline, pickActiveReply } from "../public/js/thread-outline.js";
import { animateLists, motionTargets } from "../public/js/list-motion.js";
import { SORTABLE_TABLE_SELECTOR, makeTablesSortable } from "../public/js/sortable-tables.js";
import { countUpStats } from "../public/js/stat-count.js";
import { HEADROOM_QUERY, initHeadroom } from "../public/js/header-headroom.js";
import { createLeaderboardTable } from "../public/js/leaderboard-table.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sha = (path) => createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex");
const noMotion = { matchMedia: () => ({ matches: true }) };
const motionOk = { matchMedia: () => ({ matches: false }) };

// ---------------------------------------------------------------- vendor

const VENDOR = Object.freeze({
  "tinykeys.js": ["e64ee8cae15a71947e8ef44c03005a58cb4437a5877be771fadef58a58d97efe", "Jamie Kyle"],
  "nprogress.js": ["6b9611076ec2701c0115c4f9105fdfdc4e2fcc8ab21eb491f3bf27b1e358c3ae", "Rico Sta. Cruz"],
  "floating-ui.core.umd.min.js": ["65940d866a6b6d831394a4bbed99ed0a39330bac98b643386d9a2f87a1a1d5da", "Floating UI contributors"],
  "floating-ui.dom.umd.min.js": ["61a46f943c4e99379eaf073447811aec7e8b8f120d2f646316e01b7694bc90a3", "Floating UI contributors"],
  "auto-animate.js": ["41024903a09f83f932e0eeabb99d35f84672a639b96908683ec918e95cef0c5e", "FormKit Inc."],
  "tablesort.min.js": ["ee99f17ebc985170899a004e9f6bf09e7f60eb4b459b6bfe6683cf0140352c63", "Tristen Brown"],
  "tablesort.number.min.js": ["e25dad08c53361182db670d0f670e85eea0f57e5d3bad0439831c75e1842096c", "Tristen Brown"],
  "countUp.js": ["eedb44a852b00d53064b187f0dff231dc16714d83740e082773dca61460ac46b", "Jamie Perkins"],
  "headroom.js": ["b67bde8acb38e0619356e21ea41329a9b4c51dcf744d7d4842c79c53f8d60030", "Nick Williams"],
});

test("each Batch J vendor file is the approved upstream build, byte for byte", () => {
  for (const [file, [hash]] of Object.entries(VENDOR)) {
    assert.equal(sha("public/js/vendor/" + file), hash, file);
  }
});

test("REUSE.toml gives each Batch J vendor file its own MIT block after the Prism one", () => {
  const reuse = read("REUSE.toml");
  const prismAt = reuse.indexOf('"public/js/vendor/**"');
  for (const [file, [, holder]] of Object.entries(VENDOR)) {
    const at = reuse.indexOf('"public/js/vendor/' + file + '"');
    assert.ok(at > prismAt, file + " annotated after the vendor/** block");
    const next = reuse.indexOf("[[annotations]]", at);
    const block = reuse.slice(at, next === -1 ? undefined : next);
    assert.match(block, /SPDX-License-Identifier = "MIT"/, file);
    assert.match(block, /precedence = "override"/, file);
    assert.ok(block.includes(holder), file + " names " + holder);
  }
});

// ---------------------------------------------------------------- keys

const keyEvent = (target, extra = {}) => {
  let prevented = false;
  return {
    target, key: "x", repeat: false, isComposing: false, defaultPrevented: false,
    preventDefault() { prevented = true; }, get prevented() { return prevented; }, ...extra,
  };
};
const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

test("global shortcuts are ignored while typing, composing, repeating or already handled", () => {
  for (const tag of ["input", "textarea", "select"]) assert.equal(ignoreGlobalKey(keyEvent(new FakeNode(tag))), true, tag);
  const editable = new FakeNode("div");
  editable.isContentEditable = true;
  assert.equal(ignoreGlobalKey(keyEvent(editable)), true);
  assert.equal(ignoreGlobalKey(keyEvent(new FakeNode("body"), { isComposing: true })), true);
  assert.equal(ignoreGlobalKey(keyEvent(new FakeNode("body"), { repeat: true })), true);
  assert.equal(ignoreGlobalKey(keyEvent(new FakeNode("body"), { defaultPrevented: true })), true);
  assert.equal(ignoreGlobalKey(keyEvent(new FakeNode("body"))), false);
});

test("the binding map names g h, g c, / and ? (Shift optional)", () => {
  assert.deepEqual(Object.keys(GLOBAL_KEY_BINDINGS).sort(), ["/", "[Shift]+?", "g c", "g h"].sort());
  assert.deepEqual(Object.values(GLOBAL_KEY_BINDINGS).sort(), ["chat", "help", "home", "search"]);
});

test("bindGlobalKeys hands tinykeys one guarded handler per binding", () => {
  const calls = [];
  let map = null;
  const storage = memoryStorage();
  bindGlobalKeys({}, {
    home: () => calls.push("home"), chat: () => calls.push("chat"),
    search: () => calls.push("search"), help: () => calls.push("help"),
  }, { storage, tinykeys: (target, bindings) => { map = bindings; return () => {}; } });
  const body = new FakeNode("body");
  const typed = keyEvent(new FakeNode("input"));
  map["g h"](typed);
  assert.deepEqual(calls, [], "typing never fires a shortcut");
  assert.equal(typed.prevented, false);
  const plain = keyEvent(body);
  map["g h"](plain);
  map["/"](keyEvent(body));
  map["[Shift]+?"](keyEvent(body));
  map["g c"](keyEvent(body));
  assert.deepEqual(calls, ["home", "search", "help", "chat"]);
  assert.equal(plain.prevented, true);
  writeGlobalKeysOn(storage, false);
  map["g h"](keyEvent(body));
  assert.equal(calls.length, 4, "turned off: no shortcut fires");
});

test("the on/off choice defaults on, persists off, survives blocked storage", () => {
  const storage = memoryStorage();
  assert.equal(readGlobalKeysOn(storage), true);
  writeGlobalKeysOn(storage, false);
  assert.equal(readGlobalKeysOn(storage), false);
  writeGlobalKeysOn(storage, true);
  assert.equal(readGlobalKeysOn(storage), true);
  const broken = {
    getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(readGlobalKeysOn(broken), true);
  assert.doesNotThrow(() => writeGlobalKeysOn(broken, false));
});

test("the ? help is a native <dialog> listing every shortcut plus the off switch", () => {
  const document = makeFakeDocument();
  const storage = memoryStorage();
  const dialog = createShortcutHelp(document, { storage });
  assert.equal(dialog.tagName, "DIALOG");
  assert.match(dialog.className, /shortcut-help/);
  const list = findByClass(dialog, "shortcut-help-list");
  assert.ok(list.children.length >= GLOBAL_SHORTCUT_ROWS.length + 5);
  const toggle = findByClass(dialog, "shortcut-help-toggle");
  assert.equal(toggle.checked, true);
  toggle.checked = false;
  toggle.dispatch("change", { target: toggle });
  assert.equal(readGlobalKeysOn(storage), false);
  assert.ok(findByClass(dialog, "shortcut-help-close"));
});

// ---------------------------------------------------------------- progress

test("route progress starts and finishes NProgress, quietly under reduced motion", async () => {
  const log = [];
  const fake = {
    configure: (options) => log.push(["configure", options]),
    start: () => log.push(["start"]), done: () => log.push(["done"]),
  };
  const progress = createRouteProgress({ load: async () => fake, win: motionOk });
  await progress.start();
  await progress.done();
  assert.deepEqual(log.map((entry) => entry[0]), ["configure", "start", "done"]);
  assert.equal(log[0][1].showSpinner, false);
  const still = [];
  const quiet = createRouteProgress({ load: async () => ({ ...fake, configure: (options) => still.push(options) }), win: noMotion });
  await quiet.start();
  assert.equal(still[0].trickle, false);
  assert.equal(still[0].speed, 0);
});

test("a failed NProgress load never breaks navigation", async () => {
  const progress = createRouteProgress({ load: async () => { throw new Error("404"); }, win: motionOk });
  await assert.doesNotReject(progress.start());
  await assert.doesNotReject(progress.done());
});

// ---------------------------------------------------------------- tooltips

test("badge tooltips: title moves to data-tooltip, show sets role=tooltip + aria-describedby, hide undoes", async () => {
  assert.ok(TOOLTIP_SELECTOR.includes(".role-badge[title]"));
  const body = new FakeNode("body");
  const document = makeFakeDocument({ body });
  const chip = new FakeNode("span");
  chip.className = "role-badge role-badge-new";
  chip.setAttribute("title", "Joined this week");
  body.append(chip);
  prepareTooltipTrigger(chip);
  assert.equal(chip.hasAttribute("title"), false);
  assert.equal(chip.getAttribute("data-tooltip"), "Joined this week");
  assert.equal(chip.getAttribute("tabindex"), "0");
  const positioned = [];
  const tip = await showTooltip(document, chip, { position: async (trigger, node) => positioned.push([trigger, node]) });
  assert.equal(tip.getAttribute("role"), "tooltip");
  assert.equal(tip.textContent, "Joined this week");
  assert.equal(chip.getAttribute("aria-describedby"), tip.id);
  assert.equal(positioned.length, 1);
  hideTooltip(chip);
  assert.equal(chip.hasAttribute("aria-describedby"), false);
  assert.equal(tip.parentNode, null);
});

// ---------------------------------------------------------------- outline

test("pickActiveReply picks the first reply in page order that is on screen", () => {
  assert.equal(pickActiveReply([3, 4, 5], new Set([5, 4])), 4);
  assert.equal(pickActiveReply([3, 4, 5], new Set()), null);
});

test("the outline highlights the reply on screen through IntersectionObserver", () => {
  const document = makeFakeDocument();
  const replyList = new FakeNode("div");
  const replies = [];
  for (let id = 1; id <= 8; id += 1) {
    const card = new FakeNode("article");
    card.setAttribute("data-post-id", String(id));
    replyList.append(card);
    replies.push({ id, author: { username: "m" + id }, createdAt: "2026-11-22T00:00:00Z" });
  }
  let callback = null;
  const observed = [];
  class FakeObserver {
    constructor(fn) { callback = fn; }
    observe(node) { observed.push(node); }
    disconnect() {}
  }
  const nav = createThreadOutline(document, replies, replyList, { Observer: FakeObserver });
  assert.equal(observed.length, 8);
  nav.isConnected = true;
  callback([{ target: observed[2], isIntersecting: true }]);
  const active = nav.querySelectorAll(".thread-outline-entry-active");
  assert.equal(active.length, 1);
  assert.equal(active[0].dataset.replyId, "3");
  callback([{ target: observed[2], isIntersecting: false }, { target: observed[5], isIntersecting: true }]);
  assert.equal(nav.querySelectorAll(".thread-outline-entry-active")[0].dataset.replyId, "6");
});

// ---------------------------------------------------------------- lists

test("AutoAnimate runs once per reply list, poll and notification list; never under reduced motion", () => {
  const root = new FakeNode("main");
  const replies = new FakeNode("div");
  replies.className = "post-list replies-list";
  const poll = new FakeNode("div");
  poll.className = "post-poll";
  const notifications = new FakeNode("ul");
  const item = new FakeNode("li");
  item.className = "notification-item";
  notifications.append(item);
  root.append(replies, poll, notifications);
  assert.equal(motionTargets(root).length, 3);
  const animated = [];
  animateLists(root, { autoAnimate: (node) => animated.push(node), win: motionOk });
  animateLists(root, { autoAnimate: (node) => animated.push(node), win: motionOk });
  assert.equal(animated.length, 3);
  const none = [];
  const fresh = new FakeNode("main");
  const list = new FakeNode("div");
  list.className = "replies-list";
  fresh.append(list);
  animateLists(fresh, { autoAnimate: (node) => none.push(node), win: noMotion });
  assert.deepEqual(none, []);
});

// ---------------------------------------------------------------- tables

test("makeTablesSortable enhances the leaderboard and desk tables once each", () => {
  assert.ok(SORTABLE_TABLE_SELECTOR.includes("table.leaderboard-table"));
  assert.ok(SORTABLE_TABLE_SELECTOR.includes("table.visits-table"));
  const root = new FakeNode("main");
  const table = new FakeNode("table");
  table.className = "leaderboard-table";
  root.append(table);
  const made = [];
  function Tablesort(node) { made.push(node); }
  makeTablesSortable(root, { Tablesort });
  makeTablesSortable(root, { Tablesort });
  assert.deepEqual(made, [table]);
});

// A minimal table for the real vendored tablesort: headers only, so a click
// sets aria-sort and the body sort is skipped (rows < 2).
function fakeTable() {
  const cell = (index) => {
    const attrs = {};
    const listeners = {};
    return {
      cellIndex: index, attrs, listeners, tabIndex: -1,
      setAttribute: (key, value) => { attrs[key] = String(value); },
      getAttribute: (key) => (key in attrs ? attrs[key] : null),
      hasAttribute: (key) => key in attrs,
      removeAttribute: (key) => { delete attrs[key]; },
      addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
      fire(type, event = {}) { for (const fn of listeners[type] ?? []) fn.call(this, { preventDefault() {}, ...event }); },
    };
  };
  const head = { cells: [cell(0), cell(1)], getAttribute: () => null };
  return { tagName: "TABLE", rows: [head], tHead: { rows: [head] }, tBodies: [{ rows: [] }], dispatchEvent() {}, head };
}

test("real tablesort: headers become keyboard-reachable columnheaders and aria-sort follows clicks and Enter", () => {
  const context = vm.createContext({ CustomEvent: class { constructor(name) { this.type = name; } } });
  context.window = context;
  vm.runInContext(read("public/js/vendor/tablesort.min.js"), context);
  vm.runInContext(read("public/js/vendor/tablesort.number.min.js"), context);
  const table = fakeTable();
  context.Tablesort(table);
  const [first, second] = table.head.cells;
  assert.equal(first.attrs.role, "columnheader");
  assert.equal(first.tabIndex, 0);
  first.fire("click");
  assert.equal(first.attrs["aria-sort"], "ascending");
  first.fire("keydown", { key: "Enter" });
  assert.equal(first.attrs["aria-sort"], "descending");
  second.fire("click");
  assert.equal(first.attrs["aria-sort"], undefined);
  assert.equal(second.attrs["aria-sort"], "ascending");
});

test("the leaderboard is a table: scoped headers, number sort on counts, score counts up", () => {
  const document = makeFakeDocument();
  const table = createLeaderboardTable(document, [
    { username: "ana", threads: 3, replies: 9, reactionsReceived: 4, score: 1200 },
    { username: "bo", threads: 1, replies: 2, reactionsReceived: 0, score: 40 },
  ]);
  assert.equal(table.tagName, "TABLE");
  assert.match(table.className, /leaderboard-table/);
  const headers = table.querySelectorAll("th");
  assert.equal(headers.length, 6);
  for (const th of headers) assert.equal(th.getAttribute("scope"), "col");
  assert.equal(headers[1].getAttribute("data-sort-method"), null, "member sorts as text");
  for (const index of [0, 2, 3, 4, 5]) assert.equal(headers[index].getAttribute("data-sort-method"), "number");
  assert.equal(table.querySelectorAll("tr").length, 3, "one header row + two body rows");
  const score = table.querySelectorAll(".leaderboard-score");
  assert.equal(score[0].getAttribute("data-count-up"), "1200");
  assert.equal(score[0].getAttribute("data-sort"), "1200");
  assert.equal(table.querySelectorAll("a")[0].getAttribute("href"), "/users/ana");
});

// ---------------------------------------------------------------- counters

test("CountUp ticks each [data-count-up] once; reduced motion leaves the static number", () => {
  const root = new FakeNode("main");
  const cell = new FakeNode("td");
  cell.setAttribute("data-count-up", "1200");
  cell.textContent = "1200";
  root.append(cell);
  const started = [];
  class CountUp {
    constructor(node, end) { this.node = node; this.end = end; }
    start() { started.push([this.node, this.end]); }
  }
  countUpStats(root, { CountUp, win: motionOk });
  countUpStats(root, { CountUp, win: motionOk });
  assert.deepEqual(started, [[cell, 1200]]);
  const still = new FakeNode("main");
  const other = new FakeNode("td");
  other.setAttribute("data-count-up", "5");
  still.append(other);
  countUpStats(still, { CountUp, win: noMotion });
  assert.equal(started.length, 1);
});

// ---------------------------------------------------------------- headroom

test("Headroom only on small screens, frozen while focus is inside, still under reduced motion", () => {
  const made = [];
  class Headroom {
    constructor(node, options) { this.node = node; this.options = options; this.log = []; made.push(this); }
    init() { this.log.push("init"); }
    pin() { this.log.push("pin"); }
    freeze() { this.log.push("freeze"); }
    unfreeze() { this.log.push("unfreeze"); }
  }
  const header = new FakeNode("header");
  const wide = { matchMedia: () => ({ matches: false }) };
  assert.equal(initHeadroom(header, { Headroom, win: wide }), null);
  const small = { matchMedia: (query) => ({ matches: query === HEADROOM_QUERY }) };
  const headroom = initHeadroom(header, { Headroom, win: small });
  assert.equal(made.length, 1);
  assert.deepEqual(headroom.log, ["init"]);
  header.dispatch("focusin", { target: header });
  assert.deepEqual(headroom.log, ["init", "pin", "freeze"]);
  header.dispatch("focusout", { target: header, relatedTarget: null });
  assert.equal(headroom.log.at(-1), "unfreeze");
  assert.equal(header.classList.contains("headroom-still"), false);
  const still = new FakeNode("header");
  initHeadroom(still, { Headroom, win: { matchMedia: () => ({ matches: true }) } });
  assert.equal(still.classList.contains("headroom-still"), true);
});

// ---------------------------------------------------------------- wiring

test("app.js runs the progress bar around each route and enhances the page after it", () => {
  const app = read("public/js/app.js");
  assert.match(app, /routeProgress\.start\(\)/);
  assert.match(app, /routeProgress\.done\(\)/);
  assert.match(app, /enhanceRoute\(main\)/);
  assert.match(app, /initGlobalKeys\(/);
  assert.match(app, /initHeaderHeadroom\(/);
  assert.match(app, /initTooltips\(document/);
  const pages = read("public/js/routes/pages.js");
  assert.match(pages, /createLeaderboardTable\(document, rows\)/);
});

test("styles: progress bar, tooltip and headroom rules exist and respect reduced motion", () => {
  const css = read("public/styles.css");
  assert.match(css, /#nprogress \.bar/);
  assert.match(css, /\.forum-tooltip/);
  assert.match(css, /\.thread-outline-entry-active/);
  assert.match(css, /\.headroom--unpinned/);
  const reduced = css.split("@media (prefers-reduced-motion: reduce)").slice(1).join("");
  assert.match(reduced, /#nprogress/);
  assert.match(reduced, /\.headroom/);
});

// ---------------------------------------------------------------- strings

const UX_KEYS = ["ux.keysHome", "ux.keysChat", "ux.keysSearch", "ux.keysHelp", "ux.keysToggle",
  "ux.lbRank", "ux.lbMember", "ux.lbThreads", "ux.lbScore"];

test("every locale carries the ux.* keys in one contiguous block, translated off English", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const file of readdirSync(new URL("public/locales/", ROOT))) {
    const table = JSON.parse(read("public/locales/" + file));
    const keys = Object.keys(table);
    assert.deepEqual(keys.filter((key) => UX_KEYS.includes(key)), UX_KEYS, file + " has the Batch J ux.* keys in order");
    const start = keys.indexOf(UX_KEYS[0]);
    assert.deepEqual(keys.slice(start, start + UX_KEYS.length), UX_KEYS, file + " block is contiguous");
    for (const key of UX_KEYS) assert.ok(typeof table[key] === "string" && table[key].trim(), file + " " + key);
    if (file !== "en.json") {
      const same = UX_KEYS.filter((key) => table[key] === en[key]);
      assert.ok(same.length <= 2, file + " is translated (identical to English: " + same.join(", ") + ")");
    }
  }
});
