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

// The canonical-host redirect: any *.workers.dev request answers a 301 to
// the canonical origin with the path and query preserved, before the API
// branch runs; requests already on the canonical host are never redirected.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";

const CANONICAL = "https://wempos-forum.com";

test("workers.dev API request redirects 301 to the canonical origin with path and query", async () => {
  const request = new Request("https://wempos-forum.itswempo.workers.dev/api/posts?page=2&sort=new");
  const response = await worker.fetch(request, {}, undefined);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), `${CANONICAL}/api/posts?page=2&sort=new`);
});

test("workers.dev page request redirects 301 with path preserved", async () => {
  const request = new Request("https://wempos-forum.itswempo.workers.dev/posts/42");
  const response = await worker.fetch(request, {}, undefined);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), `${CANONICAL}/posts/42`);
});

test("canonical host is not redirected", async () => {
  const request = new Request(`${CANONICAL}/posts/42`);
  const response = await worker.fetch(request, {}, undefined);
  assert.notEqual(response.status, 301);
  assert.equal(response.headers.get("Location"), null);
});
