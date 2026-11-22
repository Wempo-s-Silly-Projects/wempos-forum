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

// Wave 5.73.0 (slate 2026-11-22-b): B1 shrink-wrapped DM bubbles and B3 the
// no-module notice for browsers that cannot run ES modules. (B2, code
// highlighting, moved to a vendored Prism build by owner decision.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CSS = read("public/styles.css");
const HTML = read("public/index.html");

// The body of the first rule whose selector is exactly `selector`.
function rule(selector) {
  const escaped = selector.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const match = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `rule ${selector} not found in styles.css`);
  return match[1];
}

// ---- B1: shrink-wrapped DM bubbles ----

test("B1: a DM bubble is only as wide as its text, capped at 78%", () => {
  const body = rule(".dm-thread-view .chat-message-body");
  assert.match(body, /\bwidth:\s*fit-content;/);
  assert.match(body, /\bmax-inline-size:\s*78%;/);
  assert.doesNotMatch(body, /\bmax-width:/, "the cap is the logical max-inline-size");
});

test("B1: own DM bubbles align to the logical end (RTL-safe)", () => {
  const row = rule(".dm-thread-view .chat-message.chat-mine");
  assert.match(row, /align-items:\s*flex-end;/);
  assert.match(row, /text-align:\s*end;/);
  const bubble = rule(".dm-thread-view .chat-message.chat-mine .chat-message-body");
  assert.match(bubble, /align-self:\s*end;/);
  for (const text of [row, bubble]) {
    assert.doesNotMatch(text, /\b(?:left|right)\b|margin-left|margin-right|float:/);
  }
});

test("B1: the chat-panel DM bubble shrink-wraps and keeps its 85% cap", () => {
  const body = rule(".chat-widget-message");
  assert.match(body, /\bwidth:\s*fit-content;/);
  assert.match(body, /\bmax-inline-size:\s*85%;/);
  assert.doesNotMatch(body, /\bmax-width:/);
  assert.match(rule(".chat-widget-message.mine"), /align-self:\s*flex-end;/);
});

test("B1 (Roselli): no hover/focus rule resizes a message bubble", () => {
  for (const [, selector, body] of CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/chat-message-body|chat-widget-message\b/.test(selector)) continue;
    if (!/:(?:hover|focus)/.test(selector)) continue;
    assert.doesNotMatch(body, /width|inline-size|padding|font-weight|font-size|border-width/, selector.trim());
  }
});

test("B1: lobby, easy-reading and line-spacing rules still exclude media bodies", () => {
  assert.match(CSS, /\.chat-widget-lobby \.chat-message\.chat-mine \.chat-message-body\s*\{\s*color:\s*var\(--muted\);\s*\}/);
  assert.match(CSS, /:root\.easy-reading :where\([^)]*\.chat-message-body\):not\(\.chat-gif-body, \.chat-dm-image-body, \.chat-emoji-jumbo\)/);
  assert.match(CSS, /:root\[data-line-spacing="relaxed"\] :is\(\.post-body, \.chat-message-body:not\(\.chat-gif-body, \.chat-dm-image-body, \.chat-emoji-jumbo\), textarea\)/);
});

// ---- B3: the no-module notice ----

test("B3: index.html carries a hidden static notice and a same-origin nomodule script", () => {
  const block = HTML.match(/<div id="legacy-notice" class="legacy-notice" hidden>([\s\S]*?)<\/div>/);
  assert.ok(block, "hidden #legacy-notice block");
  assert.match(block[1], /<a href="https:\/\/[^"]+">/);
  assert.doesNotMatch(block[1], /<(?:img|script|iframe|link)\b|\bsrc=/i, "no resource loads");
  assert.match(HTML, /<script nomodule src="\/js\/legacy-notice\.js"><\/script>/);
  assert.match(CSS, /\.legacy-notice\s*\{/);
});

test("B3: legacy-notice.js is plain ES5 and un-hides the notice", () => {
  assert.ok(existsSync(new URL("../public/js/legacy-notice.js", import.meta.url)), "public/js/legacy-notice.js exists");
  const source = read("public/js/legacy-notice.js");
  const code = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|\bimport\b|\bexport\b|`|\bclass\b|\.\.\./);
  const notice = { attrs: { hidden: "" }, removeAttribute(name) { delete this.attrs[name]; } };
  vm.runInNewContext(source, { document: { getElementById: (id) => (id === "legacy-notice" ? notice : null) } });
  assert.equal("hidden" in notice.attrs, false);
  assert.doesNotThrow(() => vm.runInNewContext(source, { document: { getElementById: () => null } }));
});
