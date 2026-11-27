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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reloadIfStaleBuild } from "../public/js/build-guard.js";

test("matching build stamps do not reload", async () => {
  let reloads = 0;
  const stale = await reloadIfStaleBuild({
    api: async () => ({ version: "5.97.0", commit: "abc1234" }),
    servedBuild: "5.97.0@abc1234",
    reload: () => { reloads += 1; },
  });
  assert.equal(stale, false);
  assert.equal(reloads, 0);
});

test("a changed build reloads the document before lazy route modules load", async () => {
  let reloads = 0;
  const requests = [];
  const stale = await reloadIfStaleBuild({
    api: async (path) => {
      requests.push(path);
      return { version: "5.98.0", commit: "def5678" };
    },
    servedBuild: "5.97.0@abc1234",
    reload: () => { reloads += 1; },
  });
  assert.equal(stale, true);
  assert.deepEqual(requests, ["/api/version"]);
  assert.equal(reloads, 1);

  const app = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  const context = app.slice(app.indexOf("async function prepareRouteContext"), app.indexOf("function setRouteTitle"));
  assert.ok(context.includes("reloadIfStaleBuild"), "the route context checks the served build");
  assert.match(context, /\|\| staleBuild\) return null;/, "a stale build ends the render");
  const route = app.slice(app.indexOf("async function renderRoute"), app.indexOf("function readForm"));
  const check = route.indexOf("await prepareRouteContext(version)");
  assert.ok(check >= 0, "route rendering prepares the route context");
  assert.ok(check < route.indexOf("if (!context) return;"), "a null context stops the render");
  assert.ok(route.indexOf("if (!context) return;") < route.indexOf("loadRouteModule(owner)"),
    "the stale-build check runs before importing a lazy route module");
});

test("a failed version probe does not block navigation", async () => {
  let reloads = 0;
  const stale = await reloadIfStaleBuild({
    api: async () => { throw new Error("offline"); },
    servedBuild: "5.97.0@abc1234",
    reload: () => { reloads += 1; },
  });
  assert.equal(stale, false);
  assert.equal(reloads, 0);
});

test("an unstamped page does not trigger a reload", async () => {
  let requests = 0;
  const stale = await reloadIfStaleBuild({
    api: async () => { requests += 1; return { version: "5.98.0", commit: "def5678" }; },
    servedBuild: "",
    reload: () => assert.fail("reload should not run without a served stamp"),
  });
  assert.equal(stale, false);
  assert.equal(requests, 0);
});
