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

// Wave 2026-11-21-26 (v4.31): (1) mute a chat — per-account, local-only,
// opt-in; a muted DM or group stops counting toward the launcher badge, and
// sign-out wipes the list; (2) the group creator's rename form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_MUTED_CHATS, MUTES_STORAGE_KEY, clearAllMutes, isMuted, mutesKey, readMutes, toggleMute,
  unmutedUnreadTotal, writeMutes,
} from "../public/js/chat-mutes.js";
import { buildGroupRename } from "../public/js/group-rename.js";
import { DM_GROUP_NAME_MAX_CHARS } from "../constants.mjs";
import { t, LOCALES } from "../public/js/i18n.js";
import { findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
    data,
  };
};
const throwing = {
  getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); }, get length() { throw new Error("blocked"); },
};
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const keyOf = (row) => (row.kind === "group" ? "group:" : "dm:") + row.id;

test("mutes are keyed per account (no id, no key) and round-trip through storage", () => {
  assert.equal(mutesKey(null), null);
  assert.equal(mutesKey(undefined), null);
  assert.equal(mutesKey(7), MUTES_STORAGE_KEY + ":u7");
  const storage = memoryStorage();
  writeMutes(storage, ["dm:1", "group:2"], 7);
  assert.deepEqual(readMutes(storage, 7), ["dm:1", "group:2"]);
  assert.deepEqual(readMutes(storage, 8), [], "another account sees none");
  writeMutes(storage, ["dm:9"], null);
  assert.equal(storage.data.size, 1, "no account id writes nothing");
});

test("toggleMute is immutable, adds then removes, and refuses past the cap", () => {
  const empty = [];
  const one = toggleMute(empty, "group:3");
  assert.deepEqual(empty, []);
  assert.deepEqual(one, ["group:3"]);
  assert.deepEqual(toggleMute(one, "group:3"), []);
  let full = [];
  for (let index = 0; index < MAX_MUTED_CHATS; index += 1) full = toggleMute(full, "dm:" + index);
  assert.equal(full.length, MAX_MUTED_CHATS);
  assert.equal(toggleMute(full, "dm:999"), full, "a full list returns the SAME list");
  assert.equal(toggleMute(full, "dm:0").length, MAX_MUTED_CHATS - 1, "unmute still works when full");
  assert.equal(isMuted(["dm:1"], "dm:1"), true);
  assert.equal(isMuted(["dm:1"], "group:1"), false);
  assert.equal(isMuted(null, "dm:1"), false);
});

test("corrupt, oversized or blocked storage reads as no mutes and never throws", () => {
  const storage = memoryStorage();
  storage.setItem(mutesKey(4), "{nope");
  assert.deepEqual(readMutes(storage, 4), []);
  storage.setItem(mutesKey(4), JSON.stringify(["dm:1", 5, "group:x", "<b>", "group:2"]));
  assert.deepEqual(readMutes(storage, 4), ["dm:1", "group:2"]);
  storage.setItem(mutesKey(4), JSON.stringify(Array.from({ length: 400 }, (_, index) => "dm:" + index)));
  assert.equal(readMutes(storage, 4).length, MAX_MUTED_CHATS);
  assert.deepEqual(readMutes(throwing, 4), []);
  assert.doesNotThrow(() => writeMutes(throwing, ["dm:1"], 4));
  assert.doesNotThrow(() => clearAllMutes(throwing));
});

test("unmutedUnreadTotal: muted rows stop counting, from the server total or the row sum", () => {
  const rows = [
    { kind: "dm", id: 1, unread: 3 }, { kind: "group", id: 1, unread: 4 }, { kind: "dm", id: 2, unread: 0 },
  ];
  assert.equal(unmutedUnreadTotal({ serverTotal: null, rows, mutes: [], keyOf }), 7);
  assert.equal(unmutedUnreadTotal({ serverTotal: null, rows, mutes: ["group:1"], keyOf }), 3);
  assert.equal(unmutedUnreadTotal({ serverTotal: 12, rows, mutes: ["dm:1"], keyOf }), 9,
    "rows on unloaded pages still count from the server total");
  assert.equal(unmutedUnreadTotal({ serverTotal: 2, rows, mutes: ["dm:1", "group:1"], keyOf }), 0, "never negative");
  assert.equal(unmutedUnreadTotal({ serverTotal: 5, rows: undefined, mutes: undefined, keyOf }), 5);
  assert.equal(rows[1].unread, 4, "rows are not mutated");
});

test("clearAllMutes wipes every account's mutes and leaves other keys", () => {
  const storage = memoryStorage();
  writeMutes(storage, ["dm:1"], 1);
  writeMutes(storage, ["dm:2"], 2);
  storage.setItem("forum-chat-pins:u1", "[]");
  clearAllMutes(storage);
  assert.deepEqual([...storage.data.keys()], ["forum-chat-pins:u1"]);
});

test("wiring: the badge, the header toggle, the row mark and the sign-out wipe", () => {
  const threads = read("public/js/chat-widget-threads.js");
  const composer = read("public/js/chat-widget-composer.js");
  assert.match(threads, /unmutedUnreadTotal\(/);
  assert.match(threads, /state\.currentUser\?\.id/, "the closed-panel badge knows the account");
  assert.match(threads, /chat-widget-thread-muted/);
  assert.match(composer, /toggleMute\(/);
  assert.match(composer, /chat-widget-mute/);
  assert.match(read("public/js/routes/account-nav.js"), /clearAllMutes\(\)/);
  assert.doesNotMatch(read("public/js/chat-mutes.js"), /innerHTML|\bapi\(|fetch\(/,
    "mutes never leave the browser");
});

const groupOf = (name) => ({ id: 3, name, canManage: true });

test("rename form: prefilled, capped, labelled; submit trims and hands the name to onSave", async () => {
  const doc = makeFakeDocument();
  const saved = [];
  const form = buildGroupRename(doc, groupOf("Old name"), { onSave: async (name) => { saved.push(name); } });
  const input = findByClass(form, "chat-widget-group-rename-input");
  assert.equal(input.value, "Old name");
  assert.equal(input.maxLength, DM_GROUP_NAME_MAX_CHARS);
  assert.equal(input.getAttribute("aria-label"), t("dm.groupNameLabel"));
  assert.equal(findByClass(form, "chat-widget-group-rename-send").textContent, t("dm.renameGroup"));
  input.value = "  Movie night  ";
  await form.fire("submit", { preventDefault() {} });
  assert.deepEqual(saved, ["Movie night"]);
  input.value = "";
  await form.fire("submit", { preventDefault() {} });
  assert.deepEqual(saved, ["Movie night", ""], "an empty name clears back to the member list");
});

test("rename form: an unchanged name sends nothing, and sends are single-flight", async () => {
  const doc = makeFakeDocument();
  let calls = 0;
  let release;
  const form = buildGroupRename(doc, groupOf("Same"), {
    onSave: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); },
  });
  const input = findByClass(form, "chat-widget-group-rename-input");
  const send = findByClass(form, "chat-widget-group-rename-send");
  await form.fire("submit", { preventDefault() {} });
  assert.equal(calls, 0);
  input.value = "New";
  form.dispatch("submit", { preventDefault() {} });
  form.dispatch("submit", { preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(send.disabled, true);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(send.disabled, false);
});

test("rename wiring: only the creator's strip carries the form, via PATCH through api()", () => {
  const extras = read("public/js/dm-extras.js");
  assert.match(extras, /if \(group\.canManage\) \{[\s\S]*buildGroupRename\(document/);
  assert.match(extras, /method: "PATCH"/);
  assert.doesNotMatch(read("public/js/group-rename.js"), /innerHTML|\bapi\(|fetch\(/);
  assert.match(read("public/js/chat-widget-composer.js"), /chat-widget-group-rename-input/,
    "a half-typed rename survives the 5s repaint");
});

const NEW_KEYS = ["dm.muteChat", "dm.mutedLabel", "dm.muteFull", "dm.renameGroup", "dm.groupNameLabel"];

test("new strings exist in en and are translated in all 20 locales", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  const get = (bag, key) => bag[key];
  for (const key of NEW_KEYS) assert.equal(typeof get(en, key), "string", key);
  const others = LOCALES.map((locale) => locale.code).filter((code) => code !== "en");
  assert.equal(others.length, 56);
  for (const locale of others) {
    const bag = JSON.parse(read(`public/locales/${locale}.json`));
    for (const key of NEW_KEYS) {
      const value = get(bag, key);
      assert.equal(typeof value, "string", `${locale} ${key}`);
      assert.notEqual(value, get(en, key), `${locale} ${key} is translated`);
    }
  }
  assert.match(get(en, "dm.muteFull"), /\{count\}/);
});
