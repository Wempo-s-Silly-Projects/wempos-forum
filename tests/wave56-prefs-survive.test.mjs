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

// Wave 5.6 F2 (owner: "it keeps forgetting local storage stuff (like theme
// and anything else)"). Audit result: NOT reproduced in code. The only
// storage removals in public/js are the account-scoped clearAll…() families,
// reached solely through the explicit Sign out; none of their prefixes can
// match a device preference; a failed or slow /api/session and a refused or
// timed-out SSO redeem touch no storage at all. These pins keep it that way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { clearAllCatchUp } from "../public/js/catch-up.js";
import { clearAllPins } from "../public/js/chat-pins.js";
import { clearAllMutes } from "../public/js/chat-mutes.js";
import { clearAllDrafts } from "../public/js/drafts.js";
import { clearAllRecents } from "../public/js/gallery-picks.js";
import { clearAllNewcomer } from "../public/js/newcomer.js";
import { redeemReturnTicket } from "../public/js/sso.js";

const DEVICE_PREFS = {
  "forum-theme": "dark",
  "forum-text-size": "larger",
  "wempo-locale": "fr",
  "forum-corners": "square",
  "forum-tab-unread": "on",
  "wempo-dm-effects": "on",
};

// A Storage-shaped spy: every removal and clear is recorded.
const spyStorage = (entries) => {
  const map = new Map(Object.entries(entries));
  const removals = [];
  return {
    removals,
    get length() { return map.size; },
    key: (index) => Array.from(map.keys())[index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { removals.push(key); map.delete(key); },
    clear: () => { removals.push("*clear*"); map.clear(); },
    snapshot: () => Object.fromEntries(map),
  };
};

test("every sign-out family's wipe leaves all device preferences intact", () => {
  const storage = spyStorage({
    ...DEVICE_PREFS,
    "forum-draft:u7:reply:12": "x",
    "forum-seen-replies:u7": "{}",
    "forum-chat-pins:u7": "[]",
    "forum-chat-mutes:u7": "[]",
    "forum-gallery-recents:u7": "[]",
    "forum-newcomer-dismissed:u7": "1",
  });
  for (const clear of [clearAllCatchUp, clearAllPins, clearAllMutes, clearAllDrafts, clearAllRecents, clearAllNewcomer]) {
    clear(storage);
  }
  assert.deepEqual(storage.snapshot(), DEVICE_PREFS);
  assert.equal(storage.removals.includes("*clear*"), false, "no family calls storage.clear()");
});

test("a failed or timed-out SSO redeem (and a failed session probe) never touches storage", async () => {
  const storage = spyStorage(DEVICE_PREFS);
  globalThis.localStorage = storage;
  const win = {
    location: { search: "?wt=" + "a".repeat(64), pathname: "/", hash: "", origin: "https://wempos-forum.com" },
    history: { replaceState() {} },
  };
  for (const failure of [new TypeError("Failed to fetch"), Object.assign(new Error("Ticket expired."), { status: 401 }), new DOMException("aborted", "AbortError")]) {
    const api = async () => { throw failure; };
    const stopped = await redeemReturnTicket(win, api, { onRefused() {}, onBanned() {}, setCsrfToken() {} });
    assert.equal(stopped, true, "the refusal stops the boot into its card");
    win.location.search = "?wt=" + "a".repeat(64);
  }
  assert.deepEqual(storage.removals, []);
  assert.deepEqual(storage.snapshot(), DEVICE_PREFS);
  delete globalThis.localStorage;
});

// Static sweep: removals live only in the clearAll families (plus drafts.js's
// single-key clearDraft), and the sign-out wipe has exactly one caller — the
// logout action's finally. Boot, session probe, SSO, the 401 path, the
// stale-build reload and the i18n reload carry no removal at all.
const JS_ROOT = new URL("../public/js/", import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return name === "vendor" ? [] : walk(full);
  return name.endsWith(".js") ? [full] : [];
});
const sources = new Map(walk(JS_ROOT).map((full) => [relative(JS_ROOT, full), readFileSync(full, "utf8")]));
const REMOVAL = /\.removeItem\s*\(|(?:local|session)Storage\s*\.\s*clear\s*\(|storage\s*\.\s*clear\s*\(|Clear-Site-Data/;
// v5.34: + invite.js (the tab's pending invite ref) and share.js (the
// remembered Mastodon server), both cleared by the sign-out wipe.
// v5.36: + recent-searches.js (account-scoped, cleared by the sign-out wipe).
// v5.46: + thread-outline.js (account-scoped open state, cleared by the wipe).
const REMOVAL_FILES = ["catch-up.js", "chat-mutes.js", "chat-pins.js", "drafts.js", "gallery-picks.js", "invite.js", "newcomer.js",
  "quiet-hours.js", "recent-searches.js", "share.js", "thread-outline.js"];

test("storage removals appear only in the account-scoped families", () => {
  const removers = [...sources].filter(([, src]) => REMOVAL.test(src)).map(([path]) => path).sort();
  assert.deepEqual(removers, REMOVAL_FILES);
  for (const path of ["app.js", "api.js", "sso.js", "i18n.js", "theme.js", "theme-preload.js", "text-size.js", "tab-unread.js", "routes/feed.js"]) {
    assert.doesNotMatch(sources.get(path), REMOVAL, path);
  }
});

test("wipeAccountLocalData runs only from the logout action's finally", () => {
  const callers = [...sources].filter(([, src]) => /wipeAccountLocalData\(\)/.test(src)).map(([path]) => path);
  assert.deepEqual(callers, ["routes/account-nav.js"]);
  const nav = sources.get("routes/account-nav.js");
  const calls = [...nav.matchAll(/wipeAccountLocalData\(\);/g)];
  assert.equal(calls.length, 1, "one call site");
  const logout = nav.match(/logout: async \(\) => \{([\s\S]*?)\n {2}\},/)[1];
  assert.match(logout, /finally \{\s*wipeAccountLocalData\(\);\s*\}/);
});
