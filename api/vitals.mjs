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

// Anonymous Core Web Vitals. POST /api/vitals takes one small JSON beacon per
// page view — { route, metrics: { LCP, INP, CLS, FCP, TTFB } } — and adds each
// value to today's histogram for (route NAME, metric) in web_vitals_daily
// (migrations/0079). Nothing that identifies a person is read or written: no
// session or cookie lookup, no IP, no user agent, no URL, no per-sample row,
// no time finer than the UTC day. The rate limiter hashes the caller's
// network address into a throwaway limiter key (the same keying as every
// other anonymous limit); it is never stored.
//
// The beacon always answers 204 — a bad, oversized, cross-origin or
// rate-limited beacon is simply dropped, so it tells a sender nothing.
// Staff read p75 per (route, metric) at GET /api/admin/site-health.
import { assertSameOrigin, requireStaff } from "./core/auth.mjs";
import { json, rateLimit, readLimitedBody } from "./core/http.mjs";
import { utcDay } from "./analytics.mjs";
import { ROUTE_NAMES } from "../public/js/router.js";
import {
  VITALS_BUCKET_COUNT, VITALS_MAX_BODY_BYTES, VITALS_METRICS, VITALS_METRIC_MAX, VITALS_RETENTION_DAYS,
  VITALS_RETENTION_DELETE_LIMIT, VITALS_THRESHOLDS, VITALS_WINDOWS, vitalsBucketEdges,
} from "../constants.mjs";

const VITALS_ROUTES = ROUTE_NAMES.filter((name) => name !== "not-found");
const BEACON_KEYS = "metrics,route";
const BEACON_TYPES = ["application/json", "text/plain"];
const P75 = 0.75;
const READ_ROW_LIMIT = 1000;
// Column names come only from this fixed list, never from input.
const BUCKET_COLUMNS = Object.freeze(Array.from({ length: VITALS_BUCKET_COUNT }, (_, i) => "b" + i));

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

const validMetric = ([name, value]) =>
  VITALS_METRICS.includes(name) && typeof value === "number" && Number.isFinite(value) &&
  value >= 0 && value <= VITALS_METRIC_MAX[name];

// The whole beacon or nothing: exactly { route, metrics }, a known route
// name, 1..5 known metrics, each a finite number in [0, cap].
export function validateVitalsBeacon(body) {
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== BEACON_KEYS) return null;
  const { route, metrics } = body;
  if (typeof route !== "string" || !VITALS_ROUTES.includes(route) || !isPlainObject(metrics)) return null;
  const entries = Object.entries(metrics);
  if (entries.length === 0 || entries.length > VITALS_METRICS.length) return null;
  return entries.every(validMetric) ? { route, metrics: entries } : null;
}

export function bucketIndex(metric, value) {
  const edges = vitalsBucketEdges(metric);
  const index = edges.findIndex((edge) => value <= edge);
  return index === -1 ? edges.length : index;
}

// The upper edge of the bucket holding the 75th-percentile sample (the
// metric's cap for the overflow bucket); null with no samples.
export function p75FromBuckets(metric, buckets) {
  const counts = buckets.map((value) => Number(value) || 0);
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  const target = Math.ceil(total * P75);
  const edges = vitalsBucketEdges(metric);
  let seen = 0;
  for (let i = 0; i < counts.length; i += 1) {
    seen += counts[i];
    if (seen >= target) return i < edges.length ? edges[i] : VITALS_METRIC_MAX[metric];
  }
  return VITALS_METRIC_MAX[metric];
}

export function vitalsBand(metric, value) {
  if (value === null || value === undefined) return null;
  const [good, poor] = VITALS_THRESHOLDS[metric];
  if (value <= good) return "good";
  return value <= poor ? "needs-improvement" : "poor";
}

const pruneStatement = (db) => db.prepare(
  "DELETE FROM web_vitals_daily WHERE rowid IN (SELECT rowid FROM web_vitals_daily WHERE day < ? LIMIT ?)",
).bind(utcDay(VITALS_RETENTION_DAYS), VITALS_RETENTION_DELETE_LIMIT);

function upsertStatement(db, day, route, metric, value) {
  const column = BUCKET_COLUMNS[bucketIndex(metric, value)];
  return db.prepare(
    `INSERT INTO web_vitals_daily (day, route, metric, count, ${column}) VALUES (?, ?, ?, 1, 1) ` +
    `ON CONFLICT(day, route, metric) DO UPDATE SET count = count + 1, ${column} = ${column} + 1`,
  ).bind(day, route, metric);
}

// sendBeacon posts a string as text/plain (a JSON Blob type is refused by
// some browsers), so both types are read as JSON; anything else is dropped.
async function readBeaconBody(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!BEACON_TYPES.some((allowed) => type.startsWith(allowed))) return null;
  const bytes = await readLimitedBody(request, VITALS_MAX_BODY_BYTES);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

async function recordBeacon(request, env) {
  assertSameOrigin(request);
  await rateLimit(request, env, "vitals");
  const beacon = validateVitalsBeacon(await readBeaconBody(request));
  if (!beacon) return;
  const db = env.FORUM_DB;
  const day = utcDay();
  await db.batch([
    pruneStatement(db),
    ...beacon.metrics.map(([metric, value]) => upsertStatement(db, day, beacon.route, metric, value)),
  ]);
}

const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

async function receiveBeacon(request, env) {
  try {
    await recordBeacon(request, env);
  } catch (error) {
    // Expected drops (bad origin, limiter, body, JSON) are HttpErrors;
    // anything else is logged by name only, and the sender still gets 204.
    if (!(error && error.status)) {
      console.error("Web vitals beacon dropped:", error && error.name ? error.name : "UnknownError");
    }
  }
  return noContent();
}

function windowSummary(metric, row) {
  if (!row) return { p75: null, band: null, count: 0 };
  const p75 = p75FromBuckets(metric, BUCKET_COLUMNS.map((column) => row[column]));
  return { p75, band: vitalsBand(metric, p75), count: Number(row.count) || 0 };
}

const windowQuery = (db, days) => db.prepare(
  `SELECT route, metric, SUM(count) AS count, ${BUCKET_COLUMNS.map((c) => `SUM(${c}) AS ${c}`).join(", ")} ` +
  "FROM web_vitals_daily WHERE day >= ? GROUP BY route, metric ORDER BY route, metric LIMIT ?",
).bind(utcDay(days - 1), READ_ROW_LIMIT);

async function readSiteHealth(request, env) {
  await requireStaff(request, env, false);
  const db = env.FORUM_DB;
  await pruneStatement(db).run();
  const [week, month] = await Promise.all([
    windowQuery(db, VITALS_WINDOWS.week).all(),
    windowQuery(db, VITALS_WINDOWS.month).all(),
  ]);
  const key = (row) => row.route + "\u0000" + row.metric;
  const weekRows = new Map((week.results || []).map((row) => [key(row), row]));
  const rows = (month.results || [])
    .filter((row) => VITALS_METRICS.includes(row.metric))
    .map((row) => ({
      route: String(row.route),
      metric: String(row.metric),
      week: windowSummary(row.metric, weekRows.get(key(row))),
      month: windowSummary(row.metric, row),
    }));
  return json({ retentionDays: VITALS_RETENTION_DAYS, windows: VITALS_WINDOWS, rows });
}

export async function handleVitalsRoutes(request, env, url, path, method) {
  if (path === "/api/vitals" && method === "POST") return receiveBeacon(request, env);
  if (path === "/api/admin/site-health" && method === "GET") return readSiteHealth(request, env);
  return null;
}
