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

// Anonymous Core Web Vitals + the desk's Site health page. Pins: the beacon
// schema (known metrics, finite capped values, route NAME allow-list, body
// cap), nothing identifying reaches D1 (no IP, user agent, member id, cookie;
// day-granular only), daily histogram aggregates with 90-day retention, p75
// from buckets with Google's bands, the staff-only read (anon 401, member
// 403), GPC/DNT suppression on the client, one beacon per page view, the
// vendored web-vitals file byte-for-byte, REUSE licensing and an unchanged CSP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import worker from "../worker.mjs";
import * as constants from "../constants.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { forgeSession, seedUser } from "./helpers/seed.mjs";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";
import { secureResponse } from "../api/core/http.mjs";
import { ROUTE_NAMES, routeForPath } from "../public/js/router.js";
import {
  bucketIndex, p75FromBuckets, vitalsBand, validateVitalsBeacon,
} from "../api/vitals.mjs";
import {
  VITALS_ENDPOINT, VITALS_METRICS, VITALS_ROUTES, WEB_VITALS_SRC,
  routeTemplate, sendVitals, startVitals, vitalsAllowed, vitalsBody,
} from "../public/js/vitals.js";
import { createSiteHealthPanel } from "../public/js/desk/site-health.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const ORIGIN = "https://wempos-forum.com";
const MIGRATION = "migrations/0079_web_vitals.sql";
const VENDOR_FILE = "public/js/vendor/web-vitals.iife.js";
const VENDOR_SHA256 = "1e5e9b9af6b8d71cfef508e5a869c53b4cf2bbccad8c9b5ac664c34e93f6151a";
const IP = "203.0.113.77";
const UA = "UA-SENTINEL/9.9 (vitals test)";
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function beacon(body, { origin = ORIGIN, headers = {}, raw } = {}) {
  const finalHeaders = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": IP, "User-Agent": UA, ...headers });
  if (origin) finalHeaders.set("Origin", origin);
  return new Request(ORIGIN + "/api/vitals", {
    method: "POST", headers: finalHeaders, body: raw ?? JSON.stringify(body),
  });
}
const post = (env, body, options) => worker.fetch(beacon(body, options), env, { waitUntil() {} });
const rows = (env) => env.__sqlite.prepare("SELECT * FROM web_vitals_daily ORDER BY route, metric").all();
const bucketsOf = (row) => Array.from({ length: constants.VITALS_BUCKET_COUNT }, (_, i) => row["b" + i]);

// Wraps FORUM_DB so every prepared SQL string and every bind list is logged.
function capturingEnv() {
  const env = makeEnv();
  const log = [];
  const real = env.FORUM_DB;
  env.FORUM_DB = {
    batch: (statements) => real.batch(statements),
    exec: (...args) => real.exec(...args),
    prepare(sql) {
      const entry = { sql, binds: [] };
      log.push(entry);
      const statement = real.prepare(sql);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => { entry.binds = values; return bind(...values); };
      return statement;
    },
  };
  return { env, log };
}

async function signedIn(env, role) {
  const id = await seedUser(env.__sqlite, { username: "V" + role + Math.floor(Math.random() * 1e6), role });
  return { id, session: forgeSession(env.__sqlite, id) };
}

// ---------------------------------------------------------------- constants

test("caps live in root constants.mjs and every band threshold is a bucket edge", () => {
  assert.deepEqual(constants.VITALS_METRICS, ["LCP", "INP", "CLS", "FCP", "TTFB"]);
  assert.equal(constants.VITALS_RETENTION_DAYS, 90);
  assert.ok(constants.VITALS_MAX_BODY_BYTES > 0 && constants.VITALS_MAX_BODY_BYTES <= 1024);
  assert.deepEqual(constants.VITALS_THRESHOLDS, {
    LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800],
  });
  for (const metric of constants.VITALS_METRICS) {
    const edges = constants.vitalsBucketEdges(metric);
    assert.equal(edges.length + 1, constants.VITALS_BUCKET_COUNT, metric);
    for (const threshold of constants.VITALS_THRESHOLDS[metric]) assert.ok(edges.includes(threshold), `${metric} ${threshold}`);
    assert.ok(edges.every((edge, i) => i === 0 || edge > edges[i - 1]), `${metric} edges ascend`);
    assert.ok(constants.VITALS_METRIC_MAX[metric] > edges.at(-1), `${metric} cap above the last edge`);
  }
  assert.deepEqual(VITALS_METRICS, constants.VITALS_METRICS, "client mirrors the metric list");
});

test("the route allow-list is the router's route names; every routed path names one", () => {
  for (const path of ["/", "/?q=x", "/?settings", "/admin", "/admin/visits", "/notifications", "/bookmarks", "/c/general",
    "/archive", "/mine", "/leaderboard", "/rules", "/week", "/join", "/tag/abc", "/posts/1", "/users/bob", "/setup", "/nope/x"]) {
    assert.ok(ROUTE_NAMES.includes(routeForPath(path.split("?")[0], path.includes("?") ? "?" + path.split("?")[1] : "").name), path);
  }
  assert.deepEqual(VITALS_ROUTES, ROUTE_NAMES.filter((name) => name !== "not-found"));
});

// ---------------------------------------------------------------- schema

test("validateVitalsBeacon accepts a known route with known finite metrics", () => {
  assert.deepEqual(validateVitalsBeacon({ route: "post", metrics: { LCP: 1234.5, CLS: 0.02 } }),
    { route: "post", metrics: [["LCP", 1234.5], ["CLS", 0.02]] });
  assert.deepEqual(validateVitalsBeacon({ route: "home", metrics: { TTFB: 0 } }), { route: "home", metrics: [["TTFB", 0]] });
});

test("validateVitalsBeacon rejects unknown metrics, unknown routes, NaN, negatives, over-cap and extra keys", () => {
  const bad = [
    null, [], "x", {}, { route: "post" }, { metrics: { LCP: 1 } },
    { route: "post", metrics: {} },
    { route: "post", metrics: { FID: 10 } },
    { route: "post", metrics: { LCP: 1, FID: 10 } },
    { route: "not-found", metrics: { LCP: 1 } },
    { route: "/posts/42", metrics: { LCP: 1 } },
    { route: "Post", metrics: { LCP: 1 } },
    { route: "constructor", metrics: { LCP: 1 } },
    { route: "post", metrics: { LCP: NaN } },
    { route: "post", metrics: { LCP: Infinity } },
    { route: "post", metrics: { LCP: -1 } },
    { route: "post", metrics: { LCP: "1200" } },
    { route: "post", metrics: { LCP: null } },
    { route: "post", metrics: { CLS: constants.VITALS_METRIC_MAX.CLS + 0.01 } },
    { route: "post", metrics: { INP: constants.VITALS_METRIC_MAX.INP + 1 } },
    { route: "post", metrics: { LCP: 1 }, user: 7 },
    { route: "post", metrics: { LCP: 1 }, url: "/posts/42" },
    { route: "post", metrics: [1, 2] },
    { route: "post", metrics: { __proto__: { LCP: 1 } } },
  ];
  for (const body of bad) assert.equal(validateVitalsBeacon(body), null, JSON.stringify(body));
});

test("bucketIndex: value <= edge lands in that bucket; above every edge is the overflow bucket", () => {
  const edges = constants.vitalsBucketEdges("LCP");
  assert.equal(bucketIndex("LCP", 0), 0);
  assert.equal(bucketIndex("LCP", edges[0]), 0);
  assert.equal(bucketIndex("LCP", edges[0] + 0.001), 1);
  assert.equal(bucketIndex("LCP", 2500), edges.indexOf(2500));
  assert.equal(bucketIndex("LCP", edges.at(-1) + 1), constants.VITALS_BUCKET_COUNT - 1);
  assert.equal(bucketIndex("CLS", 0.1), constants.vitalsBucketEdges("CLS").indexOf(0.1));
});

// ---------------------------------------------------------------- p75 + bands

test("p75FromBuckets reports the upper edge of the bucket holding the 75th percentile", () => {
  const n = constants.VITALS_BUCKET_COUNT;
  const edges = constants.vitalsBucketEdges("LCP");
  const empty = Array(n).fill(0);
  assert.equal(p75FromBuckets("LCP", empty), null);
  const one = empty.slice(); one[3] = 1;
  assert.equal(p75FromBuckets("LCP", one), edges[3]);
  const spread = empty.slice(); spread[0] = 74; spread[5] = 26; // 75th sample sits in bucket 5
  assert.equal(p75FromBuckets("LCP", spread), edges[5]);
  const exact = empty.slice(); exact[0] = 75; exact[9] = 25; // 75th sample is the last of bucket 0
  assert.equal(p75FromBuckets("LCP", exact), edges[0]);
  const overflow = empty.slice(); overflow[n - 1] = 4;
  assert.equal(p75FromBuckets("LCP", overflow), constants.VITALS_METRIC_MAX.LCP);
});

test("vitalsBand uses Google's published thresholds (inclusive good / needs-improvement)", () => {
  assert.equal(vitalsBand("LCP", 2500), "good");
  assert.equal(vitalsBand("LCP", 2501), "needs-improvement");
  assert.equal(vitalsBand("LCP", 4000), "needs-improvement");
  assert.equal(vitalsBand("LCP", 4001), "poor");
  assert.equal(vitalsBand("INP", 200), "good");
  assert.equal(vitalsBand("INP", 500), "needs-improvement");
  assert.equal(vitalsBand("CLS", 0.1), "good");
  assert.equal(vitalsBand("CLS", 0.25), "needs-improvement");
  assert.equal(vitalsBand("CLS", 0.3), "poor");
  assert.equal(vitalsBand("FCP", 3001), "poor");
  assert.equal(vitalsBand("TTFB", 800), "good");
  assert.equal(vitalsBand("TTFB", 1801), "poor");
  assert.equal(vitalsBand("LCP", null), null);
});

// ---------------------------------------------------------------- migration

test("migration 0079 is CREATE-only and has no identifying column", () => {
  const sql = read(MIGRATION);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(ALTER|DROP|INSERT|UPDATE|DELETE)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS web_vitals_daily/);
  const env = makeEnv();
  const columns = env.__sqlite.prepare("PRAGMA table_info(web_vitals_daily)").all().map((c) => c.name);
  const expected = ["day", "route", "metric", "count", ...Array.from({ length: constants.VITALS_BUCKET_COUNT }, (_, i) => "b" + i)];
  assert.deepEqual(columns.sort(), expected.sort());
  for (const name of columns) {
    // No identifying word anywhere in a column name, and no "...id" column.
    assert.doesNotMatch(name, /(?:ip|user|agent|cookie|session|email|url|path|query|time)/i, name);
    assert.ok(!name.toLowerCase().endsWith("id"), name);
  }
});

// ---------------------------------------------------------------- the beacon route

test("POST /api/vitals answers 204 and adds one sample to today's (route, metric) histogram", async () => {
  const env = makeEnv();
  const first = await post(env, { route: "post", metrics: { LCP: 2400, CLS: 0.05 } });
  assert.equal(first.status, 204);
  assert.equal(await first.text(), "");
  // sendBeacon posts a string body as text/plain;charset=UTF-8.
  await post(env, { route: "post", metrics: { LCP: 4100 } }, { headers: { "Content-Type": "text/plain;charset=UTF-8" } });
  const [cls, lcp] = rows(env);
  assert.equal(lcp.day, today());
  assert.equal(lcp.route, "post");
  assert.equal(lcp.metric, "LCP");
  assert.equal(lcp.count, 2);
  const buckets = bucketsOf(lcp);
  assert.equal(buckets[bucketIndex("LCP", 2400)], 1);
  assert.equal(buckets[bucketIndex("LCP", 4100)], 1);
  assert.equal(buckets.reduce((a, b) => a + b, 0), 2);
  assert.equal(cls.metric, "CLS");
  assert.equal(cls.count, 1);
});

test("invalid, oversize, cross-origin, non-JSON and rate-limited beacons answer 204 and write nothing", async () => {
  const env = makeEnv();
  const cases = [
    () => post(env, { route: "post", metrics: { FID: 3 } }),
    () => post(env, { route: "nowhere", metrics: { LCP: 3 } }),
    () => post(env, { route: "post", metrics: { LCP: 3 } }, { raw: "{" }),
    () => post(env, null, { raw: JSON.stringify({ route: "post", metrics: { LCP: 3 }, pad: "x".repeat(constants.VITALS_MAX_BODY_BYTES) }) }),
    () => post(env, { route: "post", metrics: { LCP: 3 } }, { origin: "https://evil.example" }),
    () => post(env, { route: "post", metrics: { LCP: 3 } }, { origin: null }),
    () => post(env, { route: "post", metrics: { LCP: 3 } }, { headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
  ];
  for (const send of cases) {
    const response = await send();
    assert.equal(response.status, 204);
  }
  const limited = makeEnv({ READ_RATE_LIMITER: { limit: async () => ({ success: false }) } });
  assert.equal((await post(limited, { route: "post", metrics: { LCP: 3 } })).status, 204);
  assert.deepEqual(rows(env), []);
  assert.deepEqual(rows(limited), []);
});

test("nothing identifying is bound: no IP, user agent, member id or cookie; day-granular; < 100 binds", async () => {
  const { env, log } = capturingEnv();
  const { id, session } = await signedIn(env, "member");
  const response = await post(env, { route: "profile", metrics: { LCP: 900, INP: 120, CLS: 0.01, FCP: 700, TTFB: 300 } },
    { headers: { Cookie: session.cookie, "X-Forwarded-For": IP, Referer: ORIGIN + "/users/bob" } });
  assert.equal(response.status, 204);
  const vitals = log.filter((entry) => /web_vitals_daily/.test(entry.sql));
  assert.ok(vitals.length >= 5, "one upsert per metric");
  const token = session.cookie.split("=")[1];
  for (const entry of log) {
    assert.doesNotMatch(entry.sql, /\bsessions\b|\busers\b/, "the beacon never looks up who sent it");
    for (const value of entry.binds) {
      const text = String(value);
      for (const leak of [IP, UA, token, session.csrf, "bob", "/users/"]) assert.ok(!text.includes(leak), `${leak} in ${entry.sql}`);
    }
    assert.ok(entry.binds.length < constants.D1_MAX_BOUND_PARAMS, entry.sql);
  }
  for (const entry of vitals) {
    assert.doesNotMatch(entry.sql, /ip|agent|user|cookie|session/i);
    assert.ok(!entry.binds.includes(id), "no member id bound");
    for (const value of entry.binds) {
      if (typeof value === "string" && /^\d{4}-/.test(value)) assert.match(value, /^\d{4}-\d{2}-\d{2}$/, "UTC day only");
    }
  }
  const dump = JSON.stringify(rows(env));
  for (const leak of [IP, UA, "bob"]) assert.ok(!dump.includes(leak), leak);
});

test("rows older than the retention window are pruned on write", async () => {
  const env = makeEnv();
  const insert = env.__sqlite.prepare("INSERT INTO web_vitals_daily (day, route, metric, count, b0) VALUES (?, 'home', 'LCP', 1, 1)");
  insert.run(daysAgo(constants.VITALS_RETENTION_DAYS + 5));
  insert.run(daysAgo(constants.VITALS_RETENTION_DAYS - 5));
  await post(env, { route: "post", metrics: { LCP: 100 } });
  const days = rows(env).map((row) => row.day).sort();
  assert.deepEqual(days, [daysAgo(constants.VITALS_RETENTION_DAYS - 5), today()].sort());
});

// ---------------------------------------------------------------- staff read

function seedHistogram(env, day, route, metric, buckets) {
  const n = constants.VITALS_BUCKET_COUNT;
  const cols = Array.from({ length: n }, (_, i) => "b" + i);
  const values = Array.from({ length: n }, (_, i) => buckets[i] || 0);
  env.__sqlite.prepare(`INSERT INTO web_vitals_daily (day, route, metric, count, ${cols.join(", ")}) VALUES (?, ?, ?, ?, ${cols.map(() => "?").join(", ")})`)
    .run(day, route, metric, values.reduce((a, b) => a + b, 0), ...values);
}

test("GET /api/admin/site-health: anonymous 401, member 403", async () => {
  const env = makeEnv();
  const anon = await worker.fetch(new Request(ORIGIN + "/api/admin/site-health"), env, { waitUntil() {} });
  assert.equal(anon.status, 401);
  const { session } = await signedIn(env, "member");
  const member = await worker.fetch(new Request(ORIGIN + "/api/admin/site-health", { headers: { Cookie: session.cookie } }), env, { waitUntil() {} });
  assert.equal(member.status, 403);
});

test("staff get p75 + band + sample count per (route, metric) for 7 and 28 days", async () => {
  const env = makeEnv();
  const edges = constants.vitalsBucketEdges("LCP");
  const good = edges.indexOf(2000);
  const poor = edges.indexOf(5000);
  seedHistogram(env, today(), "post", "LCP", { [good]: 10 });
  seedHistogram(env, daysAgo(20), "post", "LCP", { [poor]: 90 });
  seedHistogram(env, daysAgo(60), "post", "LCP", { [poor]: 999 });
  const { session } = await signedIn(env, "moderator");
  const response = await worker.fetch(new Request(ORIGIN + "/api/admin/site-health", { headers: { Cookie: session.cookie } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.retentionDays, 90);
  const row = data.rows.find((r) => r.route === "post" && r.metric === "LCP");
  assert.deepEqual(row.week, { p75: 2000, band: "good", count: 10 });
  assert.deepEqual(row.month, { p75: 5000, band: "poor", count: 100 });
});

// ---------------------------------------------------------------- client

test("vitalsAllowed: Global Privacy Control or Do Not Track turns collection off", () => {
  assert.equal(vitalsAllowed({ globalPrivacyControl: true }), false);
  assert.equal(vitalsAllowed({ doNotTrack: "1" }), false);
  assert.equal(vitalsAllowed({ globalPrivacyControl: false, doNotTrack: "0" }), true);
  assert.equal(vitalsAllowed({ doNotTrack: "unspecified" }), true);
  assert.equal(vitalsAllowed({}), true);
});

test("routeTemplate is the route NAME only; not-found is never sent", () => {
  assert.equal(routeTemplate({ pathname: "/posts/4242", search: "" }), "post");
  assert.equal(routeTemplate({ pathname: "/users/alice", search: "" }), "profile");
  assert.equal(routeTemplate({ pathname: "/", search: "?q=secret" }), "search");
  assert.equal(routeTemplate({ pathname: "/x/y/z", search: "" }), null);
});

test("vitalsBody: {route, metrics} with known, finite, non-negative values only", () => {
  assert.equal(vitalsBody("post", {}), null);
  assert.equal(vitalsBody(null, { LCP: 1 }), null);
  assert.deepEqual(JSON.parse(vitalsBody("post", { LCP: 1200.4, CLS: 0.01, FID: 3, INP: NaN })),
    { route: "post", metrics: { LCP: 1200.4, CLS: 0.01 } });
});

test("sendVitals prefers sendBeacon, falls back to fetch keepalive without credentials", () => {
  const beacons = [];
  const fetches = [];
  const fetchImpl = (...args) => { fetches.push(args); return Promise.resolve(); };
  sendVitals({ sendBeacon: (url, data) => { beacons.push([url, data]); return true; } }, fetchImpl, "{}");
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0][0], VITALS_ENDPOINT);
  assert.equal(fetches.length, 0);
  sendVitals({ sendBeacon: () => false }, fetchImpl, "{}");
  sendVitals({}, fetchImpl, "{}");
  assert.equal(fetches.length, 2);
  for (const [url, init] of fetches) {
    assert.equal(url, VITALS_ENDPOINT);
    assert.equal(init.method, "POST");
    assert.equal(init.keepalive, true);
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers["Content-Type"], "application/json");
  }
});

function clientHarness(nav) {
  const listeners = {};
  const doc = { visibilityState: "visible", addEventListener: (type, fn) => (listeners[type] ??= []).push(fn) };
  const win = { addEventListener: (type, fn) => (listeners["win:" + type] ??= []).push(fn) };
  const idle = [];
  const loads = [];
  const sent = [];
  const handlers = {};
  const library = Object.fromEntries(VITALS_METRICS.map((name) => ["on" + name, (fn) => { handlers[name] = fn; }]));
  startVitals({
    win, doc, nav: { ...nav, sendBeacon: (url, data) => { sent.push([url, data]); return true; } },
    loc: { pathname: "/posts/9", search: "" },
    whenIdle: (fn) => idle.push(fn),
    loadLibrary: (src) => { loads.push(src); return Promise.resolve(); },
    getLibrary: () => library,
    fetchImpl: () => Promise.resolve(),
  });
  const hide = () => { doc.visibilityState = "hidden"; for (const fn of listeners.visibilitychange ?? []) fn(); };
  return { idle, loads, sent, handlers, hide, listeners };
}

test("GPC / DNT: the library is never loaded and no beacon is ever sent", async () => {
  for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: "1" }]) {
    const h = clientHarness(nav);
    assert.equal(h.idle.length, 0, "nothing even scheduled");
    assert.equal(h.loads.length, 0);
    h.hide();
    assert.equal(h.sent.length, 0);
  }
});

test("allowed: the vendor script loads once the page is idle, and exactly one beacon goes per page view", async () => {
  const h = clientHarness({});
  assert.equal(h.loads.length, 0, "not loaded before idle");
  assert.equal(h.idle.length, 1);
  await h.idle[0]();
  assert.deepEqual(h.loads, [WEB_VITALS_SRC]);
  assert.deepEqual(Object.keys(h.handlers).sort(), [...VITALS_METRICS].sort());
  h.handlers.LCP({ name: "LCP", value: 1500 });
  h.handlers.CLS({ name: "CLS", value: 0.02 });
  h.handlers.LCP({ name: "LCP", value: 1600 });
  h.hide();
  h.hide();
  for (const fn of h.listeners["win:pagehide"] ?? []) fn();
  assert.equal(h.sent.length, 1);
  const [url, data] = h.sent[0];
  assert.equal(url, VITALS_ENDPOINT);
  assert.equal(typeof data, "string", "a string body (text/plain), never a JSON Blob");
  const body = JSON.parse(data);
  assert.deepEqual(body, { route: "post", metrics: { LCP: 1600, CLS: 0.02 } });
});

test("vitals.js never reads cookies, storage, the user agent or the full URL", () => {
  const src = read("public/js/vitals.js").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /document\.cookie|localStorage|sessionStorage|userAgent|location\.href|\bapi\(/);
  assert.doesNotMatch(src, /https?:\/\//, "same-origin only, no third party");
});

test("app.js starts the collector", () => {
  assert.match(read("public/js/app.js"), /import \{ startVitals \} from "\.\/vitals\.js";/);
  assert.match(read("public/js/app.js"), /startVitals\(\)/);
});

// ---------------------------------------------------------------- vendor + CSP

test("public/js/vendor/web-vitals.iife.js is web-vitals 6.2.3, byte for byte", () => {
  const bytes = readFileSync(new URL(VENDOR_FILE, ROOT));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), VENDOR_SHA256);
  assert.match(bytes.toString("utf8"), /^var webVitals=function/);
});

test("REUSE.toml annotates web-vitals as Apache-2.0 (Google LLC), after the vendor glob, and the license text ships", () => {
  const reuse = read("REUSE.toml");
  const blocks = reuse.split("[[annotations]]");
  const index = blocks.findIndex((part) => part.includes('"public/js/vendor/web-vitals.iife.js"'));
  const glob = blocks.findIndex((part) => part.includes('"public/js/vendor/**"'));
  assert.ok(index > glob && glob > 0, "the specific block comes after the glob (last match wins)");
  assert.match(blocks[index], /SPDX-License-Identifier = "Apache-2.0"/);
  assert.match(blocks[index], /SPDX-FileCopyrightText = "Google LLC"/);
  assert.match(blocks[index], /precedence = "override"/);
  assert.match(read("LICENSES/Apache-2.0.txt"), /Apache License\s+Version 2\.0, January 2004/);
});

test("CSP is unchanged and the loader builds a same-origin script element", () => {
  const csp = secureResponse(new Response("x")).headers.get("Content-Security-Policy");
  const scriptSrc = (csp.match(/script-src ([^;]+);/) ?? [])[1].split(/\s+/);
  assert.deepEqual(scriptSrc, ["'self'"]);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|cdnjs/);
  assert.match(read("public/js/vitals.js"), /createElement\("script"\)/);
  assert.equal(WEB_VITALS_SRC, "/js/vendor/web-vitals.iife.js");
  assert.doesNotMatch(read("public/index.html"), /web-vitals/i);
});

// ---------------------------------------------------------------- desk UI

test("the desk lists Site health and loads /api/admin/site-health", () => {
  const admin = read("public/js/routes/admin.js");
  assert.match(admin, /\{ slug: "site-health", labelKey: "admin\.section\.siteHealth" \}/);
  assert.match(admin, /api\("\/api\/admin\/site-health"\)/);
  assert.match(admin, /createSiteHealthPanel\(data, document\)/);
});

test("createSiteHealthPanel paints an accessible table with a band class per cell", () => {
  const doc = makeFakeDocument();
  const panel = createSiteHealthPanel({
    retentionDays: 90,
    rows: [
      { route: "post", metric: "LCP", week: { p75: 2000, band: "good", count: 10 }, month: { p75: 5000, band: "poor", count: 100 } },
      { route: "home", metric: "CLS", week: { p75: null, band: null, count: 0 }, month: { p75: 0.15, band: "needs-improvement", count: 3 } },
    ],
  }, doc);
  assert.ok(panel instanceof FakeNode);
  const table = panel.querySelector("table");
  assert.ok(table, "a table");
  assert.ok(table.querySelector("caption"));
  assert.equal(table.querySelectorAll("[scope=col]").length, 4);
  assert.ok(findByClass(panel, "health-good"));
  assert.ok(findByClass(panel, "health-poor"));
  assert.ok(findByClass(panel, "health-needs-improvement"));
  const empty = createSiteHealthPanel({ retentionDays: 90, rows: [] }, doc);
  assert.ok(findByClass(empty, "empty-state"));
});

test("new strings exist in en.json, including the privacy note in Your data", () => {
  const en = JSON.parse(read("public/locales/en.json"));
  for (const key of ["admin.section.siteHealth", "admin.lede.siteHealth", "desk.health.privacyNote", "desk.health.good",
    "desk.health.needsWork", "desk.health.poor", "settings.vitalsNote"]) assert.ok(en[key], key);
  assert.match(en["settings.vitalsNote"], /Global Privacy Control/);
  assert.match(read("public/js/data-export.js"), /t\("settings\.vitalsNote"\)/);
  assert.ok(existsSync(new URL(MIGRATION, ROOT)));
});
