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

// Wave 5.36 client: search filter chips (?since=&sort= in the URL), recent
// searches (localStorage only, account-scoped, cap 8, dedupe, clear, wiped
// on sign-out), and the in-conversation search box (results by textContent,
// jump to a loaded message or page older until it loads).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { routeForPath } from "../public/js/router.js";
import {
  SEARCH_SINCE, SEARCH_SORTS, createSearchFilters, searchApiPath, searchPagePath,
} from "../public/js/search-filters.js";
import {
  MAX_RECENT_SEARCHES, RECENT_SEARCHES_KEY, attachRecentSearches, clearAllRecentSearches,
  clearRecentSearches, readRecentSearches, rememberSearch,
} from "../public/js/recent-searches.js";
import {
  CHAT_JUMP_MAX_PAGES, buildChatSearch, chatSearchPath, jumpToMessage,
} from "../public/js/chat-search.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["search.sinceLabel", "search.sinceAny", "search.sinceWeek", "search.sinceMonth", "search.sinceYear",
  "search.sortLabel", "search.sortRelevant", "search.sortNew", "search.recentTitle", "search.recentClear",
  "chat.searchLabel", "chat.searchPlaceholder", "chat.searchNoMatches"];

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    map,
  };
}

const brokenStorage = () => ({
  get length() { throw new Error("SecurityError"); },
  key() { throw new Error("SecurityError"); },
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); },
  removeItem() { throw new Error("SecurityError"); },
});

// ---- F1: filters -----------------------------------------------------------

test("the router carries only known since/sort values on a search; /?q= alone is unchanged", () => {
  assert.deepEqual(SEARCH_SINCE, ["any", "week", "month", "year"]);
  assert.deepEqual(SEARCH_SORTS, ["relevant", "new"]);
  assert.deepEqual(routeForPath("/", "?q=cats"), { name: "search", query: "cats" });
  assert.deepEqual(routeForPath("/", "?q=cats&view=new"), { name: "search", query: "cats" });
  assert.deepEqual(routeForPath("/", "?q=cats&since=week&sort=new"),
    { name: "search", query: "cats", since: "week", sort: "new" });
  assert.deepEqual(routeForPath("/", "?q=cats&since=any&sort=relevant"), { name: "search", query: "cats" });
  assert.deepEqual(routeForPath("/", "?q=cats&since=decade&sort=__proto__"), { name: "search", query: "cats" });
  assert.deepEqual(routeForPath("/", "?since=week"), { name: "home" });
});

test("search URLs are built with the URL API and omit defaults", () => {
  assert.equal(searchPagePath("cats & dogs"), "/?q=cats+%26+dogs");
  assert.equal(searchPagePath("a/b?#", { since: "month", sort: "new" }), "/?q=a%2Fb%3F%23&since=month&sort=new");
  assert.equal(searchPagePath("x", { since: "any", sort: "relevant" }), "/?q=x");
  assert.equal(searchPagePath("x", { since: "evil", sort: "javascript:" }), "/?q=x");
  assert.equal(searchApiPath({ query: "cats" }), "/api/search?q=cats&in=replies");
  assert.equal(searchApiPath({ query: "c&d", since: "year", sort: "new" }),
    "/api/search?q=c%26d&in=replies&since=year&sort=new");
});

test("the filter chips are app-link anchors keeping the query and the other filter", () => {
  const nav = createSearchFilters(makeFakeDocument(), { query: "cats", since: "week" });
  const groups = [...nav.children];
  assert.equal(groups.length, 2);
  for (const group of groups) assert.ok(group.getAttribute("aria-label"));
  const [since, sort] = groups.map((group) => [...group.children]);
  assert.deepEqual(since.map((chip) => chip.href),
    ["/?q=cats", "/?q=cats&since=week", "/?q=cats&since=month", "/?q=cats&since=year"]);
  assert.deepEqual(sort.map((chip) => chip.href), ["/?q=cats&since=week", "/?q=cats&since=week&sort=new"]);
  for (const chip of [...since, ...sort]) assert.ok(chip.hasAttribute("data-app-link"));
  assert.deepEqual(since.map((chip) => chip.getAttribute("aria-current")), [null, "page", null, null]);
  assert.deepEqual(sort.map((chip) => chip.getAttribute("aria-current")), ["page", null]);
  // Labels go through t() (no table loaded under node: t answers the key).
  assert.deepEqual(since.map((chip) => chip.textContent),
    ["search.sinceAny", "search.sinceWeek", "search.sinceMonth", "search.sinceYear"]);
  assert.deepEqual(sort.map((chip) => chip.textContent), ["search.sortRelevant", "search.sortNew"]);
});

test("the search route fetches with the filters and paints the chips", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /searchApiPath\(route\)/);
  assert.match(feed, /createSearchFilters\(document, route\)/);
});

// ---- F3: recent searches ---------------------------------------------------

test("recent searches: account-scoped, newest first, deduped, capped at 8, nothing for guests", () => {
  const storage = memoryStorage();
  assert.equal(MAX_RECENT_SEARCHES, 8);
  assert.deepEqual(rememberSearch(storage, null, "guest query"), []);
  assert.equal(storage.map.size, 0, "a guest stores nothing");
  for (let i = 0; i < 10; i += 1) rememberSearch(storage, 7, "query " + i);
  rememberSearch(storage, 7, "  Query 5 ");
  const list = readRecentSearches(storage, 7);
  assert.equal(list.length, 8);
  assert.equal(list[0], "Query 5");
  assert.equal(list.filter((q) => q.toLowerCase() === "query 5").length, 1, "deduped case-insensitively");
  assert.deepEqual(list.slice(1, 3), ["query 9", "query 8"]);
  assert.ok(storage.map.has(RECENT_SEARCHES_KEY + ":u7"));
  assert.deepEqual(readRecentSearches(storage, 8), [], "another account sees nothing");
  rememberSearch(storage, 7, "   ");
  rememberSearch(storage, 7, "z".repeat(101));
  assert.equal(readRecentSearches(storage, 7)[0], "Query 5", "blank or over-long queries are skipped");
});

test("recent searches: clear one account, wipe all on sign-out, silent on broken storage", () => {
  const storage = memoryStorage({ "forum-theme": "dark", [RECENT_SEARCHES_KEY + ":u1"]: "[\"a\"]",
    [RECENT_SEARCHES_KEY + ":u2"]: "[\"b\"]" });
  clearRecentSearches(storage, 1);
  assert.deepEqual(readRecentSearches(storage, 1), []);
  assert.deepEqual(readRecentSearches(storage, 2), ["b"]);
  clearAllRecentSearches(storage);
  assert.deepEqual([...storage.map.keys()], ["forum-theme"]);
  storage.setItem(RECENT_SEARCHES_KEY + ":u3", "{not json");
  assert.deepEqual(readRecentSearches(storage, 3), []);
  storage.setItem(RECENT_SEARCHES_KEY + ":u3", JSON.stringify([1, "ok", null, "x".repeat(200)]));
  assert.deepEqual(readRecentSearches(storage, 3), ["ok"]);
  const broken = brokenStorage();
  assert.doesNotThrow(() => rememberSearch(broken, 1, "q"));
  assert.deepEqual(readRecentSearches(broken, 1), []);
  assert.doesNotThrow(() => clearRecentSearches(broken, 1));
  assert.doesNotThrow(() => clearAllRecentSearches(broken));
  assert.doesNotThrow(() => rememberSearch(null, 1, "q"));
});

test("recent searches are registered in the sign-out wipe and the site search remembers locally", () => {
  const nav = read("public/js/routes/account-nav.js");
  assert.match(nav, /import \{ clearAllRecentSearches \} from "\.\.\/recent-searches\.js";/);
  const wipe = nav.match(/function wipeAccountLocalData\(\)\s*\{([\s\S]*?)\n\}/)[1];
  assert.match(wipe, /clearAllRecentSearches\(\)/);
  assert.match(read("public/js/routes/pages.js"), /rememberSearch\(/);
  assert.doesNotMatch(read("public/js/recent-searches.js"), /api\(|fetch\(|sessionStorage/);
});

function searchBox(accountId, storage) {
  const document = makeFakeDocument();
  const form = new FakeNode("form");
  const input = new FakeNode("input");
  form.append(input);
  const wrap = new FakeNode("search");
  wrap.append(form);
  const navigated = [];
  const panel = attachRecentSearches(document, input, {
    storage, getAccountId: () => accountId, navigate: (path) => navigated.push(path),
  });
  return { document, input, panel, navigated, wrap };
}

test("chips show on focus when the box is empty; a chip searches again; Clear empties the list", () => {
  const storage = memoryStorage();
  for (const q of ["cats", "dogs & co"]) rememberSearch(storage, 4, q);
  const { input, panel, navigated } = searchBox(4, storage);
  assert.equal(panel.hidden, true);
  input.dispatch("focus", {});
  assert.equal(panel.hidden, false);
  const chips = findByClass(panel, "recent-searches-list").children;
  assert.deepEqual([...chips].map((node) => node.textContent), ["dogs & co", "cats"]);
  assert.ok(panel.getAttribute("aria-label") || findByClass(panel, "recent-searches-title"));
  input.value = "typed";
  input.dispatch("input", {});
  assert.equal(panel.hidden, true, "hidden while the box has text");
  input.value = "";
  input.dispatch("input", {});
  assert.equal(panel.hidden, false);
  chips[0].dispatch("click", { preventDefault() {} });
  assert.deepEqual(navigated, ["/?q=dogs+%26+co"]);
  assert.equal(readRecentSearches(storage, 4)[0], "dogs & co");
  input.dispatch("focus", {});
  findByClass(panel, "recent-searches-clear").dispatch("click", { preventDefault() {} });
  assert.deepEqual(readRecentSearches(storage, 4), []);
  assert.equal(panel.hidden, true);
  input.dispatch("focus", {});
  assert.equal(panel.hidden, true, "nothing to show once cleared");
});

test("guests and broken storage never show the panel", () => {
  const guest = searchBox(null, memoryStorage({ [RECENT_SEARCHES_KEY + ":u4"]: "[\"cats\"]" }));
  guest.input.dispatch("focus", {});
  assert.equal(guest.panel.hidden, true);
  const broken = searchBox(4, brokenStorage());
  assert.doesNotThrow(() => broken.input.dispatch("focus", {}));
  assert.equal(broken.panel.hidden, true);
});

// ---- F2: conversation search ----------------------------------------------

test("chatSearchPath builds the per-conversation route with the URL API", () => {
  assert.equal(chatSearchPath({ kind: "dm", id: 5 }, "50% off"), "/api/dm/threads/5/search?q=50%25+off");
  assert.equal(chatSearchPath({ kind: "group", id: 9 }, "a&b"), "/api/dm/groups/9/search?q=a%26b");
});

test("the chat search box queries at 2+ chars, paints results by textContent, and jumps on click", async () => {
  const document = makeFakeDocument();
  const calls = [];
  const jumps = [];
  const apiFn = async (path) => {
    calls.push(path);
    return { results: [{ id: 41, authorUsername: "bob", createdAt: "2026-11-20T10:00:00.000Z",
      maskedExcerpt: "<img src=x onerror=alert(1)> NEEDLE here" }] };
  };
  const box = buildChatSearch(document, { conversation: { kind: "group", id: 3 }, apiFn, onJump: (id) => jumps.push(id) });
  const input = findByClass(box, "chat-widget-search-input");
  assert.ok(input.getAttribute("aria-label"));
  input.value = "n";
  await box.runSearch();
  assert.deepEqual(calls, [], "one character never queries");
  input.value = "needle";
  await box.runSearch();
  assert.deepEqual(calls, ["/api/dm/groups/3/search?q=needle"]);
  const results = findByClass(box, "chat-widget-search-results");
  const hit = findByClass(results, "chat-widget-search-hit");
  assert.ok(hit.textContent.includes("bob"));
  assert.ok(hit.textContent.includes("<img src=x onerror=alert(1)>"), "user text is text, never markup");
  assert.ok(findByClass(hit, "search-hit"), "the match is highlighted");
  hit.dispatch("click", { preventDefault() {} });
  assert.deepEqual(jumps, [41]);
  input.value = "";
  await box.runSearch();
  assert.equal(results.children.length, 0, "clearing the box clears the results");
});

test("the chat search box says so when nothing matches and stays quiet on errors", async () => {
  const document = makeFakeDocument();
  const empty = buildChatSearch(document, { conversation: { id: 1 }, apiFn: async () => ({ results: [] }), onJump() {} });
  findByClass(empty, "chat-widget-search-input").value = "zz";
  await empty.runSearch();
  assert.ok(findByClass(empty, "chat-widget-search-empty"));
  const failing = buildChatSearch(document, { conversation: { id: 1 }, apiFn: async () => { throw new Error("x"); }, onJump() {} });
  findByClass(failing, "chat-widget-search-input").value = "zz";
  await assert.doesNotReject(failing.runSearch());
});

function messageList(ids) {
  const scroll = new FakeNode("div");
  for (const id of ids) {
    const bubble = new FakeNode("div");
    bubble.className = "chat-widget-message";
    bubble.setAttribute("data-message-id", String(id));
    bubble.scrollIntoView = (options) => { bubble.scrolled = options; };
    scroll.append(bubble);
  }
  return scroll;
}

test("jumpToMessage highlights a loaded message, else pages older until it loads (bounded)", async () => {
  let scroll = messageList([10, 11, 12]);
  assert.equal(await jumpToMessage(11, { getScroll: () => scroll, loadOlder: async () => false }), true);
  const target = [...scroll.children][1];
  assert.ok(target.classList.contains("chat-widget-message-hit"));
  assert.ok(target.scrolled);
  let pages = 0;
  const loadOlder = async () => {
    pages += 1;
    scroll = messageList([3 - pages, 4, 5, 10, 11, 12].filter((id) => pages >= 2 || id >= 10));
    return true;
  };
  scroll = messageList([10, 11, 12]);
  assert.equal(await jumpToMessage(4, { getScroll: () => scroll, loadOlder }), true);
  assert.equal(pages, 2);
  assert.equal(CHAT_JUMP_MAX_PAGES, 20);
  let tries = 0;
  assert.equal(await jumpToMessage(1, { getScroll: () => messageList([50]), loadOlder: async () => { tries += 1; return true; } }), false);
  assert.equal(tries, CHAT_JUMP_MAX_PAGES);
  tries = 0;
  assert.equal(await jumpToMessage(1, { getScroll: () => messageList([50]), loadOlder: async () => { tries += 1; return false; } }), false);
  assert.equal(tries, 1, "stops when no older page comes back");
});

test("the conversation marks every bubble with its id and mounts the search box", () => {
  const composer = read("public/js/chat-widget-composer.js");
  assert.match(composer, /setAttribute\("data-message-id", String\(message\.id\)\)/);
  assert.match(composer, /buildChatSearch\(/);
  assert.doesNotMatch(read("public/js/chat-search.js"), /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage/);
  assert.doesNotMatch(read("public/js/recent-searches.js"), /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(read("public/js/search-filters.js"), /innerHTML|outerHTML|insertAdjacentHTML/);
});

test("new strings ship in en and all 65 locales, translated", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  const files = ["aa", "ab", "af", "ak", "am", "ar", "az", "bg", "bn", "ca", "cs", "da", "de", "el", "es", "eu",
    "fa", "fi", "fil", "fr", "he", "hi", "hr", "hu", "id", "it", "ja", "ko", "ms", "nb", "nl", "pl", "pt", "ro",
    "ru", "sk", "sq", "sr", "sv", "sw", "ta", "th", "tr", "uk", "ur", "vi", "zh-Hans", "zh-Hant",
    "an", "hy", "as", "av", "ay", "bm", "ba", "be",
    "bi", "bs", "br", "my", "ch", "ce", "ny", "cv"];
  assert.equal(files.length + 1, 65);
  for (const key of NEW_KEYS) assert.ok(en[key], "en " + key);
  for (const code of files) {
    const table = JSON.parse(read("public/locales/" + code + ".json"));
    for (const key of NEW_KEYS) {
      assert.ok(table[key], code + " " + key);
      assert.notEqual(table[key], en[key], code + " " + key + " is English");
    }
  }
});
