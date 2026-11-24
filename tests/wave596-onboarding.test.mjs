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

// v5.96.0 Part D: in-forum onboarding cards (the forum collects no email, so
// the first-week nudges live on the home page). Days 0, 1, 3, 5 and 8 of a new
// account each have one card; at most one card a day (the "New tricks" tips
// card included); a first post ends days 1 and 5; Settings -> Notifications
// turns them off. Decided from data the forum already has; the only thing
// stored is the per-account dismiss map that sign-out wipes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  ONBOARDING_OFF, TIPS_CARD, WELCOME_CARD, createOnboardingPanel, newcomerKey, pendingCards,
  readDismissed, renderNewcomerCards, setOnboardingEnabled,
} from "../public/js/newcomer.js";
import { SETTINGS_GROUPS } from "../public/js/settings-groups.js";
import { makeFakeDocument, FakeNode } from "./helpers/fake-dom.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, now, seedBan, seedPost, seedUser } from "./helpers/seed.mjs";

const NOW = Date.parse("2026-11-24T20:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(NOW - days * DAY_MS).toISOString();
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const memoryStorage = () => {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
};
const member = (day, onboarding = {}) => ({ id: 4, username: "Newbie", joinedAt: daysAgo(day + 0.5), onboarding });
const QUIET = { postCount: 0, profileDefault: true, startHereId: null };

test("pendingCards: one card per account day, each gated on the data the forum has", () => {
  const cases = [
    // [day, facts, dismissed, expected]
    [0, QUIET, {}, [WELCOME_CARD]],
    [1, QUIET, {}, ["onboard-say-hi"]],
    [2, QUIET, {}, ["onboard-say-hi"]],
    [1, { ...QUIET, postCount: 1 }, {}, [TIPS_CARD]],
    [3, QUIET, {}, ["onboard-profile"]],
    [4, { ...QUIET, profileDefault: false }, {}, [TIPS_CARD]],
    [5, QUIET, {}, ["onboard-stuck"]],
    [7, { ...QUIET, postCount: 3 }, {}, [TIPS_CARD]],
    [8, { ...QUIET, postCount: 3 }, {}, ["onboard-things"]],
    [9, QUIET, {}, [TIPS_CARD]],
    [40, QUIET, {}, [TIPS_CARD]],
    // Unknown facts never guess a nudge.
    [1, {}, {}, [TIPS_CARD]],
    [3, {}, {}, [TIPS_CARD]],
    // Already dismissed (on an earlier day): the next one in line shows.
    [1, QUIET, { "onboard-say-hi": NOW - 1.2 * DAY_MS }, [TIPS_CARD]],
    [1, QUIET, { [TIPS_CARD]: NOW - 30 * DAY_MS }, ["onboard-say-hi"]],
    // Turned off in Settings: no onboarding card, the tips card still shows.
    [0, QUIET, { [ONBOARDING_OFF]: NOW - 1000 }, [TIPS_CARD]],
    [8, QUIET, { [ONBOARDING_OFF]: NOW - 1000, [TIPS_CARD]: 1 }, []],
  ];
  for (const [day, facts, dismissed, expected] of cases) {
    assert.deepEqual(pendingCards(member(day, facts), dismissed, NOW), expected, `day ${day} ${JSON.stringify(facts)} ${JSON.stringify(dismissed)}`);
  }
});

test("pendingCards: after a card is dismissed today, nothing else shows until tomorrow", () => {
  assert.deepEqual(pendingCards(member(0, QUIET), { [WELCOME_CARD]: NOW - 60_000 }, NOW), []);
  assert.deepEqual(pendingCards(member(1, QUIET), { [TIPS_CARD]: NOW - 60_000 }, NOW), []);
  // Tomorrow the next card is back.
  assert.deepEqual(pendingCards(member(1, QUIET), { [WELCOME_CARD]: NOW - DAY_MS }, NOW), ["onboard-say-hi"]);
});

test("render day 0: the welcome links the pinned Start-here thread, says how to turn the cards off, and dismiss ends the day", async () => {
  const document = makeFakeDocument();
  const slot = new FakeNode("div");
  const storage = memoryStorage();
  renderNewcomerCards(document, slot, member(0, { ...QUIET, startHereId: 42 }), { storage, now: NOW });
  const card = slot.firstElementChild;
  assert.equal(card.dataset.card, WELCOME_CARD);
  const links = [...card.querySelectorAll(".newcomer-link")].map((link) => link.href);
  assert.equal(links[0], "/posts/42");
  assert.ok(card.querySelector(".newcomer-off-hint"), "first card says how to turn them off");
  await card.querySelector(".newcomer-dismiss").fire("click");
  assert.equal(slot.firstElementChild.className, "newcomer-done", "no second card the same day");
  const fallback = new FakeNode("div");
  renderNewcomerCards(document, fallback, member(0, QUIET), { storage: memoryStorage(), now: NOW });
  assert.equal(fallback.querySelector(".newcomer-link").href, "/c/general");
});

test("render: each later card links where it says, and day 8 skips modules that are off", () => {
  const document = makeFakeDocument();
  const hrefs = (day, options = {}) => {
    const slot = new FakeNode("div");
    renderNewcomerCards(document, slot, member(day, QUIET), { storage: memoryStorage(), now: NOW, ...options });
    return { card: slot.firstElementChild, links: [...slot.querySelectorAll(".newcomer-link")].map((link) => link.href) };
  };
  assert.deepEqual(hrefs(1).links, ["/c/general"]);
  assert.deepEqual(hrefs(3).links, ["/users/Newbie"]);
  assert.deepEqual(hrefs(5).links, ["/c/help"]);
  const things = hrefs(8);
  assert.deepEqual(things.links, ["/c/polls"]);
  assert.ok(things.card.querySelector(".newcomer-chat"), "chat lobby button");
  const off = hrefs(8, { modulesOff: new Set(["polls", "chat"]) });
  assert.deepEqual(off.links, []);
  assert.equal(off.card.querySelector(".newcomer-chat"), null);
});

test("render: the off hint rides the first onboarding card a member sees, on whatever day, and names the real labels", () => {
  const document = makeFakeDocument();
  const cardFor = (day, dismissed = {}) => {
    const storage = memoryStorage();
    storage.setItem(newcomerKey(4), JSON.stringify(dismissed));
    const slot = new FakeNode("div");
    renderNewcomerCards(document, slot, member(day, QUIET), { storage, now: NOW });
    return slot.firstElementChild;
  };
  for (const day of [1, 3, 5, 8]) assert.ok(cardFor(day).querySelector(".newcomer-off-hint"), "first card on day " + day);
  const seen = cardFor(3, { [WELCOME_CARD]: NOW - 3 * DAY_MS });
  assert.equal(seen.querySelector(".newcomer-off-hint"), null, "not again once an onboarding card was seen");
  const tips = cardFor(30);
  assert.equal(tips.querySelector(".newcomer-off-hint"), null, "never on the tips card");
  const hint = cardFor(0).querySelector(".newcomer-off-hint").textContent;
  assert.ok(!hint.includes("{"), "placeholders filled: " + hint);
});

test("every locale's off hint uses that locale's own Settings and Notifications labels", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  for (const file of readdirSync(dir)) {
    const table = JSON.parse(read("public/locales/" + file));
    assert.match(table["newcomer.onboardOffHint"], /\{settings\} [→←] \{notifications\}/, file);
    assert.ok(table["common.settings"] && table["settingsGroups.notifications"], file);
  }
});

test("Settings -> Notifications toggle: on by default, stored only in the account-scoped dismiss map", () => {
  const storage = memoryStorage();
  const document = makeFakeDocument();
  const panel = createOnboardingPanel(document, { id: 4 }, { storage });
  assert.ok(panel.matches("section.panel"));
  const box = panel.querySelector("input");
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, true);
  box.checked = false;
  box.fire("change");
  assert.ok(ONBOARDING_OFF in readDismissed(storage, 4));
  assert.equal(storage.key(0), newcomerKey(4));
  setOnboardingEnabled(storage, 4, true);
  assert.ok(!(ONBOARDING_OFF in readDismissed(storage, 4)));
  assert.ok(SETTINGS_GROUPS.find((group) => group.key === "notifications").panelTitleKeys.includes("newcomer.onboardSettingTitle"));
  assert.match(read("public/js/routes/feed.js"), /createOnboardingPanel\(document, session\.user/);
});

test("GET /api/session: first-week facts for new accounts only, Start-here obeys the visibility law", async () => {
  const env = makeEnv();
  const db = env.__sqlite;
  const fresh = await seedUser(db, { username: "Fresh" });
  const staff = await seedUser(db, { username: "boss", role: "admin" });
  const banned = await seedUser(db, { username: "Gone" });
  const pin = (authorId, body, board = "general") => {
    const id = seedPost(db, { authorId, body, board });
    db.prepare("UPDATE posts SET pinned_at = ? WHERE id = ?").run(now(), id);
    return id;
  };
  const facts = async (userId) => (await (await call(env, "/api/session", { session: forgeSession(db, userId) })).json()).user.onboarding;

  assert.deepEqual(await facts(fresh), { postCount: 0, profileDefault: true, startHereId: null });
  pin(staff, "Pinned rules\nnot the start thread");
  pin(staff, "Welcome! Start here :3", "showcase");
  const start = pin(staff, "Welcome! Start here :3\nHi and welcome!");
  seedPost(db, { authorId: fresh, body: "hello all" });
  db.prepare("UPDATE users SET flair = 'builder' WHERE id = ?").run(fresh);
  assert.deepEqual(await facts(fresh), { postCount: 1, profileDefault: false, startHereId: start });
  // Blocked by (or blocking) its author, or the author banned: no link.
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(staff, fresh, now());
  assert.equal((await facts(fresh)).startHereId, null);
  db.prepare("DELETE FROM blocks").run();
  db.prepare("UPDATE posts SET author_id = ? WHERE id = ?").run(banned, start);
  seedBan(db, banned);
  assert.equal((await facts(fresh)).startHereId, null);
  db.prepare("UPDATE posts SET author_id = ?, visibility = 'hidden' WHERE id = ?").run(staff, start);
  assert.equal((await facts(fresh)).startHereId, null);
  // Past the first week: nothing extra rides the session.
  db.prepare("UPDATE users SET created_at = created_at - ? WHERE id = ?").run(10 * 86400, fresh);
  assert.equal(await facts(fresh), undefined);
});
