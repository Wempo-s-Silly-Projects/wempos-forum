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

// Batch L item 3: GET /api/link-preview. Pins the SSRF guard (https only,
// every resolved address and every redirect hop must be public unicast,
// at most 3 redirects, one timeout, 512 KiB cap, text/html only), the
// OpenGraph parser (no image ever returned), the D1 cache with no member
// id, members-only access and both rate-limit tiers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as constants from "../constants.mjs";
import {
  checkPreviewUrl, fetchPreview, isPublicAddress, parseOpenGraph, resolveHost,
} from "../api/link-preview.mjs";
import { makeEnv, makeLimiters } from "./helpers/d1.mjs";
import { call, forgeSession, seedBan, seedUser } from "./helpers/seed.mjs";

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";
const PAGE = '<!doctype html><html><head><title>Fallback title</title>' +
  '<meta property="og:title" content="Example &amp; Co">' +
  '<meta property="og:description" content="A &quot;quoted&quot; description">' +
  '<meta property="og:site_name" content="Example">' +
  '<meta property="og:image" content="https://cdn.example.com/x.png"></head><body>hi</body></html>';

// A scripted network: DoH answers come from `dns` (name -> {A, AAAA}), page
// fetches from `pages` (href -> Response factory). Every call is recorded.
function fakeNet({ dns = {}, pages = {} } = {}) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ url: url.href, init });
    if (url.origin + url.pathname === constants.LINK_PREVIEW_DOH_ENDPOINT) {
      const name = url.searchParams.get("name");
      const type = url.searchParams.get("type");
      const records = dns[name]?.[type] ?? [];
      const code = type === "A" ? 1 : 28;
      return new Response(JSON.stringify({ Status: 0, Answer: records.map((data) => ({ type: code, data })) }), {
        headers: { "Content-Type": "application/dns-json" },
      });
    }
    const page = pages[url.href];
    if (!page) throw new Error("unexpected fetch " + url.href);
    return page(init);
  };
  return { fetcher, calls, pageCalls: () => calls.filter((c) => !c.url.startsWith(constants.LINK_PREVIEW_DOH_ENDPOINT)) };
}

const html = (body = PAGE, headers = {}) => () =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
const redirect = (location, status = 302) => () => new Response(null, { status, headers: { Location: location } });

// ---------------------------------------------------------------- constants

test("caps live in constants.mjs and the route rides its own limiter scope", () => {
  assert.equal(constants.LINK_PREVIEW_MAX_REDIRECTS, 3);
  assert.equal(constants.LINK_PREVIEW_TIMEOUT_MS, 5000);
  assert.equal(constants.LINK_PREVIEW_MAX_BYTES, 512 * 1024);
  assert.equal(constants.RATE_LIMIT_BINDINGS["link-preview"], "WRITE_RATE_LIMITER");
});

test("migration 0087 is CREATE-only and stores no member id and no image", () => {
  const sql = readFileSync(new URL("../migrations/0087_link_previews.sql", import.meta.url), "utf8");
  const statements = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");
  assert.doesNotMatch(statements, /\b(ALTER|DROP|UPDATE|DELETE|INSERT)\b/i);
  assert.doesNotMatch(statements, /user_id|member|image/i);
  assert.match(statements, /CREATE TABLE IF NOT EXISTS link_previews/);
});

// ---------------------------------------------------------------- addresses

test("isPublicAddress: only public unicast passes (the SSRF address corpus)", () => {
  for (const ip of [PUBLIC_V4, "8.8.8.8", PUBLIC_V6, "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  for (const ip of [
    "127.0.0.1", "127.8.9.10", "::1", "169.254.169.254", "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "192.168.1.1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "224.0.0.1",
    "0.0.0.0", "::", "255.255.255.255", "100.64.0.1", "192.0.2.1", "198.18.0.1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1", "not-an-ip", "",
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test("checkPreviewUrl: https only, no credentials, default port, sane length", () => {
  assert.equal(checkPreviewUrl("https://example.com/a?b=c")?.href, "https://example.com/a?b=c");
  for (const raw of [
    "http://example.com/", "ftp://example.com/", "javascript:alert(1)", "file:///etc/passwd",
    "https://user:pass@example.com/", "https://example.com:8443/", "https://", "", null, 42,
    "https://example.com/" + "a".repeat(constants.LINK_PREVIEW_URL_MAX_CHARS),
  ]) {
    assert.equal(checkPreviewUrl(raw), null, String(raw).slice(0, 60));
  }
});

test("resolveHost: IP literals skip DNS; names ask DoH for A and AAAA", async () => {
  const net = fakeNet({ dns: { "example.com": { A: [PUBLIC_V4], AAAA: [PUBLIC_V6] } } });
  assert.deepEqual(await resolveHost("127.0.0.1", net.fetcher), ["127.0.0.1"]);
  assert.deepEqual(await resolveHost("[::1]", net.fetcher), ["::1"]);
  assert.equal(net.calls.length, 0);
  assert.deepEqual((await resolveHost("example.com", net.fetcher)).sort(), [PUBLIC_V4, PUBLIC_V6].sort());
  assert.deepEqual(net.calls.map((c) => new URL(c.url).searchParams.get("type")).sort(), ["A", "AAAA"]);
});

// ---------------------------------------------------------------- the guarded fetch

test("fetchPreview: a public https page yields title, description and site — never an image", async () => {
  const net = fakeNet({
    dns: { "example.com": { A: [PUBLIC_V4] } },
    pages: { "https://example.com/post": html() },
  });
  const preview = await fetchPreview("https://example.com/post", { fetcher: net.fetcher });
  assert.deepEqual(preview, {
    url: "https://example.com/post", host: "example.com",
    title: "Example & Co", description: 'A "quoted" description', siteName: "Example",
  });
  const [page] = net.pageCalls();
  assert.equal(page.init.redirect, "manual");
  assert.ok(page.init.signal, "an abort signal bounds the fetch");
});

for (const [label, ip] of [
  ["loopback 127.0.0.1", "127.0.0.1"], ["metadata 169.254.169.254", "169.254.169.254"],
  ["private 10/8", "10.1.2.3"], ["IPv6 loopback ::1", "::1"], ["unique-local fc00::/7", "fd00::5"],
]) {
  test(`fetchPreview: refuses a name resolving to ${label} before any page fetch`, async () => {
    const type = ip.includes(":") ? "AAAA" : "A";
    const net = fakeNet({ dns: { "evil.example": { [type]: [ip] } }, pages: { "https://evil.example/": html() } });
    assert.equal(await fetchPreview("https://evil.example/", { fetcher: net.fetcher }), null);
    assert.equal(net.pageCalls().length, 0);
  });
}

test("fetchPreview: one private address among public ones still refuses (every address is checked)", async () => {
  const net = fakeNet({
    dns: { "mixed.example": { A: [PUBLIC_V4, "10.0.0.7"], AAAA: [PUBLIC_V6] } },
    pages: { "https://mixed.example/": html() },
  });
  assert.equal(await fetchPreview("https://mixed.example/", { fetcher: net.fetcher }), null);
  assert.equal(net.pageCalls().length, 0);
});

test("fetchPreview: IP-literal hosts are checked directly (https://127.0.0.1, https://[::1])", async () => {
  const net = fakeNet({});
  assert.equal(await fetchPreview("https://127.0.0.1/", { fetcher: net.fetcher }), null);
  assert.equal(await fetchPreview("https://[::1]/", { fetcher: net.fetcher }), null);
  assert.equal(await fetchPreview("https://169.254.169.254/latest/meta-data/", { fetcher: net.fetcher }), null);
  assert.equal(net.calls.length, 0);
});

test("fetchPreview: a name with no addresses refuses", async () => {
  const net = fakeNet({ pages: { "https://nowhere.example/": html() } });
  assert.equal(await fetchPreview("https://nowhere.example/", { fetcher: net.fetcher }), null);
  assert.equal(net.pageCalls().length, 0);
});

test("fetchPreview: http: is refused, also as a redirect target", async () => {
  const net = fakeNet({
    dns: { "example.com": { A: [PUBLIC_V4] } },
    pages: { "https://example.com/hop": redirect("http://example.com/plain") },
  });
  assert.equal(await fetchPreview("http://example.com/", { fetcher: net.fetcher }), null);
  assert.equal(await fetchPreview("https://example.com/hop", { fetcher: net.fetcher }), null);
  assert.deepEqual(net.pageCalls().map((c) => c.url), ["https://example.com/hop"]);
});

test("fetchPreview: DNS rebinding via redirect — a hop to a private-resolving name is refused", async () => {
  const net = fakeNet({
    dns: { "example.com": { A: [PUBLIC_V4] }, "rebind.example": { A: ["127.0.0.1"] } },
    pages: {
      "https://example.com/go": redirect("https://rebind.example/admin"),
      "https://rebind.example/admin": html(),
    },
  });
  assert.equal(await fetchPreview("https://example.com/go", { fetcher: net.fetcher }), null);
  assert.deepEqual(net.pageCalls().map((c) => c.url), ["https://example.com/go"]);
});

test("fetchPreview: a redirect straight to an IP literal (metadata) is refused", async () => {
  const net = fakeNet({
    dns: { "example.com": { A: [PUBLIC_V4] } },
    pages: { "https://example.com/go": redirect("https://169.254.169.254/latest/") },
  });
  assert.equal(await fetchPreview("https://example.com/go", { fetcher: net.fetcher }), null);
  assert.equal(net.pageCalls().length, 1);
});

test("fetchPreview: follows at most 3 redirects (relative Location resolved), a 4th refuses", async () => {
  const dns = { "example.com": { A: [PUBLIC_V4] } };
  const ok = fakeNet({
    dns,
    pages: {
      "https://example.com/1": redirect("/2"), "https://example.com/2": redirect("/3", 301),
      "https://example.com/3": redirect("https://example.com/final", 308), "https://example.com/final": html(),
    },
  });
  assert.equal((await fetchPreview("https://example.com/1", { fetcher: ok.fetcher }))?.title, "Example & Co");
  const tooMany = fakeNet({
    dns,
    pages: {
      "https://example.com/1": redirect("/2"), "https://example.com/2": redirect("/3"),
      "https://example.com/3": redirect("/4"), "https://example.com/4": redirect("/5"), "https://example.com/5": html(),
    },
  });
  assert.equal(await fetchPreview("https://example.com/1", { fetcher: tooMany.fetcher }), null);
  assert.equal(tooMany.pageCalls().length, 4);
});

test("fetchPreview: only text/html bodies are read", async () => {
  for (const type of ["application/json", "image/svg+xml", "text/plain", ""]) {
    const net = fakeNet({
      dns: { "example.com": { A: [PUBLIC_V4] } },
      pages: { "https://example.com/": html(PAGE, { "Content-Type": type }) },
    });
    assert.equal(await fetchPreview("https://example.com/", { fetcher: net.fetcher }), null, type);
  }
});

test("fetchPreview: reads at most 512 KiB (tags after the cap are never seen)", async () => {
  const filler = "<!--" + "x".repeat(constants.LINK_PREVIEW_MAX_BYTES) + "-->";
  const net = fakeNet({
    dns: { "example.com": { A: [PUBLIC_V4] } },
    pages: { "https://example.com/": html("<html><head>" + filler + '<meta property="og:title" content="Late"></head></html>') },
  });
  assert.equal(await fetchPreview("https://example.com/", { fetcher: net.fetcher }), null);
});

test("fetchPreview: a fetch that throws or times out yields null, not an error", async () => {
  const net = fakeNet({
    dns: { "example.com": { A: [PUBLIC_V4] } },
    pages: { "https://example.com/": () => { throw new DOMException("The operation timed out.", "TimeoutError"); } },
  });
  assert.equal(await fetchPreview("https://example.com/", { fetcher: net.fetcher }), null);
});

// ---------------------------------------------------------------- parser

test("parseOpenGraph: og tags, then twitter/name description, then <title>; clamped, controls stripped", () => {
  assert.deepEqual(parseOpenGraph("<title> Plain\n title </title><meta name=\"description\" content='Desc'>"), {
    title: "Plain title", description: "Desc", siteName: "",
  });
  const long = parseOpenGraph(`<meta content="${"t".repeat(500)}" property="og:title">`);
  assert.equal(long.title.length, constants.LINK_PREVIEW_TITLE_MAX_CHARS);
  assert.equal(parseOpenGraph('<meta property="og:title" content="A\u0000B&#x41;&#66;">').title, "ABAB");
  assert.equal(parseOpenGraph("<p>nothing</p>").title, "");
});

// ---------------------------------------------------------------- route

function routeEnv(net, overrides = {}) {
  const env = makeEnv(overrides);
  env.LINK_PREVIEW_FETCH = net.fetcher;
  return env;
}

test("GET /api/link-preview: guests get 401", async () => {
  const env = routeEnv(fakeNet({}));
  const response = await call(env, "/api/link-preview?url=" + encodeURIComponent("https://example.com/"));
  assert.equal(response.status, 401);
});

test("GET /api/link-preview: a member gets the preview, the row is cached with no member id, and a repeat is served from D1", async () => {
  const net = fakeNet({ dns: { "example.com": { A: [PUBLIC_V4] } }, pages: { "https://example.com/post": html() } });
  const env = routeEnv(net);
  const userId = await seedUser(env.__sqlite, { username: "reader1" });
  const session = forgeSession(env.__sqlite, userId);
  const path = "/api/link-preview?url=" + encodeURIComponent("https://example.com/post");
  const first = await call(env, path, { session });
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.ok, true);
  assert.equal(body.preview.title, "Example & Co");
  assert.equal("image" in body.preview, false);
  const rows = env.__sqlite.prepare("SELECT * FROM link_previews").all();
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["description", "fetched_at", "ok", "site_name", "title", "url"]);
  const before = net.pageCalls().length;
  const second = await (await call(env, path, { session })).json();
  assert.equal(second.preview.title, "Example & Co");
  assert.equal(net.pageCalls().length, before, "served from the cache");
});

test("GET /api/link-preview: a refused URL answers ok:false (no reason oracle) and caches the failure", async () => {
  const net = fakeNet({ dns: { "evil.example": { A: ["10.0.0.1"] } }, pages: {} });
  const env = routeEnv(net);
  const userId = await seedUser(env.__sqlite, { username: "reader2" });
  const session = forgeSession(env.__sqlite, userId);
  for (const raw of ["https://evil.example/", "http://example.com/", "not a url", ""]) {
    const response = await call(env, "/api/link-preview?url=" + encodeURIComponent(raw), { session });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: false });
  }
  const cached = env.__sqlite.prepare("SELECT url, ok FROM link_previews").all();
  assert.deepEqual(cached.map((row) => ({ ...row })), [{ url: "https://evil.example/", ok: 0 }]);
});

test("GET /api/link-preview: banned members are refused; both limiter tiers are consulted", async () => {
  const net = fakeNet({ dns: { "example.com": { A: [PUBLIC_V4] } }, pages: { "https://example.com/": html() } });
  const { limiter, bindings } = makeLimiters();
  const env = routeEnv(net, bindings);
  const userId = await seedUser(env.__sqlite, { username: "reader3" });
  const session = forgeSession(env.__sqlite, userId);
  const path = "/api/link-preview?url=" + encodeURIComponent("https://example.com/");
  await call(env, path, { session });
  assert.ok(limiter.calls.length >= 2, "read (IP) and link-preview (member) tiers");
  seedBan(env.__sqlite, userId);
  const banned = await call(env, path, { session });
  assert.equal(banned.status, 403);
});

test("GET /api/link-preview: other methods are 405", async () => {
  const env = routeEnv(fakeNet({}));
  const userId = await seedUser(env.__sqlite, { username: "reader4" });
  const session = forgeSession(env.__sqlite, userId);
  const response = await call(env, "/api/link-preview?url=x", { method: "POST", session, body: {} });
  assert.equal(response.status, 405);
});
