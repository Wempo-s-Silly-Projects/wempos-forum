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

// Wave 5.9 F1: the "New messages" line in an open DM or group chat. Picked
// from the conversation payload's own unread count on a fresh open, kept
// across the 5s silent repaint, never stored and never sent anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_NEW_MARKER, buildNewDivider, firstUnreadId, newMarkerFor } from "../public/js/chat-new-divider.js";
import { tn } from "../public/js/i18n.js";
import { makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
// Newest-first, the API's order.
const MESSAGES = [
  { id: 9, mine: false }, { id: 8, mine: true }, { id: 7, mine: false },
  { id: 6, mine: false }, { id: 5, mine: true },
];

test("firstUnreadId: the oldest of the newest unread messages from others", () => {
  assert.equal(firstUnreadId(MESSAGES, 1), 9);
  assert.equal(firstUnreadId(MESSAGES, 2), 7);
  assert.equal(firstUnreadId(MESSAGES, 3), 6);
});

test("firstUnreadId: own messages never count, unread past the page clamps to the oldest loaded", () => {
  assert.equal(firstUnreadId(MESSAGES, 50), 6);
  assert.equal(firstUnreadId([{ id: 3, mine: true }], 2), null);
});

test("firstUnreadId: zero, negative, junk counts or no messages give null", () => {
  for (const count of [0, -1, Number.NaN, "x", undefined]) assert.equal(firstUnreadId(MESSAGES, count), null);
  assert.equal(firstUnreadId([], 3), null);
  assert.equal(firstUnreadId(undefined, 3), null);
});

test("firstUnreadId never mutates the payload", () => {
  const copy = MESSAGES.map((row) => ({ ...row }));
  firstUnreadId(MESSAGES, 3);
  assert.deepEqual(MESSAGES, copy);
});

test("newMarkerFor keys the marker by conversation and clears on zero unread", () => {
  assert.deepEqual(newMarkerFor("dm:4", { unread: 2, messages: MESSAGES }), { key: "dm:4", id: 7, count: 2 });
  assert.deepEqual(newMarkerFor("group:2", { unread: 0, messages: MESSAGES }), NO_NEW_MARKER);
  assert.deepEqual(newMarkerFor("dm:4", { unread: 2, messages: [{ id: 1, mine: true }] }), NO_NEW_MARKER);
  assert.ok(Object.isFrozen(NO_NEW_MARKER));
});

test("buildNewDivider is a text-only separator", () => {
  const divider = buildNewDivider(makeFakeDocument(), 3);
  assert.equal(divider.className, "chat-widget-new-divider");
  assert.equal(divider.getAttribute("role"), "separator");
  assert.equal(divider.textContent, tn("dm.newMessages", 3));
  const en = JSON.parse(read("public/locales/en.json"));
  assert.equal(en["dm.newMessages.one"], "{count} new message");
  assert.equal(en["dm.newMessages.other"], "{count} new messages");
});

test("the module touches no storage and no network", () => {
  const source = read("public/js/chat-new-divider.js");
  assert.doesNotMatch(source, /localStorage|sessionStorage|api\(|fetch\(|innerHTML/);
  assert.match(source, /tn\("dm\.newMessages"/);
});

test("composer wiring: only a fresh open sets the marker; the paint draws it before that bubble", () => {
  const source = read("public/js/chat-widget-composer.js");
  assert.match(source, /if \(!silent\) ui\.newSince = newMarkerFor\(conversationKey\(thread\), data\)/);
  assert.match(source, /ui\.newSince\.key === key && Number\(message\.id\) === Number\(ui\.newSince\.id\)/);
  assert.match(source, /scroll\.append\(buildNewDivider\(document, ui\.newSince\.count\)\)/);
  assert.match(read("public/js/chat-widget-state.js"), /newSince: NO_NEW_MARKER/);
});
