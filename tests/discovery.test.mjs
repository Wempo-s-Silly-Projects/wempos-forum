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

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call } from "./helpers/seed.mjs";

test("/robots.txt is served by ASSETS, not intercepted", async () => {
  const assets = makeAssets(() => new Response("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain" } }));
  const env = makeEnv({ ASSETS: assets });
  const response = await call(env, "/robots.txt");
  assert.equal(response.status, 200);
  assert.equal(assets.requests.length, 1);
  assert.equal(new URL(assets.requests[0].url).pathname, "/robots.txt");
  assert.match(await response.text(), /User-agent: \*/);
});

test("/.well-known/api-catalog is a linkset+json document with an anchor", async () => {
  const env = makeEnv();
  const response = await call(env, "/.well-known/api-catalog");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^application\/linkset\+json/);
  const body = await response.json();
  assert.ok(Array.isArray(body.linkset) && body.linkset.length > 0);
  assert.equal(typeof body.linkset[0].anchor, "string");
  assert.ok(body.linkset[0].anchor.startsWith("https://wempos-forum.com"));
  assert.equal(env.ASSETS.requests.length, 0);
});

test("/openapi.json parses and declares OpenAPI 3.1", async () => {
  const response = await call(makeEnv(), "/openapi.json");
  assert.equal(response.status, 200);
  const doc = JSON.parse(await response.text());
  assert.match(doc.openapi, /^3\.1\./);
  assert.equal(doc.info.version, "9.9.9-test");
  assert.ok(doc.paths["/api/posts"]);
});

test("/auth.md is markdown whose H1 contains auth.md", async () => {
  const response = await call(makeEnv(), "/auth.md");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^text\/markdown/);
  const h1 = (await response.text()).split("\n").find((line) => line.startsWith("# "));
  assert.ok(h1 && h1.includes("auth.md"), "H1: " + h1);
});

test("/.well-known/mcp/server-card.json carries serverInfo and the transport endpoint", async () => {
  const response = await call(makeEnv(), "/.well-known/mcp/server-card.json");
  assert.equal(response.status, 200);
  const card = await response.json();
  assert.equal(card.serverInfo.name, "wempos-forum");
  assert.equal(card.serverInfo.version, "9.9.9-test");
  assert.equal(card.transport.endpoint, "https://wempos-forum.com/mcp");
});

test("the homepage HTML carries the discovery Link header, Vary: Accept, and the build stamp", async () => {
  const env = makeEnv();
  const response = await call(env, "/", { headers: { Accept: "text/html" } });
  assert.equal(response.status, 200);
  const link = response.headers.get("Link") || "";
  assert.match(link, /rel="api-catalog"/);
  assert.match(link, /rel="service-desc"/);
  assert.match(response.headers.get("Vary") || "", /Accept/);
  assert.match(await response.text(), /<meta name="app-build" content="9\.9\.9-test@abc1234">/);
});

test("a non-negotiable page carries no discovery Link header", async () => {
  const response = await call(makeEnv(), "/settings", { headers: { Accept: "text/html" } });
  assert.equal(response.headers.get("Link"), null);
});

test("discovery documents refuse non-GET methods (fall through to assets)", async () => {
  const env = makeEnv();
  await call(env, "/openapi.json", { method: "POST", body: "{}" });
  assert.equal(env.ASSETS.requests.length, 1);
});
