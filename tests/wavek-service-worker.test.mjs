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

// Batch K item 4: a small hand-written service worker (Workbox needs a build
// step this no-bundler repo does not have). It caches static assets under a
// cache named by the deploy's build stamp, so every deploy invalidates it;
// it never touches /api/*, never caches a page (HTML can carry personal
// data), and answers a failed navigation with the static offline page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { secureResponse } from "../api/core/http.mjs";
import { SW_PATH, registerServiceWorker, serviceWorkerUrl } from "../public/js/sw-register.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ORIGIN = "https://wempos-forum.com";
const BUILD = "5.75.0@abc1234";

function fakeCaches(seed = {}) {
  const stores = new Map(Object.entries(seed).map(([name, entries]) => [name, new Map(entries)]));
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      put: async (request, response) => { store.set(typeof request === "string" ? request : request.url, response); },
      addAll: async (urls) => { for (const url of urls) store.set(new URL(url, ORIGIN).href, new Response("cached " + url)); },
      match: async (request) => store.get(typeof request === "string" ? new URL(request, ORIGIN).href : request.url),
    };
  };
  return {
    stores,
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (request) => {
      const url = typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
      for (const store of stores.values()) if (store.has(url)) return store.get(url);
      return undefined;
    },
  };
}

function loadWorker({ caches = fakeCaches(), fetchImpl = async () => new Response("net") } = {}) {
  const listeners = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js?build=${encodeURIComponent(BUILD)}`),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const context = vm.createContext({ self, caches, fetch: fetchImpl, URL, Response, Request, Promise, console });
  vm.runInContext(read("public/sw.js"), context);
  const fire = async (type, request) => {
    let responded = null;
    const waits = [];
    const event = {
      request,
      respondWith: (promise) => { responded = Promise.resolve(promise); },
      waitUntil: (promise) => waits.push(promise),
    };
    listeners[type](event);
    await Promise.all(waits);
    return responded ? await responded : null;
  };
  return { listeners, fire, caches };
}

const get = (path, mode = "cors", headers = {}) =>
  ({ url: new URL(path, ORIGIN).href, method: "GET", mode, headers: new Headers(headers) });

test("install precaches the offline page and stylesheets under the build-named cache", async () => {
  const worker = loadWorker();
  await worker.fire("install", null);
  const store = worker.caches.stores.get("forum-static-" + BUILD);
  assert.ok(store, [...worker.caches.stores.keys()].join(","));
  assert.ok(store.has(`${ORIGIN}/offline.html`));
  assert.ok(store.has(`${ORIGIN}/styles.css`));
});

test("activate drops older forum caches and leaves unrelated caches alone", async () => {
  const caches = fakeCaches({ "forum-static-5.74.0@old": [], ["forum-static-" + BUILD]: [], "someone-else": [] });
  const worker = loadWorker({ caches });
  await worker.fire("activate", null);
  assert.deepEqual([...caches.stores.keys()].sort(), ["forum-static-" + BUILD, "someone-else"].sort());
});

test("the worker never answers /api/* requests (not even images), POSTs or other origins", async () => {
  let fetched = 0;
  const worker = loadWorker({ fetchImpl: async () => { fetched += 1; return new Response("x"); } });
  for (const request of [
    get("/api/me"), get("/api/attachments/11111111-1111-4111-8111-111111111111"), get("/api/me/export"),
    { ...get("/js/app.js"), method: "POST" }, get("https://challenges.cloudflare.com/turnstile/v0/api.js"),
    get("/mcp"), get("/feed.xml"),
  ]) {
    assert.equal(await worker.fire("fetch", request), null, request.url);
  }
  assert.equal(fetched, 0);
  assert.equal(worker.caches.stores.size, 0);
});

test("navigations go to the network, are never cached, and fall back to the offline page", async () => {
  const caches = fakeCaches();
  let online = true;
  const worker = loadWorker({
    caches,
    fetchImpl: async () => {
      if (!online) throw new TypeError("offline");
      return new Response("<html>personal</html>", { headers: { "Content-Type": "text/html" } });
    },
  });
  await worker.fire("install", null);
  const page = await worker.fire("fetch", get("/posts/1", "navigate"));
  assert.equal(await page.text(), "<html>personal</html>");
  const store = caches.stores.get("forum-static-" + BUILD);
  assert.ok(![...store.keys()].some((url) => url.endsWith("/posts/1")), "a page is never cached");
  online = false;
  const offline = await worker.fire("fetch", get("/posts/1", "navigate"));
  assert.equal(await offline.text(), "cached /offline.html");
});

test("static assets are cached once and served from cache; no-store or HTML answers are not kept", async () => {
  let fetched = 0;
  const worker = loadWorker({
    fetchImpl: async (request) => {
      fetched += 1;
      const url = typeof request === "string" ? request : request.url;
      if (url.endsWith("/locales/fr.json")) return new Response("{}", { headers: { "Cache-Control": "no-store" } });
      if (url.endsWith("/icons/odd.svg")) return new Response("<html>", { headers: { "Content-Type": "text/html" } });
      return new Response("asset " + url, { headers: { "Content-Type": "text/javascript" } });
    },
  });
  const first = await worker.fire("fetch", get("/js/app.js"));
  assert.equal(await first.text(), `asset ${ORIGIN}/js/app.js`);
  const second = await worker.fire("fetch", get("/js/app.js"));
  assert.equal(await second.text(), `asset ${ORIGIN}/js/app.js`);
  assert.equal(fetched, 1, "the second load comes from the cache");
  await worker.fire("fetch", get("/locales/fr.json"));
  await worker.fire("fetch", get("/icons/odd.svg"));
  const store = worker.caches.stores.get("forum-static-" + BUILD);
  assert.deepEqual([...store.keys()], [`${ORIGIN}/js/app.js`]);
});

test("registration waits for a build stamp and versions the worker URL with it", async () => {
  const registered = [];
  const nav = { serviceWorker: { register: async (url, options) => { registered.push([url, options]); return { ok: true }; } } };
  const docWith = (build) => ({ querySelector: () => (build === null ? null : { content: build }) });
  assert.equal(await registerServiceWorker({ nav, doc: docWith(null) }), null);
  assert.equal(await registerServiceWorker({ nav, doc: docWith("") }), null);
  assert.equal(await registerServiceWorker({ nav: {}, doc: docWith(BUILD) }), null);
  await registerServiceWorker({ nav, doc: docWith(BUILD) });
  assert.equal(SW_PATH, "/sw.js");
  assert.deepEqual(registered, [[serviceWorkerUrl(BUILD), { scope: "/" }]]);
  assert.equal(serviceWorkerUrl(BUILD), "/sw.js?build=" + encodeURIComponent(BUILD));
  const failing = { serviceWorker: { register: async () => { throw new Error("denied"); } } };
  assert.equal(await registerServiceWorker({ nav: failing, doc: docWith(BUILD) }), null, "a refusal is quiet");
});

test("CSP needs no new directive: same-origin workers fall back to script-src 'self'", () => {
  const csp = secureResponse(new Response("x")).headers.get("Content-Security-Policy");
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /worker-src/);
});

test("the offline page is static, script-free, carries the icon links and is REUSE-annotated", () => {
  const html = read("public/offline.html");
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /style=/i);
  assert.match(html, /<link rel="icon" href="\/icons\/icon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css">/);
  assert.match(read("REUSE.toml"), /"public\/offline\.html"/);
  assert.match(read("public/sw.js"), /SPDX-License-Identifier: AGPL-3\.0-or-later/);
});

test("app.js registers the worker after boot", () => {
  const app = read("public/js/app.js");
  assert.match(app, /from "\.\/sw-register\.js"/);
  assert.match(app, /registerServiceWorker\(/);
});
