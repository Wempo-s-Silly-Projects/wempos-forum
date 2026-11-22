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

// Favicon and tab badge pins: every page links the SVG favicon (plus a PNG
// fallback), and tab-badge.js draws the unread count on the favicon only
// while the tab is hidden, restoring the plain icon at zero or on return.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { badgeLabel, createTabBadge } from "../public/js/tab-badge.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const BADGED = "data:image/png;base64,BADGE";
const PLAIN = ["/icons/icon.svg", "/icons/icon-192.png"];

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "vendor" ? [] : htmlFiles(full);
    return name.endsWith(".html") ? [full] : [];
  });
}

test("every public page with a <head> links the SVG favicon and the PNG fallback", () => {
  const pages = htmlFiles(PUBLIC).filter((file) => /<head[\s>]/i.test(readFileSync(file, "utf8")));
  assert.ok(pages.length > 0, "at least one page has a <head>");
  for (const file of pages) {
    const html = readFileSync(file, "utf8");
    assert.match(html, /<link rel="icon" href="\/icons\/icon\.svg" type="image\/svg\+xml">/, file);
    assert.match(html, /<link rel="icon" href="\/icons\/icon-192\.png" sizes="192x192" type="image\/png">/, file);
  }
});

test("badgeLabel maps a count to the favicon label, capped at 9+", () => {
  assert.equal(badgeLabel(0), "");
  for (let n = 1; n <= 9; n += 1) assert.equal(badgeLabel(n), String(n));
  assert.equal(badgeLabel(10), "9+");
  assert.equal(badgeLabel(250), "9+");
  for (const junk of [-1, 1.5, NaN, Infinity, "abc", null, undefined, {}, "3x"]) {
    assert.equal(badgeLabel(junk), "", String(junk));
  }
});

// A drawing context that accepts any call or property write.
const anyContext = () => new Proxy({}, {
  get: (target, key) => (key in target ? target[key] : () => {}),
  set: (target, key, value) => { target[key] = value; return true; },
});

function fakeDocument({ canvas = true } = {}) {
  const listeners = {};
  const link = (href) => {
    const attrs = { href };
    return {
      getAttribute: (name) => attrs[name] ?? null,
      setAttribute: (name, value) => { attrs[name] = String(value); },
    };
  };
  const icons = PLAIN.map(link);
  return {
    visibilityState: "visible",
    icons,
    querySelectorAll: (selector) => (selector === 'link[rel="icon"]' ? icons : []),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    fire: (type) => listeners[type]?.(),
    createElement: (tag) => (tag === "canvas" && canvas
      ? { width: 0, height: 0, getContext: anyContext, toDataURL: () => BADGED }
      : {}),
  };
}

const hrefs = (doc) => doc.icons.map((icon) => icon.getAttribute("href"));

test("a visible tab keeps the plain favicon even with unread items", () => {
  const doc = fakeDocument();
  createTabBadge(doc).setCount("notifications", 3);
  assert.deepEqual(hrefs(doc), PLAIN);
});

test("a hidden tab badges the favicon, and a zero count restores the plain icon", () => {
  const doc = fakeDocument();
  const badge = createTabBadge(doc);
  doc.visibilityState = "hidden";
  badge.setCount("notifications", 2);
  badge.setCount("dms", 1);
  assert.deepEqual(hrefs(doc), [BADGED, BADGED]);
  badge.setCount("notifications", 0);
  assert.deepEqual(hrefs(doc), [BADGED, BADGED], "DMs are still unread");
  badge.setCount("dms", 0);
  assert.deepEqual(hrefs(doc), PLAIN);
});

test("returning to the tab restores the plain favicon", () => {
  const doc = fakeDocument();
  const badge = createTabBadge(doc);
  doc.visibilityState = "hidden";
  badge.setCount("notifications", 12);
  assert.equal(hrefs(doc)[0], BADGED);
  doc.visibilityState = "visible";
  doc.fire("visibilitychange");
  assert.deepEqual(hrefs(doc), PLAIN);
});

test("without canvas support the favicon stays plain", () => {
  const doc = fakeDocument({ canvas: false });
  const badge = createTabBadge(doc);
  doc.visibilityState = "hidden";
  badge.setCount("notifications", 5);
  assert.deepEqual(hrefs(doc), PLAIN);
});
