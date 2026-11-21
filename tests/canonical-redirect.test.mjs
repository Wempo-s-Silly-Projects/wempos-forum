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
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";

// v5.17.0: the redirect target is the configured SITE_ORIGIN (the owner's
// wrangler.toml sets it); tests/self-hosting.test.mjs covers it unset.
const SITE_ORIGIN = "https://wempos-forum.com";

test("*.workers.dev answers 301 to the canonical origin with path + query intact", async () => {
  const env = makeEnv({ SITE_ORIGIN });
  for (const host of ["wempos-forum.itswempo.workers.dev", "x.workers.dev"]) {
    const response = await worker.fetch(new Request("https://" + host + "/posts/12?tab=replies&x=1"), env, {});
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("Location"), "https://wempos-forum.com/posts/12?tab=replies&x=1");
  }
});

test("API paths on workers.dev redirect too (no DB work before the redirect)", async () => {
  const response = await worker.fetch(new Request("https://a.workers.dev/api/version"), { SITE_ORIGIN }, {});
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), "https://wempos-forum.com/api/version");
});

test("the canonical host is not redirected", async () => {
  const env = makeEnv({ SITE_ORIGIN });
  const response = await worker.fetch(new Request("https://wempos-forum.com/about?q=1"), env, {});
  assert.notEqual(response.status, 301);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(env.ASSETS.requests.length, 1);
});

test("a look-alike host that merely contains workers.dev is not redirected", async () => {
  const env = makeEnv({ SITE_ORIGIN });
  const response = await worker.fetch(new Request("https://workers.dev.example.com/"), env, {});
  assert.notEqual(response.status, 301);
});
