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

// The emoji picker must arrive styled (owner, 2026-11-23: unstyled in the
// composer and the chat widget). picmo's runtime builds every class name as
// picmo__<name> and renders its root as "picmo__picker", but the dist/index.css
// every picmo release ships is built without that prefix (.picker, .emoji...),
// so the linked sheet matched nothing. With <style> injection off (CSP
// style-src 'self'), the linked /js/vendor/picmo.css has to be the stylesheet
// picmo itself would inject: the one embedded in the vendored dist/index.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const PICMO_JS = read("public/js/vendor/picmo.js");
const PICMO_CSS = read("public/js/vendor/picmo.css");

// picmo's own runtime stylesheet: the template literal its style injector uses.
function embeddedStylesheet(source) {
  const match = source.match(/\nconst Fs = `([^`]*)`;\n/);
  assert.ok(match, "picmo.js embeds its runtime stylesheet as const Fs");
  return match[1];
}

const classSelectors = (css) => new Set(css.match(/\.picmo__[A-Za-z0-9_-]+/g) ?? []);

test("picmo renders its root with the prefixed picmo__picker class", () => {
  assert.match(PICMO_JS, /<div class="picmo__picker \$\{e\.picker\}/);
  assert.match(PICMO_JS, /function ne\(s\) \{\n {2}return `picmo__\$\{s\}`;/);
});

test("the linked picmo.css styles the classes picmo actually renders", () => {
  const linked = classSelectors(PICMO_CSS);
  assert.ok(linked.has(".picmo__picker"), "picmo.css styles the picker root");
  for (const selector of classSelectors(embeddedStylesheet(PICMO_JS))) {
    assert.ok(linked.has(selector), "picmo.css covers " + selector);
  }
  assert.doesNotMatch(PICMO_CSS, /(^|[\s,}>+~])\.picker[\s.{,:]/, "no unprefixed .picker rule");
});

test("picmo.css is byte for byte the stylesheet the vendored picmo.js would inject", () => {
  assert.equal(PICMO_CSS, embeddedStylesheet(PICMO_JS));
});
