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

// Anubis API gate recovery: a signed-out reader whose pass cookie no longer
// matches (e.g. their IP changed) gets 401 {"error":"human check required"} on
// JSON reads. The client reloads once so the page gate sends them back through
// the Anubis challenge — never in a loop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANUBIS_API_CHALLENGE_ERROR } from "../constants.mjs";
import { HUMAN_CHECK_REQUIRED_ERROR, shouldReloadForHumanCheck } from "../public/js/api.js";

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
};

test("client and server agree on the API challenge error string", () => {
  assert.equal(HUMAN_CHECK_REQUIRED_ERROR, ANUBIS_API_CHALLENGE_ERROR);
});

test("only a 401 carrying the exact challenge error asks for a reload", () => {
  const storage = memoryStorage();
  assert.equal(shouldReloadForHumanCheck(403, { error: ANUBIS_API_CHALLENGE_ERROR }, storage, 1000), false);
  assert.equal(shouldReloadForHumanCheck(401, { error: "signed out" }, storage, 1000), false);
  assert.equal(shouldReloadForHumanCheck(401, null, storage, 1000), false);
  assert.equal(shouldReloadForHumanCheck(401, { error: ANUBIS_API_CHALLENGE_ERROR }, storage, 1000), true);
});

test("never reloads twice within a minute (no loop)", () => {
  const storage = memoryStorage();
  const body = { error: ANUBIS_API_CHALLENGE_ERROR };
  assert.equal(shouldReloadForHumanCheck(401, body, storage, 10_000), true);
  assert.equal(shouldReloadForHumanCheck(401, body, storage, 40_000), false);
  assert.equal(shouldReloadForHumanCheck(401, body, storage, 71_000), true);
});

test("storage that throws (private mode) still allows exactly one decision", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(shouldReloadForHumanCheck(401, { error: ANUBIS_API_CHALLENGE_ERROR }, broken, 1000), true);
});

test("the gate's 401 uses the shared constant", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../api/core/anubis-gate.mjs", import.meta.url), "utf8");
  assert.match(src, /ANUBIS_API_CHALLENGE_ERROR/);
  assert.doesNotMatch(src, /"human check required"/);
});
