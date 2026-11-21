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

// Wave 5.7 F1: "Next badge" on your own profile. Display-only, computed from
// the counts the profile payload already carries; visitors never see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  BADGE_TIERS, badgeKeyFor, createNextBadge, nextBadgeProgress,
} from "../public/js/badge-progress.js";
import { interpolate, t } from "../public/js/i18n.js";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("tiers keep the v2.5 thresholds and labels, lowest first", () => {
  assert.deepEqual(BADGE_TIERS.map((tier) => [tier.min, tier.key]), [
    [0, "profile.badgeNew"],
    [20, "profile.badgeStandard"],
    [100, "profile.badgeBig"],
    [1000, "profile.badgeMega"],
    [10000, "profile.badgeFamous"],
  ]);
  assert.ok(Object.isFrozen(BADGE_TIERS));
});

test("badgeKeyFor picks the highest tier reached, at every boundary", () => {
  const cases = [[0, "New"], [19, "New"], [20, "Standard"], [99, "Standard"], [100, "Big"],
    [999, "Big"], [1000, "Mega"], [9999, "Mega"], [10000, "Famous"], [123456, "Famous"]];
  for (const [total, name] of cases) assert.equal(badgeKeyFor(total), "profile.badge" + name, String(total));
  for (const bad of [-5, NaN, "x", null, undefined, 1.5]) assert.equal(badgeKeyFor(bad), "profile.badgeNew", String(bad));
});

test("nextBadgeProgress: the next tier's key, the goal and how far along", () => {
  assert.deepEqual(nextBadgeProgress(0), { key: "profile.badgeStandard", done: 0, goal: 20 });
  assert.deepEqual(nextBadgeProgress(19), { key: "profile.badgeStandard", done: 19, goal: 20 });
  assert.deepEqual(nextBadgeProgress(20), { key: "profile.badgeBig", done: 20, goal: 100 });
  assert.deepEqual(nextBadgeProgress(42), { key: "profile.badgeBig", done: 42, goal: 100 });
  assert.deepEqual(nextBadgeProgress(9999), { key: "profile.badgeFamous", done: 9999, goal: 10000 });
  assert.equal(nextBadgeProgress(10000), null);
  assert.equal(nextBadgeProgress(50000), null);
  assert.deepEqual(nextBadgeProgress(-3), { key: "profile.badgeStandard", done: 0, goal: 20 });
  assert.deepEqual(nextBadgeProgress("7"), { key: "profile.badgeStandard", done: 7, goal: 20 });
});

test("createNextBadge paints the line and a progress bar with the same label", () => {
  const node = createNextBadge(makeFakeDocument(), 42);
  assert.ok(node instanceof FakeNode);
  assert.equal(node.tagName, "P");
  assert.equal(node.className, "profile-next-badge");
  const text = t("profile.nextBadge", { badge: t("profile.badgeBig"), done: 42, goal: 100 });
  const en = JSON.parse(read("public/locales/en.json"));
  assert.equal(interpolate(en["profile.nextBadge"], { badge: en["profile.badgeBig"], done: 42, goal: 100 }),
    "Next badge: Big Forumer (42 of 100)");
  const [label, bar] = node.children;
  assert.equal(label.tagName, "SPAN");
  assert.equal(label.textContent, text);
  assert.equal(bar.tagName, "PROGRESS");
  assert.equal(bar.className, "profile-next-badge-bar");
  assert.equal(bar.max, 100);
  assert.equal(bar.value, 42);
  assert.equal(bar.getAttribute("aria-label"), text);
});

test("createNextBadge at the top tier says so, with no bar", () => {
  const node = createNextBadge(makeFakeDocument(), 10000);
  assert.equal(node.className, "profile-next-badge");
  assert.equal(node.textContent, t("profile.topBadge"));
  assert.equal(node.children.length, 0);
});

test("wiring: profile.js reads the shared tiers and mounts the line for the owner only", () => {
  const profile = read("public/js/routes/profile.js");
  assert.match(profile, /import \{ badgeKeyFor, createNextBadge \} from "\.\.\/badge-progress\.js";/);
  assert.match(profile, /const profileBadgeFor = \(totalContributions\) => t\(badgeKeyFor\(totalContributions\)\);/);
  assert.doesNotMatch(profile, /totalContributions >= 10000/);
  assert.match(profile,
    /if \(session\.user\?\.id === profile\.id\) heading\.append\(createNextBadge\(document, totalContributions\)\);/);
  assert.match(read("public/styles.css"), /\.profile-next-badge \{/);
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/badge-progress\.js">/);
});

test("display only: no network, no storage, no innerHTML", () => {
  assert.doesNotMatch(read("public/js/badge-progress.js"), /\bapi\(|fetch\(|localStorage|sessionStorage|innerHTML/);
});

test("wave 5.7 F1: both keys are in en.json and translated in all 40 other locales", () => {
  const dir = new URL("../public/locales/", import.meta.url);
  const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8"));
  const others = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en.json");
  assert.equal(others.length, 40);
  for (const key of ["profile.nextBadge", "profile.topBadge"]) {
    assert.equal(typeof en[key], "string", key);
    for (const name of others) {
      const messages = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
      assert.equal(typeof messages[key], "string", name + " " + key);
      assert.notEqual(messages[key], en[key], name + " " + key + " is untranslated");
    }
  }
});
