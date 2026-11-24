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

// Wave 2026-11-21-20: newcomer cards. Pure helpers (scoping, wipe, the 7-day
// window), the fake-DOM render + dismiss/focus flow, the session's additive
// joinedAt, and static pins for the home mount and the sign-out wipe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NEWCOMER_STORAGE_KEY, NEWCOMER_WINDOW_MS, TIPS_CARD, WELCOME_CARD,
  clearAllNewcomer, dismissCard, isNewAccount, newcomerKey, pendingCards,
  readDismissed, renderNewcomerCards,
} from "../public/js/newcomer.js";
import { makeFakeDocument, FakeNode } from "./helpers/fake-dom.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedUser } from "./helpers/seed.mjs";

const NOW = Date.parse("2026-11-21T20:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(NOW - days * DAY_MS).toISOString();
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const memoryStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    dump: () => Object.fromEntries(map),
  };
};
const blockedStorage = {
  get length() { throw new Error("blocked"); },
  key() { throw new Error("blocked"); },
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};

test("keys are scoped per account; dismissals for one member never hide cards for another", () => {
  const storage = memoryStorage();
  assert.equal(newcomerKey(7), NEWCOMER_STORAGE_KEY + ":u7");
  dismissCard(storage, 7, TIPS_CARD, NOW);
  assert.deepEqual(readDismissed(storage, 7), { [TIPS_CARD]: NOW });
  assert.deepEqual(readDismissed(storage, 8), {});
  assert.deepEqual(pendingCards({ id: 8, joinedAt: daysAgo(30) }, readDismissed(storage, 8), NOW), [TIPS_CARD]);
});

test("dismissCard returns a new map and leaves earlier reads untouched", () => {
  const storage = memoryStorage();
  const first = dismissCard(storage, 1, WELCOME_CARD, NOW);
  const second = dismissCard(storage, 1, TIPS_CARD, NOW + 1);
  assert.deepEqual(first, { [WELCOME_CARD]: NOW });
  assert.deepEqual(second, { [WELCOME_CARD]: NOW, [TIPS_CARD]: NOW + 1 });
});

test("broken or blocked storage degrades to 'nothing dismissed', never a throw", () => {
  assert.deepEqual(readDismissed(memoryStorage({ [newcomerKey(1)]: "{nope" }), 1), {});
  assert.deepEqual(readDismissed(memoryStorage({ [newcomerKey(1)]: "[1,2]" }), 1), {});
  assert.deepEqual(readDismissed(blockedStorage, 1), {});
  assert.deepEqual(dismissCard(blockedStorage, 1, TIPS_CARD, NOW), { [TIPS_CARD]: NOW });
  assert.doesNotThrow(() => clearAllNewcomer(blockedStorage));
  assert.doesNotThrow(() => clearAllNewcomer(null));
});

test("sign-out wipe removes every account's newcomer key and nothing else", () => {
  const storage = memoryStorage({
    [newcomerKey(1)]: "{}", [newcomerKey(2)]: "{}", "forum-draft:u1:post-create:new": "{}", "forum-theme": "dark",
  });
  clearAllNewcomer(storage);
  assert.deepEqual(Object.keys(storage.dump()).sort(), ["forum-draft:u1:post-create:new", "forum-theme"]);
});

test("isNewAccount: under 7 days is new; older, missing or garbage dates are not", () => {
  assert.equal(isNewAccount(daysAgo(0), NOW), true);
  assert.equal(isNewAccount(daysAgo(6.9), NOW), true);
  assert.equal(isNewAccount(new Date(NOW - NEWCOMER_WINDOW_MS).toISOString(), NOW), false);
  assert.equal(isNewAccount(daysAgo(30), NOW), false);
  assert.equal(isNewAccount(null, NOW), false);
  assert.equal(isNewAccount(undefined, NOW), false);
  assert.equal(isNewAccount("not a date", NOW), false);
});

// v5.96.0 Part D: the welcome is the day-0 onboarding card and only one card
// shows at a time (one a day in the first week; wave596-onboarding.test.mjs).
test("pendingCards: welcome first for new accounts, tips for everyone, none for guests", () => {
  const fresh = { id: 1, joinedAt: daysAgo(0.2) };
  const old = { id: 2, joinedAt: daysAgo(90) };
  assert.deepEqual(pendingCards(fresh, {}, NOW), [WELCOME_CARD]);
  assert.deepEqual(pendingCards(old, {}, NOW), [TIPS_CARD]);
  assert.deepEqual(pendingCards(fresh, { [WELCOME_CARD]: 1 }, NOW), [TIPS_CARD]);
  assert.deepEqual(pendingCards(fresh, { [WELCOME_CARD]: 1, [TIPS_CARD]: 1 }, NOW), []);
  assert.deepEqual(pendingCards({ id: 1, joinedAt: daysAgo(1) }, {}, NOW), [TIPS_CARD], "day 1 without facts: no guess");
  assert.deepEqual(pendingCards(null, {}, NOW), []);
  assert.deepEqual(pendingCards({ joinedAt: daysAgo(1) }, {}, NOW), []);
});

test("render: one labelled card at a time; dismiss swaps in the next and moves focus safely", async () => {
  const document = makeFakeDocument();
  const slot = new FakeNode("div");
  const storage = memoryStorage();
  const user = { id: 5, username: "Newbie", joinedAt: daysAgo(0.2) };
  renderNewcomerCards(document, slot, user, { storage, now: NOW });

  const welcome = slot.firstElementChild;
  assert.equal(welcome.tagName, "SECTION");
  assert.equal(welcome.dataset.card, WELCOME_CARD);
  const heading = welcome.querySelector(".newcomer-title");
  assert.equal(welcome.getAttribute("aria-labelledby"), heading.id);
  const links = [...welcome.querySelectorAll(".newcomer-link")];
  assert.deepEqual(links.map((link) => link.href), ["/c/general", "/c/showcase", "/rules"]);
  assert.ok(links.every((link) => link.hasAttribute("data-app-link")));
  const dismiss = welcome.querySelector(".newcomer-dismiss");
  assert.equal(dismiss.type, "button");
  assert.ok(dismiss.getAttribute("aria-label"));
  assert.equal(heading.ownerFocused, undefined, "first paint never steals focus");

  // v5.96.0: one card a day in the first week, so the welcome's dismiss ends
  // the day; the tips card comes the next day and still swaps in focus-safe.
  await dismiss.fire("click");
  assert.deepEqual(Object.keys(readDismissed(storage, 5)), [WELCOME_CARD]);
  assert.equal(slot.firstElementChild.className, "newcomer-done");
  const tomorrow = NOW + DAY_MS;
  const tipsSlot = new FakeNode("div");
  renderNewcomerCards(document, tipsSlot, user, { storage, now: tomorrow });
  const tips = tipsSlot.firstElementChild;
  assert.equal(tipsSlot.children.length, 1);
  assert.equal(tips.dataset.card, TIPS_CARD);
  assert.equal(tips.querySelector(".newcomer-tips").children.length, 4);

  await tips.querySelector(".newcomer-dismiss").fire("click");
  const done = tipsSlot.firstElementChild;
  assert.equal(done.className, "newcomer-done");
  assert.equal(done.getAttribute("role"), "status");
  assert.equal(done.ownerFocused, true);
  assert.deepEqual(Object.keys(storage.dump()), [newcomerKey(5)]);

  const again = new FakeNode("div");
  renderNewcomerCards(document, again, user, { storage, now: tomorrow });
  assert.equal(again.children.length, 0);
});

test("render: an older account sees only the tips card; a guest sees nothing", () => {
  const document = makeFakeDocument();
  const slot = new FakeNode("div");
  renderNewcomerCards(document, slot, { id: 9, username: "Vet", joinedAt: daysAgo(400) }, { storage: memoryStorage(), now: NOW });
  assert.equal(slot.firstElementChild.dataset.card, TIPS_CARD);
  const guestSlot = new FakeNode("div");
  renderNewcomerCards(document, guestSlot, null, { storage: memoryStorage(), now: NOW });
  assert.equal(guestSlot.children.length, 0);
});

test("render: blocked storage still shows the card and dismiss still works in-session", async () => {
  const document = makeFakeDocument();
  const slot = new FakeNode("div");
  renderNewcomerCards(document, slot, { id: 3, username: "Priv", joinedAt: daysAgo(90) }, { storage: blockedStorage, now: NOW });
  await slot.querySelector(".newcomer-dismiss").fire("click");
  assert.equal(slot.firstElementChild.className, "newcomer-done");
});

test("GET /api/session carries the member's own joinedAt (additive, ISO)", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const id = await seedUser(db, { username: "Fresh" });
  const session = forgeSession(db, id);
  const response = await call(env, "/api/session", { session });
  assert.equal(response.status, 200);
  const { user } = await response.json();
  assert.equal(user.id, id);
  const stored = db.prepare("SELECT created_at FROM users WHERE id = ?").get(id).created_at;
  assert.equal(user.joinedAt, new Date(stored * 1000).toISOString());
});

test("static pins: home mounts the cards for members; sign-out wipes the dismissals", () => {
  const feed = read("public/js/routes/feed.js");
  assert.match(feed, /import \{ createOnboardingPanel, renderNewcomerCards \} from "\.\.\/newcomer\.js";/);
  assert.match(feed, /renderNewcomerCards\(document, newcomerSlot, session\.user\)/);
  const nav = read("public/js/routes/account-nav.js");
  assert.match(nav, /clearAllDrafts\(\);\s*clearAllCatchUp\(\);[\s\S]*clearAllNewcomer\(\);[\s\S]*wempoAccountsSignOutUrl/);
  const source = read("public/js/newcomer.js");
  assert.doesNotMatch(source, /\bapi\(|fetch\(|innerHTML/, "local-only, createElement/textContent");
});
