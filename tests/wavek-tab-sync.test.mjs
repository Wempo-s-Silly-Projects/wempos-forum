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

// Batch K item 5: one in-page event bus (the vendored nanoevents) carries the
// unread counts from the bell and the chat widget to the favicon badge, plus
// sign-out and theme changes; tab-sync.js bridges that bus to the native
// BroadcastChannel so sign-out, theme and unread counts follow across tabs.
// Remote events arrive under their own names, so a tab never re-broadcasts
// what it just heard (no ping-pong between tabs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNanoEvents } from "../public/js/vendor/nanoevents.js";
import { EVENTS, bus } from "../public/js/event-bus.js";
import { TAB_SYNC_CHANNEL, createTabSync } from "../public/js/tab-sync.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// An in-memory BroadcastChannel: every instance with the same name except
// the sender receives each message, as in browsers.
function channelFactory() {
  const open = new Set();
  const posted = [];
  class FakeChannel {
    constructor(name) { this.name = name; this.onmessage = null; open.add(this); }
    postMessage(data) {
      posted.push(data);
      for (const other of open) if (other !== this && other.name === this.name) other.onmessage?.({ data: structuredClone(data) });
    }
    close() { open.delete(this); }
  }
  return { FakeChannel, posted, open };
}

function twoTabs() {
  const { FakeChannel, posted, open } = channelFactory();
  const busA = createNanoEvents();
  const busB = createNanoEvents();
  const syncA = createTabSync({ bus: busA, Channel: FakeChannel });
  const syncB = createTabSync({ bus: busB, Channel: FakeChannel });
  return { busA, busB, syncA, syncB, posted, open };
}

test("event-bus.js is one shared nanoevents instance with named events", () => {
  assert.equal(typeof bus.on, "function");
  assert.equal(typeof bus.emit, "function");
  for (const name of ["unread", "remoteUnread", "signout", "remoteSignout", "theme", "remoteTheme"]) {
    assert.equal(typeof EVENTS[name], "string", name);
  }
  assert.ok(Object.isFrozen(EVENTS));
  assert.match(read("public/js/event-bus.js"), /from "\.\/vendor\/nanoevents\.js"/);
});

test("sign-out in one tab reaches the other tab as remoteSignout", () => {
  const { busA, busB, posted } = twoTabs();
  const heard = [];
  busB.on(EVENTS.remoteSignout, () => heard.push("B"));
  busA.on(EVENTS.remoteSignout, () => heard.push("A"));
  busA.emit(EVENTS.signout);
  assert.deepEqual(heard, ["B"]);
  assert.deepEqual(posted, [{ type: "signout" }]);
  assert.equal(TAB_SYNC_CHANNEL, "wempos-forum-sync");
});

test("theme changes cross tabs; anything but light/dark is ignored", () => {
  const { busA, busB, syncA } = twoTabs();
  const themes = [];
  busB.on(EVENTS.remoteTheme, (theme) => themes.push(theme));
  busA.emit(EVENTS.theme, "dark");
  busA.emit(EVENTS.theme, "url(javascript:alert(1))");
  assert.deepEqual(themes, ["dark"]);
  assert.ok(syncA);
});

test("unread counts cross tabs without echoing back and forth", () => {
  const { busA, busB, posted } = twoTabs();
  const seenB = [];
  // Tab B's bell repaints on the remote count, which emits a local unread —
  // exactly what updateBell() does. That must not bounce back to tab A.
  busB.on(EVENTS.remoteUnread, (source, count) => { seenB.push([source, count]); busB.emit(EVENTS.unread, source, count); });
  busA.emit(EVENTS.unread, "notifications", 3);
  busA.emit(EVENTS.unread, "notifications", 3);
  busA.emit(EVENTS.unread, "dms", 2);
  assert.deepEqual(seenB, [["notifications", 3], ["dms", 2]]);
  assert.deepEqual(posted, [
    { type: "unread", source: "notifications", count: 3 },
    { type: "unread", source: "dms", count: 2 },
  ]);
});

test("malformed messages are dropped", () => {
  const { FakeChannel } = channelFactory();
  const local = createNanoEvents();
  createTabSync({ bus: local, Channel: FakeChannel });
  const heard = [];
  for (const name of [EVENTS.remoteUnread, EVENTS.remoteTheme, EVENTS.remoteSignout]) local.on(name, (...args) => heard.push([name, ...args]));
  const sender = new FakeChannel(TAB_SYNC_CHANNEL);
  for (const data of [null, "signout", { type: "unread", source: "bell", count: 2 }, { type: "unread", source: "dms", count: -1 },
    { type: "unread", source: "dms", count: 1.5 }, { type: "theme", theme: 3 }, { type: "nope" }]) {
    sender.postMessage(data);
  }
  assert.deepEqual(heard, []);
});

test("no BroadcastChannel (old browser) means no sync and no crash; close() detaches", () => {
  assert.equal(createTabSync({ bus: createNanoEvents(), Channel: null }), null);
  assert.equal(createTabSync({ bus: createNanoEvents(), Channel: class { constructor() { throw new Error("blocked"); } } }), null);
  const { busA, syncA, posted, open } = twoTabs();
  syncA.close();
  busA.emit(EVENTS.signout);
  assert.deepEqual(posted, []);
  assert.equal(open.size, 1);
});

test("the bell, the chat widget and app.js publish unread counts on the bus; the badge subscribes", () => {
  for (const path of ["public/js/notifications.js", "public/js/chat-widget-threads.js", "public/js/app.js"]) {
    const source = read(path);
    assert.match(source, /bus\.emit\(EVENTS\.unread, "(?:notifications|dms)"/, path);
    assert.doesNotMatch(source, /setTabBadgeCount\(/, path);
  }
  const badge = read("public/js/tab-badge.js");
  assert.match(badge, /bus\.on\(EVENTS\.unread, setTabBadgeCount\)/);
  assert.match(badge, /bus\.on\(EVENTS\.remoteUnread, setTabBadgeCount\)/);
});

test("the theme toggle announces its choice and applies a remote one", () => {
  const theme = read("public/js/theme.js");
  assert.match(theme, /bus\.emit\(EVENTS\.theme, next\)/);
  assert.match(theme, /bus\.on\(EVENTS\.remoteTheme,/);
});

test("app.js starts the tab sync and reloads on a remote sign-out", () => {
  const app = read("public/js/app.js");
  assert.match(app, /createTabSync\(\{ bus \}\)/);
  assert.match(app, /bus\.on\(EVENTS\.remoteSignout,/);
  assert.match(app, /bus\.on\(EVENTS\.remoteUnread,/);
});

test("logout announces the sign-out on the bus after the local wipe", async () => {
  globalThis.document = { ...makeFakeDocument(), querySelector: () => new FakeNode("div") };
  globalThis.window = {
    location: { assign: () => {}, origin: "https://wempos-forum.com", hostname: "wempos-forum.com" },
  };
  globalThis.localStorage = { length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const { ACTIONS } = await import("../public/js/routes/account-nav.js");
  let announced = 0;
  const off = bus.on(EVENTS.signout, () => { announced += 1; });
  await ACTIONS.logout();
  off();
  assert.equal(announced, 1);
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const offAgain = bus.on(EVENTS.signout, () => { announced += 1; });
  await assert.rejects(ACTIONS.logout());
  offAgain();
  assert.equal(announced, 1, "a failed sign-out is not announced: the session is still live");
});
