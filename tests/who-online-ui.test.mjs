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

// Who's-Online roster UI pins: the same static-analysis style as the
// chat-widget pins — the load-bearing wiring held in source text: the roster
// reads even signed-out, the beacon lives HERE and nowhere else, the two 60s
// schedules, and the hide-on-failure contract.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const roster = read("../public/js/who-online.js");

test("the roster renders for any visitor and hides completely on a failed read", () => {
  assert.ok(roster.includes("await boot();"), "the module self-mounts at import");
  assert.ok(roster.includes("hideRoster();"), "the failure hides the card");
  assert.ok(roster.includes("card.hidden = false;"), "a success re-shows it");
  // The roster surface carries no sign-in gate — signed-out visitors read it.
  assert.ok(!roster.includes("return;\n  }\n  card"), "no inert signed-out early-exit");
  assert.ok(!roster.includes("innerHTML"), "the render rides createElement/textContent only");
});

test("the presence beacon is owned here, once on boot and every 60s", () => {
  assert.ok(roster.includes('api("/api/presence", { method: "POST", body: {} })'), "the beacon POST");
  assert.ok(roster.includes("const BEACON_INTERVAL_MS = 60_000;"), "the 60s beacon");
  assert.ok(roster.includes("const ROSTER_REFRESH_MS = 60_000;"), "the 60s roster refresh");
  // Invisible mode is never exposed client-side — the server filters it.
  assert.ok(!/"invisible"|'invisible'/.test(roster), "no invisible toggle leaves this module");
  assert.ok(roster.includes("if (document.hidden) return;"), "hidden tabs make no requests");
});

test("the roster pins its compact shape and profile links", () => {
  assert.ok(roster.includes("const ROSTER_NAME_MAX = 12;"), "the 12-name cap");
  assert.ok(roster.includes("+${overflow} more"), "the +N more tail");
  assert.ok(roster.includes("Active in the last 5 minutes"), "the freshness caption");
  assert.ok(roster.includes("/users/${encodeURIComponent(username)}"), "member names link to profiles");
  assert.ok(roster.includes('data-app-link'), "cross-view links ride the SPA's app-link anchor");
  const shell = read("../public/index.html");
  assert.ok(shell.includes('<script type="module" src="/js/who-online.js"></script>'), "the module tag");
  const css = read("../public/styles.css");
  assert.ok(css.includes(".who-online-heading") && css.includes(".who-online-name"), "the card CSS family");
});
