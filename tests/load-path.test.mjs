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

// Load path (wave 2026-11-21-10 F2): the modulepreload hints in index.html
// and every import edge of the client graph must point at real files, and the
// hints must keep the plain import URL (the build stamp, not a ?v= query, is
// this app's cache-buster — a query would split the module-map cache key).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { buildGraph, moduleEntries, modulePreloads, sitePathToFile } from "../scripts/import-graph.mjs";

test("every modulepreload href in index.html exists under public/", () => {
  const hints = modulePreloads();
  assert.ok(hints.length > 0, "index.html carries modulepreload hints");
  for (const href of hints) {
    assert.match(href, /^\/js\/[\w/-]+\.js$/, `${href} is a plain same-origin module path`);
    assert.ok(existsSync(sitePathToFile(href)), `${href} exists`);
  }
});

// v5.84: the router imports the route modules on navigation through
// route-modules.js, so the boot graph is the entries plus those modules.
const routeModules = () => buildGraph().lazy
  .filter((edge) => edge.from === "/js/route-modules.js").map((edge) => edge.path);

test("every modulepreload hint is part of the boot graph: entries + routed modules (no dead hints)", () => {
  assert.ok(routeModules().length >= 12, "route-modules.js lists the route modules");
  const reachable = new Set(buildGraph([...moduleEntries(), ...routeModules()]).modules.map((m) => m.path));
  for (const href of modulePreloads()) assert.ok(reachable.has(href), `${href} is imported by an entry or a route module`);
});

test("every static import and every lazy import() in the client resolves to a file", () => {
  const graph = buildGraph(moduleEntries(), modulePreloads());
  for (const mod of graph.modules) assert.ok(mod.exists, `${mod.path} exists`);
  for (const edge of graph.lazy) assert.ok(existsSync(sitePathToFile(edge.path)), `${edge.from} → ${edge.path} exists`);
});

test("modulepreload flattens the feed/thread render chain to the first round trip", () => {
  const raw = buildGraph();
  const hinted = buildGraph(moduleEntries(), modulePreloads());
  assert.ok(hinted.maxDepth < raw.maxDepth, `effective depth ${hinted.maxDepth} < unhinted ${raw.maxDepth}`);
  for (const path of ["/js/render.js", "/js/markdown.js", "/js/polls.js", "/js/copy-link.js"]) {
    assert.equal(hinted.modules.find((m) => m.path === path)?.depth, 0, `${path} fetched with the document`);
  }
});
