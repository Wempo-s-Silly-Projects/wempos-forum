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

// v5.30.0: private, first-party analytics. AGGREGATE COUNTS ONLY: one row per
// (UTC day, page type) and one per (UTC day, referring host). No IP, no user
// id, no user agent, no cookie, no per-visit row. DNT / Sec-GPC / bots / HEAD
// are never counted; counting rides ctx.waitUntil and can never break a page.
// Staff read the totals at GET /api/admin/analytics (anon 401, member 403).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, seedUser } from "./helpers/seed.mjs";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");
const MIGRATION = "migrations/0063_page_view_counts.sql";
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const REFERRER_HOST_CAP = 200;
const RETENTION_DAYS = 90;
const RETENTION_DELETE_LIMIT = 500;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const analyticsEnv = (overrides = {}) => makeEnv({ ANALYTICS_ENABLED: "true", ...overrides });

// Drives the real worker with a ctx that collects waitUntil work, then waits
// for it — so the counter's writes are visible to the assertions.
async function visit(env, path, { method = "GET", headers = {} } = {}) {
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const response = await worker.fetch(
    new Request("https://wempos-forum.com" + path, { method, headers: { "User-Agent": BROWSER, ...headers } }),
    env,
    ctx,
  );
  const settled = await Promise.allSettled(pending);
  return { response, settled };
}

const routeRows = (env) => env.__sqlite.prepare("SELECT day, route, views FROM page_view_counts ORDER BY route").all();
const referrerRows = (env) => env.__sqlite.prepare("SELECT day, referrer_host, views FROM referrer_counts ORDER BY referrer_host").all();
const totalViews = (env) => routeRows(env).reduce((sum, row) => sum + row.views, 0);

async function signedIn(env, role) {
  const id = await seedUser(env.__sqlite, { username: "A" + role + Math.floor(Math.random() * 1e6), role });
  return forgeSession(env.__sqlite, id);
}

// ---- schema: nothing that identifies anyone --------------------------------

test("migration 0063 is CREATE-only and stores no personal fields", () => {
  const sql = source(MIGRATION);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(ALTER|DROP|INSERT|UPDATE|DELETE)\b/i);
  const env = makeEnv();
  const columns = (table) => env.__sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).sort();
  assert.deepEqual(columns("page_view_counts"), ["day", "route", "views"]);
  assert.deepEqual(columns("referrer_counts"), ["day", "referrer_host", "views"]);
  for (const name of [...columns("page_view_counts"), ...columns("referrer_counts")]) {
    assert.doesNotMatch(name.replace("referrer_host", "referrer"), /ip|user|agent|cookie|session|email|url|path|query/i, name);
  }
});

// ---- counting: route NAME, never the raw path --------------------------------

test("a page view counts the router's route name for the UTC day, never the id or username", async () => {
  const env = analyticsEnv();
  for (const path of ["/", "/posts/4242", "/posts/4242", "/users/alice", "/c/general", "/?q=secretword"]) {
    const { response } = await visit(env, path);
    assert.equal(response.status, 200, path);
  }
  const rows = routeRows(env);
  assert.deepEqual(rows.map((r) => [r.route, r.views]), [
    ["category", 1], ["home", 1], ["post", 2], ["profile", 1], ["search", 1],
  ]);
  assert.ok(rows.every((r) => r.day === today()));
  const dump = JSON.stringify([rows, referrerRows(env)]);
  for (const leak of ["4242", "alice", "secretword", "general", "/"]) assert.ok(!dump.includes(leak), leak);
});

test("off unless ANALYTICS_ENABLED is exactly \"true\"", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    const env = makeEnv(value === undefined ? {} : { ANALYTICS_ENABLED: value });
    await visit(env, "/");
    assert.equal(totalViews(env), 0, String(value));
  }
});

test("DNT, Sec-GPC, bots, HEAD, prefetch, API calls and unknown pages are never counted", async () => {
  const env = analyticsEnv();
  await visit(env, "/", { headers: { DNT: "1" } });
  await visit(env, "/", { headers: { "Sec-GPC": "1" } });
  for (const ua of ["Googlebot/2.1", "Mozilla/5.0 (compatible; SomeCrawler/1.0)", "ExampleSpider", "Slack link preview", ""]) {
    await visit(env, "/", { headers: { "User-Agent": ua } });
  }
  await visit(env, "/", { method: "HEAD" });
  await visit(env, "/", { headers: { "Sec-Purpose": "prefetch" } });
  await visit(env, "/api/version");
  await visit(env, "/no/such/page");
  assert.equal(totalViews(env), 0);
  assert.equal(referrerRows(env).length, 0);
  await visit(env, "/", { headers: { DNT: "0" } });
  assert.equal(totalViews(env), 1, "a normal browser view still counts");
});

// ---- referrer: host only, external only, capped -------------------------------

test("referrer keeps only the external host; our own origin and junk are dropped", async () => {
  const env = analyticsEnv();
  await visit(env, "/", { headers: { Referer: "https://News.Example.org/some/path?utm=x#frag" } });
  await visit(env, "/", { headers: { Referer: "https://news.example.org/other" } });
  await visit(env, "/", { headers: { Referer: "https://wempos-forum.com/c/general" } });
  await visit(env, "/", { headers: { Referer: "not a url" } });
  await visit(env, "/", { headers: { Referer: "javascript:alert(1)" } });
  const rows = referrerRows(env);
  assert.deepEqual(rows.map((r) => [r.referrer_host, r.views]), [["news.example.org", 2]]);
  assert.ok(!JSON.stringify(rows).includes("path"));
  assert.equal(totalViews(env), 5, "every view still counts its route");
});

test("our configured SITE_ORIGIN is also treated as our own referrer", async () => {
  const env = analyticsEnv({ SITE_ORIGIN: "https://forum.example.org" });
  await visit(env, "/", { headers: { Referer: "https://forum.example.org/rules" } });
  assert.equal(referrerRows(env).length, 0);
  assert.equal(totalViews(env), 1);
});

test("distinct referrer hosts per day are capped; a known host keeps counting", async () => {
  const env = analyticsEnv();
  const insert = env.__sqlite.prepare("INSERT INTO referrer_counts (day, referrer_host, views) VALUES (?, ?, 1)");
  for (let i = 0; i < REFERRER_HOST_CAP; i += 1) insert.run(today(), `h${i}.example.net`);
  await visit(env, "/", { headers: { Referer: "https://brand-new.example.com/" } });
  await visit(env, "/", { headers: { Referer: "https://h7.example.net/" } });
  const rows = referrerRows(env);
  assert.equal(rows.length, REFERRER_HOST_CAP);
  assert.ok(!rows.some((r) => r.referrer_host === "brand-new.example.com"));
  assert.equal(rows.find((r) => r.referrer_host === "h7.example.net").views, 2);
});

// ---- never breaks the page ----------------------------------------------------

// A database whose analytics statements always throw; every other query
// (branding, sessions) passes through to the real fake.
function failingAnalyticsDb(db) {
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== "prepare") return Reflect.get(target, prop);
      return (sql) => {
        if (/page_view_counts|referrer_counts/.test(sql)) throw new Error("simulated D1 outage");
        return target.prepare(sql);
      };
    },
  });
}

test("a counting failure never breaks the shell response", async () => {
  const base = analyticsEnv();
  const env = { ...base, FORUM_DB: failingAnalyticsDb(base.FORUM_DB) };
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const { response, settled } = await visit(env, "/posts/1", { headers: { Referer: "https://a.example.org/" } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /shell/);
    assert.ok(settled.length >= 1, "counting was scheduled on waitUntil");
    assert.ok(settled.every((s) => s.status === "fulfilled"), "the waitUntil promise swallows the error");
    assert.ok(logged.some((line) => /analytics/i.test(line)), "the failure is logged");
    const noCtx = await worker.fetch(new Request("https://wempos-forum.com/", { headers: { "User-Agent": BROWSER } }), env, {});
    assert.equal(noCtx.status, 200);
  } finally {
    console.error = originalError;
  }
});

test("the counter is not reachable as an API route", async () => {
  const env = analyticsEnv();
  for (const path of ["/api/analytics", "/api/analytics/count", "/api/admin/analytics/count"]) {
    const response = await call(env, path, { method: "POST", body: {} });
    assert.ok([401, 403, 404, 405].includes(response.status), `${path} ${response.status}`);
  }
  assert.equal((await call(env, "/api/admin/analytics", { method: "POST", body: {} })).status, 404);
  assert.equal(totalViews(env), 0);
});

// ---- staff dashboard ----------------------------------------------------------

test("GET /api/admin/analytics: anon 401, member 403, staff 200 with aggregates", async () => {
  const env = analyticsEnv();
  await visit(env, "/posts/9", { headers: { Referer: "https://ref.example.org/x" } });
  await visit(env, "/");
  assert.equal((await call(env, "/api/admin/analytics")).status, 401);
  assert.equal((await call(env, "/api/admin/analytics", { session: await signedIn(env, "member") })).status, 403);
  for (const role of ["admin", "moderator"]) {
    const response = await call(env, "/api/admin/analytics?days=30", { session: await signedIn(env, role) });
    assert.equal(response.status, 200, role);
    const data = await response.json();
    assert.equal(data.days, 30);
    assert.equal(data.enabled, true);
    assert.deepEqual(data.totals, [{ day: today(), views: 2 }]);
    assert.deepEqual(data.routes, [{ route: "home", views: 1 }, { route: "post", views: 1 }]);
    assert.deepEqual(data.referrers, [{ host: "ref.example.org", views: 1 }]);
  }
});

test("enabled reports the switch so the desk can say counting is off", async () => {
  const env = makeEnv();
  const id = await seedUser(env.__sqlite, { username: "Offowner", role: "admin" });
  const data = await (await call(env, "/api/admin/analytics", { session: forgeSession(env.__sqlite, id) })).json();
  assert.equal(data.enabled, false);
  assert.deepEqual([data.totals, data.routes, data.referrers], [[], [], []]);
});

test("days must be 7 or 30 (default 7); older rows fall outside the window", async () => {
  const env = analyticsEnv();
  const session = await signedIn(env, "admin");
  env.__sqlite.prepare("INSERT INTO page_view_counts (day, route, views) VALUES (?, 'home', 5), (?, 'home', 3)")
    .run(daysAgo(10), today());
  const week = await (await call(env, "/api/admin/analytics", { session })).json();
  assert.equal(week.days, 7);
  assert.deepEqual(week.totals, [{ day: today(), views: 3 }]);
  const month = await (await call(env, "/api/admin/analytics?days=30", { session })).json();
  assert.equal(month.totals.length, 2);
  for (const bad of ["9", "abc", "-7", "7.0", "3000"]) {
    assert.equal((await call(env, "/api/admin/analytics?days=" + bad, { session })).status, 400, bad);
  }
});

test("retention: rows older than 90 days are deleted on read, in bounded batches", async () => {
  const env = analyticsEnv();
  const session = await signedIn(env, "admin");
  const old = env.__sqlite.prepare("INSERT INTO page_view_counts (day, route, views) VALUES (?, ?, 1)");
  const oldRef = env.__sqlite.prepare("INSERT INTO referrer_counts (day, referrer_host, views) VALUES (?, ?, 1)");
  for (let i = 0; i < RETENTION_DELETE_LIMIT + 100; i += 1) {
    old.run(daysAgo(RETENTION_DAYS + 1 + (i % 50)), "r" + i);
    oldRef.run(daysAgo(RETENTION_DAYS + 1 + (i % 50)), `o${i}.example.org`);
  }
  old.run(daysAgo(RETENTION_DAYS - 1), "keep");
  assert.equal((await call(env, "/api/admin/analytics", { session })).status, 200);
  const count = (table) => env.__sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  assert.equal(count("page_view_counts"), 100 + 1, "one bounded batch per read");
  assert.equal(count("referrer_counts"), 100);
  await call(env, "/api/admin/analytics", { session });
  assert.equal(count("page_view_counts"), 1);
  assert.equal(env.__sqlite.prepare("SELECT route FROM page_view_counts").get().route, "keep");
  assert.match(source("api/analytics.mjs"), /DELETE FROM page_view_counts[\s\S]*?LIMIT/);
});

// ---- client, config and docs --------------------------------------------------

test("desk Visits section: staff-only aggregate, painted with textContent only", () => {
  // v5.92: Visits is a part of the Site health page (desk/merged-sections.js).
  const merged = source("public/js/desk/merged-sections.js");
  assert.match(merged, /createDeskPart\(document, "admin\.section\.visits", "admin\.lede\.visits", createVisitsPanel\(data\.visits, document\)\)/);
  assert.match(merged, /fetcher\(visitsUrl\(7\)\)/);
  const desk = source("public/js/desk/visits.js");
  assert.match(desk, /"\/api\/admin\/analytics\?days=" \+ days/);
  assert.doesNotMatch(desk, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(desk, /textContent/);
  assert.doesNotMatch(desk, /localStorage|sessionStorage|document\.cookie/);
});

test("config and docs: ANALYTICS_ENABLED switch, DNT/GPC honoured, 90-day retention", () => {
  assert.match(source("wrangler.toml"), /^ANALYTICS_ENABLED = "true"$/m);
  assert.match(source("wrangler.example.toml"), /ANALYTICS_ENABLED/);
  const selfHosting = source("docs/self-hosting.md");
  assert.match(selfHosting, /ANALYTICS_ENABLED/);
  const guide = source("docs/using-the-forum.md");
  assert.match(guide, /Do Not Track/);
  assert.match(guide, /Global Privacy Control/);
  assert.match(guide, /90 days/);
});
