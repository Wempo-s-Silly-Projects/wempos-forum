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

// Private, first-party analytics (v5.30.0). AGGREGATE COUNTS ONLY:
// page_view_counts holds (UTC day, route NAME, views) and referrer_counts
// holds (UTC day, referring HOST, views) — migrations/0063. Nothing that
// identifies a person is read into a row: no IP, no member id, no user agent,
// no cookie, no path, no query, no per-visit row.
//
// The worker calls scheduleCount() after it has built the HTML shell for a
// page. It never counts when the instance has not switched counting on
// (ANALYTICS_ENABLED exactly "true"), for HEAD/prefetch requests, for
// DNT: 1 or Sec-GPC: 1, for bots, or for anything that is not a 200 HTML
// shell of a known page route. The write rides ctx.waitUntil and every error
// is swallowed to a log line: counting can never slow or break a page.
//
// There is no counting API — the only route here is the staff-only read.
import { requireStaff } from "./core/auth.mjs";
import { HttpError, json } from "./core/http.mjs";
import { isModuleOn } from "./core/modules.mjs";
import { configuredOrigin } from "./core/site.mjs";
import { routeForPath } from "../public/js/router.js";

export const REFERRER_HOST_CAP = 200;
export const RETENTION_DAYS = 90;
export const RETENTION_DELETE_LIMIT = 500;
export const ANALYTICS_WINDOWS = Object.freeze({ "7": 7, "30": 30 });
const DEFAULT_WINDOW = 7;
const TOP_LIMIT = 20;
const MAX_HOST_LENGTH = 253;
const MAX_ROUTE_LENGTH = 32;
const DAY_MS = 86400000;
const HOST_PATTERN = /^[a-z0-9.-]+$/;
// Simple substring list (lower-cased UA). An empty UA is treated as a bot.
const BOT_MARKERS = ["bot", "crawl", "spider", "preview", "slurp", "headless", "facebookexternalhit"];

export const analyticsEnabled = (env) => Boolean(env) && env.ANALYTICS_ENABLED === "true";

// UTC YYYY-MM-DD, `offsetDays` days before now.
export const utcDay = (offsetDays = 0, now = Date.now()) =>
  new Date(now - offsetDays * DAY_MS).toISOString().slice(0, 10);

function looksLikeBot(request) {
  const agent = (request.headers.get("User-Agent") || "").toLowerCase();
  return !agent.trim() || BOT_MARKERS.some((marker) => agent.includes(marker));
}

function optedOut(request) {
  return request.headers.get("DNT") === "1" || request.headers.get("Sec-GPC") === "1";
}

function isPrefetch(request) {
  const purpose = `${request.headers.get("Sec-Purpose") || ""} ${request.headers.get("Purpose") || ""}`.toLowerCase();
  return purpose.includes("prefetch") || purpose.includes("prerender");
}

// The referring site's HOST only (lower-case, no path/query/port), and only
// when it is somebody else's site. Anything unparseable or not http(s) is
// dropped.
export function referrerHost(request, url, env) {
  const raw = request.headers.get("Referer");
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  const host = parsed.hostname.toLowerCase();
  if (!host || host.length > MAX_HOST_LENGTH || !HOST_PATTERN.test(host)) return "";
  const canonical = configuredOrigin(env && env.SITE_ORIGIN);
  const ownHosts = [url.hostname.toLowerCase(), canonical ? new URL(canonical).hostname.toLowerCase() : ""];
  return ownHosts.includes(host) ? "" : host;
}

// What to count for this request + response, or null to count nothing.
export function pageViewPlan(request, env, url, response) {
  if (!analyticsEnabled(env) || !env.FORUM_DB) return null;
  if (request.method.toUpperCase() !== "GET" || isPrefetch(request)) return null;
  if (optedOut(request) || looksLikeBot(request)) return null;
  if (!response || response.status !== 200) return null;
  if (!(response.headers.get("Content-Type") || "").includes("text/html")) return null;
  const route = routeForPath(url.pathname, url.search).name;
  if (!route || route === "not-found") return null;
  return { day: utcDay(), route: String(route).slice(0, MAX_ROUTE_LENGTH), referrer: referrerHost(request, url, env) };
}

export async function recordPageView(env, { day, route, referrer }) {
  const statements = [
    env.FORUM_DB.prepare(
      "INSERT INTO page_view_counts (day, route, views) VALUES (?, ?, 1) " +
      "ON CONFLICT(day, route) DO UPDATE SET views = views + 1",
    ).bind(day, route),
  ];
  if (referrer) {
    // A host already counted today keeps counting; a new host is added only
    // while the day holds fewer than REFERRER_HOST_CAP distinct hosts.
    statements.push(env.FORUM_DB.prepare(
      "INSERT INTO referrer_counts (day, referrer_host, views) SELECT ?, ?, 1 " +
      "WHERE EXISTS (SELECT 1 FROM referrer_counts WHERE day = ? AND referrer_host = ?) " +
      "OR (SELECT COUNT(*) FROM referrer_counts WHERE day = ?) < ? " +
      "ON CONFLICT(day, referrer_host) DO UPDATE SET views = views + 1",
    ).bind(day, referrer, day, referrer, day, REFERRER_HOST_CAP));
  }
  await env.FORUM_DB.batch(statements);
}

// Never throws and never delays the response: the write goes to waitUntil,
// and any failure — planning or writing — becomes a log line.
export function scheduleCount(ctx, request, env, url, response) {
  try {
    if (!ctx || typeof ctx.waitUntil !== "function") return;
    const plan = pageViewPlan(request, env, url, response);
    if (!plan) return;
    // Modules: ANALYTICS_ENABLED is the env hard switch; the owner can also
    // turn the "analytics" module off from the desk.
    const counted = isModuleOn(env, "analytics", request)
      .then((on) => (on ? recordPageView(env, plan) : null));
    ctx.waitUntil(counted.catch((error) => {
      console.error("Analytics count failed (page unaffected):", error);
    }));
  } catch (error) {
    console.error("Analytics count skipped (page unaffected):", error);
  }
}

function windowDays(url) {
  const raw = url.searchParams.get("days");
  if (raw === null) return DEFAULT_WINDOW;
  if (!Object.hasOwn(ANALYTICS_WINDOWS, raw)) throw new HttpError(400, "Choose 7 or 30 days.");
  return ANALYTICS_WINDOWS[raw];
}

// Retention: one bounded batch per read keeps every DELETE small.
function retentionStatements(db, cutoff) {
  return [
    db.prepare(
      "DELETE FROM page_view_counts WHERE rowid IN " +
      "(SELECT rowid FROM page_view_counts WHERE day < ? LIMIT ?)",
    ).bind(cutoff, RETENTION_DELETE_LIMIT),
    db.prepare(
      "DELETE FROM referrer_counts WHERE rowid IN " +
      "(SELECT rowid FROM referrer_counts WHERE day < ? LIMIT ?)",
    ).bind(cutoff, RETENTION_DELETE_LIMIT),
  ];
}

async function readAnalytics(request, env, url) {
  await requireStaff(request, env, false);
  const days = windowDays(url);
  const db = env.FORUM_DB;
  await db.batch(retentionStatements(db, utcDay(RETENTION_DAYS)));
  const since = utcDay(days - 1);
  const [totals, routes, referrers] = await Promise.all([
    db.prepare(
      "SELECT day, SUM(views) AS views FROM page_view_counts WHERE day >= ? " +
      "GROUP BY day ORDER BY day LIMIT ?",
    ).bind(since, days + 1).all(),
    db.prepare(
      "SELECT route, SUM(views) AS views FROM page_view_counts WHERE day >= ? " +
      "GROUP BY route ORDER BY views DESC, route LIMIT ?",
    ).bind(since, TOP_LIMIT).all(),
    db.prepare(
      "SELECT referrer_host AS host, SUM(views) AS views FROM referrer_counts WHERE day >= ? " +
      "GROUP BY referrer_host ORDER BY views DESC, referrer_host LIMIT ?",
    ).bind(since, TOP_LIMIT).all(),
  ]);
  const rows = (result) => (result && result.results) || [];
  return json({
    days,
    enabled: analyticsEnabled(env),
    retentionDays: RETENTION_DAYS,
    totals: rows(totals).map((row) => ({ day: String(row.day), views: Number(row.views) })),
    routes: rows(routes).map((row) => ({ route: String(row.route), views: Number(row.views) })),
    referrers: rows(referrers).map((row) => ({ host: String(row.host), views: Number(row.views) })),
  });
}

export async function handleAnalyticsRoutes(request, env, url, path, method) {
  if (path === "/api/admin/analytics" && method === "GET") return readAnalytics(request, env, url);
  return null;
}
