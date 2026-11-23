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

// Owner order (2026-11-23): "make sure my main forum doesnt turn into
// [Discourse]" / "keep the old vibe". Discourse-parity features ship as
// modules that default OFF, so a forum that never touches the desk keeps
// its classic look and behaviour. Only the modules below may default ON:
// they are the forum's pre-module features (each still env/owner-gated)
// plus the weekly Saturday Fools gag. Adding a name here needs the owner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULES, MODULE_ON, MODULE_OFF } from "../api/core/modules.mjs";

const CLASSIC_DEFAULT_ON = Object.freeze([
  "analytics", "automod", "chat", "embeds", "fun", "human-check",
  "link-previews", "polls", "saturday-fools", "wall", "web-vitals",
]);

test("only the classic features default on; every new module ships off", () => {
  const defaultOn = MODULES.filter((m) => m.default === MODULE_ON).map((m) => m.id).sort();
  assert.deepEqual(defaultOn, [...CLASSIC_DEFAULT_ON].sort());
});

test("every non-classic module defaults to off", () => {
  for (const m of MODULES) {
    if (CLASSIC_DEFAULT_ON.includes(m.id)) continue;
    assert.equal(m.default, MODULE_OFF, m.id + " must default off (keep the old vibe)");
  }
});
