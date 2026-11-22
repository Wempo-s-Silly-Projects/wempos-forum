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

// v5.71.1: fixed popups cap their width against the viewport with 100%, not
// 100vw. 100vw includes a classic scrollbar, so a 100vw cap can overflow by
// the scrollbar width; a fixed box resolves % against the viewport without
// it. The modal lightbox dialog is fixed in the top layer; the chat panel and
// Who's Online are fixed children of <body>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

const ruleBody = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}"));
  assert.ok(match, "rule not found: " + selector);
  return match[1];
};

for (const selector of [".attachment-lightbox", ".chat-widget-panel", ".who-online"]) {
  test(`${selector} caps its width without 100vw`, () => {
    const body = ruleBody(selector);
    assert.doesNotMatch(body, /100vw/);
    assert.match(body, /calc\(100% - /);
  });
}
