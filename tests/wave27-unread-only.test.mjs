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

// Wave 2026-11-21-27 F2 (v4.32): "Unread only" on the chat list. A checkbox
// beside the quick filter narrows the loaded DM and group rows to the ones
// with unread messages. Page-view only: nothing stored, nothing sent, reset
// when the panel closes. Muted chats still list (mute quiets only the badge).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onlyUnread } from "../public/js/chat-filter.js";
import { LOCALES } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const NEW_KEYS = ["chat.unreadOnly", "chat.noUnreadChats"];

const ROWS = [
  { id: 1, unread: 0 },
  { id: 2, unread: 3 },
  { id: 3, kind: "group", unread: 1 },
  { id: 4 },
  { id: 5, unread: "2" },
];

test("onlyUnread off keeps every row in a NEW array", () => {
  const out = onlyUnread(ROWS, false);
  assert.deepEqual(out, ROWS);
  assert.notEqual(out, ROWS);
});

test("onlyUnread on keeps rows with unread > 0 (numeric strings count), order kept, input untouched", () => {
  const before = JSON.stringify(ROWS);
  assert.deepEqual(onlyUnread(ROWS, true).map((row) => row.id), [2, 3, 5]);
  assert.equal(JSON.stringify(ROWS), before);
});

test("onlyUnread tolerates junk input", () => {
  assert.deepEqual(onlyUnread(null, true), []);
  assert.deepEqual(onlyUnread(undefined, false), []);
  assert.deepEqual(onlyUnread([null, { unread: -1 }, { unread: NaN }], true), []);
});

test("wiring: the checkbox beside the filter, the list narrowing, the empty line and the close reset", () => {
  const threads = read("public/js/chat-widget-threads.js");
  assert.match(threads, /onlyUnread\(filterConversations\(/);
  assert.match(threads, /ui\.listUnreadOnly/);
  assert.match(threads, /chat-widget-unread-only/);
  assert.match(threads, /\.type = "checkbox"/);
  assert.match(threads, /t\("chat\.noUnreadChats"\)/);
  assert.match(read("public/js/chat-widget-state.js"), /listUnreadOnly: false/);
  assert.match(read("public/js/chat-widget.js"), /ui\.listUnreadOnly = false;/);
});

test("page-view only: the filter module stores and sends nothing", () => {
  assert.doesNotMatch(read("public/js/chat-filter.js"), /localStorage|sessionStorage|\bapi\(|fetch\(|innerHTML/);
});

test("new strings exist in en and are translated in all 20 locales", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of NEW_KEYS) assert.equal(typeof en[key], "string", key);
  const others = LOCALES.map((locale) => locale.code).filter((code) => code !== "en");
  assert.equal(others.length, 40);
  for (const code of others) {
    const bag = JSON.parse(read(`public/locales/${code}.json`));
    for (const key of NEW_KEYS) {
      assert.equal(typeof bag[key], "string", `${code} ${key}`);
      assert.notEqual(bag[key], en[key], `${code} ${key} is translated`);
    }
  }
});
