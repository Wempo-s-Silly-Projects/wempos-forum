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

// v5.63 L9 (docs/security-reviews/2026-11-22-v5.57-v5.60.md): the phone bar
// is never empty while GET /api/session is in flight. index.html carries a
// static, guest-safe fallback (Home + Sign in only) that account-nav.js
// replaces wholesale; the full list still lives only in js/nav-items.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NAV_ITEMS } from "../public/js/nav-items.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("public/index.html");
const barMatch = html.match(/<nav class="mobile-bar"[^>]*>([\s\S]*?)<\/nav>/);
const barInner = barMatch ? barMatch[1].replace(/<!--[\s\S]*?-->/g, "") : "";
const anchors = [...barInner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], inner: m[2] }));
const attr = (attrs, name) => (attrs.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];

test("the static phone bar holds exactly Home and Sign in", () => {
  assert.ok(barMatch, "the mobile-bar landmark exists");
  assert.deepEqual(anchors.map((a) => attr(a.attrs, "data-nav-fallback")), ["home", "signin"]);
  assert.deepEqual(anchors.map((a) => attr(a.attrs, "href")), ["/", "/login"]);
  // Nothing but the two links: no member, staff or menu markup.
  assert.equal(barInner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, "").trim(), "");
});

test("the fallback items are guest-safe entries of the one list in nav-items.js", () => {
  for (const anchor of anchors) {
    const item = NAV_ITEMS.find((entry) => entry.id === attr(anchor.attrs, "data-nav-fallback"));
    assert.ok(item, "fallback item comes from NAV_ITEMS");
    assert.ok(["all", "guest"].includes(item.audience), item.id + " is guest-safe");
    assert.equal(item.mobile, "bar");
    assert.equal(attr(anchor.attrs, "class"), "mobile-bar-item");
    assert.match(anchor.inner, new RegExp(`data-i18n="${item.shortKey}"`), item.id + " label key from the list");
    assert.equal(attr(anchor.attrs, "data-i18n-aria-label"), item.mobileLabelKey);
    if (item.href) assert.equal(attr(anchor.attrs, "href"), item.href);
  }
  for (const entry of NAV_ITEMS.filter((item) => item.audience === "member" || item.audience === "staff")) {
    if (entry.href) assert.doesNotMatch(barInner, new RegExp(`href="${entry.href}"`), entry.id + " is not in the fallback");
  }
});

test("Sign in falls back to the in-app door (/login routes home), never a hard-coded Accounts host", () => {
  assert.doesNotMatch(barInner, /https?:\/\//);
  assert.match(read("public/js/router.js"), /pathname === "\/login"[^\n]*return \{ name: "home" \}/);
});

test("the session render replaces the fallback wholesale", () => {
  assert.match(read("public/js/routes/account-nav.js"), /bar\.replaceChildren\(\.\.\.slots, more\)/);
});
