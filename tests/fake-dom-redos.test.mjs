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

// CodeQL js/redos (alert #12): fake-dom's selector regex once let a lone
// quote be read as either an opening or a closing quote, so a crafted
// selector like '[-="][-="]…x' backtracked exponentially before failing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeNode } from "./helpers/fake-dom.mjs";

const ADVERSARIAL_REPEATS = 24;
const MAX_REJECT_MS = 500;

test("fake-dom rejects an adversarial selector in linear time", () => {
  const root = new FakeNode("div");
  root.append(new FakeNode("span"));
  const evil = "[-=" + "\"][-=".repeat(ADVERSARIAL_REPEATS) + "!";
  const started = performance.now();
  assert.throws(() => root.querySelector(evil), /unsupported selector/);
  assert.ok(performance.now() - started < MAX_REJECT_MS, "selector parse must not backtrack");
});

test("fake-dom still matches quoted and bare attribute values", () => {
  const root = new FakeNode("div");
  const child = new FakeNode("a");
  child.setAttribute("data-x", "v");
  root.append(child);
  assert.equal(root.querySelector('[data-x="v"]'), child);
  assert.equal(root.querySelector("[data-x=v]"), child);
  assert.equal(root.querySelector("a[data-x]"), child);
});
