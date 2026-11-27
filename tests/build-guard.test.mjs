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
import { prepareRouteModule } from "../public/js/route-preparation.js";

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

test("a changed build reloads before importing the lazy route module", async () => {
  let reloads = 0;
  let imports = 0;
  const prepared = await prepareRouteModule({
    version: 7,
    prepareContext: async (version) => {
      assert.equal(version, 7);
      const stale = await reloadIfStaleBuild({
        api: async (path) => {
          assert.equal(path, "/api/version");
          return { version: "5.98.0", commit: "def5678" };
        },
        servedBuild: "5.97.0@abc1234",
        reload: () => { reloads += 1; },
      });
      return stale ? null : { ready: true };
    },
    loadModule: () => {
      imports += 1;
      return Promise.resolve({ loaded: true });
    },
  });
  assert.equal(prepared, null);
  assert.equal(reloads, 1);
  assert.equal(imports, 0, "a stale build must not import a lazy route module");
});

test("a current route context loads its lazy module", async () => {
  let imports = 0;
  const prepared = await prepareRouteModule({
    version: 8,
    prepareContext: async () => ({ ready: true }),
    loadModule: () => {
      imports += 1;
      return Promise.resolve({ loaded: true });
    },
  });
  assert.deepEqual(prepared, { context: { ready: true }, view: { loaded: true } });
  assert.equal(imports, 1);
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
