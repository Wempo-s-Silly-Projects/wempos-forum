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

// Wave 5.2 (owner order "not found should say 404"): the worker answers an
// honest 404 when no client route, real asset or discovery document matches.
// router.js routeForPath is the single source of truth for page routes — the
// worker imports it, and this file walks every route it recognises.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { makeAssets, makeEnv } from "./helpers/d1.mjs";
import { call } from "./helpers/seed.mjs";
import { routeForPath } from "../public/js/router.js";
import { BOARDS } from "../public/js/boards.js";

const PUBLIC_DIR = new URL("../public/", import.meta.url).pathname;
const SHELL = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");
const TYPES = { ".json": "application/json", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".html": "text/html; charset=utf-8" };

// The platform's ASSETS binding as configured (not_found_handling =
// "single-page-application"): a real file is served with its own type, any
// other path gets index.html with 200.
const realisticAssets = () => makeAssets((request) => {
  const { pathname } = new URL(request.url);
  const file = join(PUBLIC_DIR, pathname);
  if (pathname !== "/" && file.startsWith(PUBLIC_DIR)) {
    try {
      const data = readFileSync(file);
      return new Response(data, { status: 200, headers: { "Content-Type": TYPES[extname(file)] || "application/octet-stream" } });
    } catch {
      // Missing file or a directory (EISDIR): the SPA fallback below.
    }
  }
  return new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
});

const get = (path) => call(makeEnv({ ASSETS: realisticAssets() }), path);

const KNOWN_ROUTES = [
  "/", "/?q=cats", "/?view=new", "/?settings", "/setup", "/login", "/register",
  "/admin", "/admin/reports", "/admin/users", "/notifications",
  "/bookmarks", "/bookmarks?board=help", "/suggestions", "/archive", "/mine",
  "/leaderboard", "/rules", "/week", "/tag/news", "/join", "/join?ref=alice", "/posts/1", "/posts/999999", "/users/wempo",
  "/users/some%20name", ...BOARDS.map((board) => `/c/${board.slug}`),
  ...BOARDS.map((board) => `/c/${board.slug}?view=new`),
];

test("the route list covers every route name routeForPath can return", () => {
  const names = new Set(KNOWN_ROUTES.map((path) => {
    const url = new URL(path, "https://x.test");
    return routeForPath(url.pathname, url.search).name;
  }));
  assert.ok(!names.has("not-found"), "a listed route resolves to not-found");
  const source = readFileSync(new URL("../public/js/router.js", import.meta.url), "utf8");
  const declared = new Set([...source.matchAll(/name: "([\w-]+)"/g)].map((match) => match[1]));
  declared.delete("not-found");
  assert.deepEqual([...names].sort(), [...declared].sort());
});

for (const path of KNOWN_ROUTES) {
  test(`known route ${path} answers 200 with the app shell`, async () => {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /text\/html/);
    assert.match(await response.text(), /<meta name="app-build"/);
  });
}

for (const path of ["/this-page-does-not-exist", "/c/notaboard", "/posts/abc", "/users/a/b", "/settings", "/index.htm", "/users/%E0%A4%A"]) {
  test(`unmatched page ${path} answers 404 with the app shell`, async () => {
    const response = await get(path);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("Content-Type"), /text\/html/);
    const body = await response.text();
    assert.match(body, /<meta name="app-build"/, "the shell still boots so the client paints its 404 view");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
}

for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration", "/.well-known/oauth-protected-resource", "/.well-known/x", "/.well-known/mcp/nope.json"]) {
  test(`unserved discovery path ${path} answers a plain 404`, async () => {
    const response = await get(path);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("Content-Type"), /^text\/plain/);
    assert.doesNotMatch(await response.text(), /<html/i);
  });
}

test("served discovery documents keep their 200 and content type", async () => {
  const catalog = await get("/.well-known/api-catalog");
  assert.equal(catalog.status, 200);
  assert.match(catalog.headers.get("Content-Type"), /^application\/linkset\+json/);
  const card = await get("/.well-known/mcp/server-card.json");
  assert.equal(card.status, 200);
  assert.match(card.headers.get("Content-Type"), /^application\/json/);
});

for (const path of ["/locales/unknown.json", "/locales/xx.json", "/locales/"]) {
  test(`missing locale file ${path} answers a plain 404`, async () => {
    const response = await get(path);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("Content-Type"), /^text\/plain/);
  });
}

test("every real locale file stays 200 application/json", async () => {
  const files = readdirSync(join(PUBLIC_DIR, "locales")).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 49);
  for (const name of files) {
    const response = await get(`/locales/${name}`);
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get("Content-Type"), /^application\/json/, name);
    assert.equal(typeof (await response.json()), "object");
  }
});

test("static assets are served unchanged", async () => {
  for (const path of ["/js/app.js", "/js/router.js", "/styles.css", "/robots.txt", "/locales/en.json"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.doesNotMatch(response.headers.get("Content-Type"), /text\/html/, path);
  }
});

test("unknown /api/* paths keep their JSON 404", async () => {
  const response = await get("/api/definitely-not-a-route");
  assert.equal(response.status, 404);
  assert.match(response.headers.get("Content-Type"), /application\/json/);
});

test("the client not-found view paints a large aria-hidden 404 above the h1", () => {
  const source = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  const body = source.match(/function renderNotFoundRoute\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(body, /textContent = "404"/);
  assert.match(body, /setAttribute\("aria-hidden", "true"\)/);
  assert.ok(body.indexOf('"404"') < body.indexOf("app.notFoundHeading"), "the 404 sits above the heading");
  assert.match(body, /addHeading\(main, t\("app\.notFoundHeading"\), 1\)/, "the h1 still announces Page not found");
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.not-found-code\s*\{/);
});
