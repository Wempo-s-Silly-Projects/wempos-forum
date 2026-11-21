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

// Wave 24 F1a (privacy): sign-out wipes every account-scoped local key family
// even when the logout POST fails (network error or 5xx), and the member
// still sees the error. Drives the real ACTIONS.logout through a fake DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const fakeStorage = (entries) => {
  const map = new Map(entries);
  return {
    get length() { return map.size; },
    key: (index) => Array.from(map.keys())[index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    keys: () => Array.from(map.keys()).sort(),
  };
};

// One key per account-scoped family (scoped + legacy unscoped), plus device
// preferences that must survive sign-out.
const ACCOUNT_KEYS = [
  "forum-draft:u7:reply:12",
  "forum-draft:post:new",
  "forum-seen-replies",
  "forum-seen-replies:u7",
  "forum-chat-pins",
  "forum-chat-pins:u7",
  "forum-gallery-recents:u7",
  "forum-newcomer-dismissed:u7",
];
const DEVICE_KEYS = ["forum-theme", "forum-text-size", "wempo-locale", "wempo-dm-effects"];

const assigned = [];
globalThis.document = { ...makeFakeDocument(), querySelector: () => new FakeNode("div") };
globalThis.window = {
  location: { assign: (url) => assigned.push(url), origin: "https://wempos-forum.com", hostname: "wempos-forum.com" },
};
const { ACTIONS } = await import("../public/js/routes/account-nav.js");

const arrange = (fetchImpl) => {
  const storage = fakeStorage([...ACCOUNT_KEYS, ...DEVICE_KEYS].map((key) => [key, "x"]));
  globalThis.localStorage = storage;
  globalThis.fetch = fetchImpl;
  assigned.length = 0;
  return storage;
};

test("logout network error still wipes every account-scoped local key and surfaces the error", async () => {
  const storage = arrange(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(ACTIONS.logout(), /Failed to fetch/);
  assert.deepEqual(storage.keys(), [...DEVICE_KEYS].sort());
  assert.equal(assigned.length, 0, "a failed sign-out must not pretend success");
});

test("logout 5xx still wipes every account-scoped local key and surfaces the error", async () => {
  const storage = arrange(async () => new Response(JSON.stringify({ error: "Server exploded" }), {
    status: 503, headers: { "Content-Type": "application/json" },
  }));
  await assert.rejects(ACTIONS.logout(), (error) => error.status === 503 && /Server exploded/.test(error.message));
  assert.deepEqual(storage.keys(), [...DEVICE_KEYS].sort());
  assert.equal(assigned.length, 0);
});

test("successful logout wipes the same families and hands off to Accounts sign-out", async () => {
  const storage = arrange(async () => new Response(null, { status: 204 }));
  await ACTIONS.logout();
  assert.deepEqual(storage.keys(), [...DEVICE_KEYS].sort());
  assert.equal(assigned.length, 1);
  assert.match(assigned[0], /signout=1/);
});
