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

// Anonymous Core Web Vitals, so staff can see how fast the site feels
// (desk → Site health). Nothing runs when the browser sends Global Privacy
// Control or Do Not Track. Otherwise, once the page is idle, the vendored
// web-vitals build (public/js/vendor/web-vitals.iife.js, Apache-2.0) loads
// as one same-origin script, and when the page is hidden ONE beacon goes to
// /api/vitals with the landing page's route NAME and the measured values —
// no URL, no id, no cookie read, no storage, no third party. The server keeps
// only daily totals (api/vitals.mjs).
import { ROUTE_NAMES, routeForPath } from "./router.js";

export const VITALS_ENDPOINT = "/api/vitals";
export const WEB_VITALS_SRC = "/js/vendor/web-vitals.iife.js";
// Mirrors constants.mjs VITALS_METRICS (pinned equal by
// tests/wave576-web-vitals.test.mjs).
export const VITALS_METRICS = Object.freeze(["LCP", "INP", "CLS", "FCP", "TTFB"]);
export const VITALS_ROUTES = Object.freeze(ROUTE_NAMES.filter((name) => name !== "not-found"));
const IDLE_TIMEOUT_MS = 5000;
const IDLE_FALLBACK_MS = 2000;

export const vitalsAllowed = (nav) =>
  !(nav && (nav.globalPrivacyControl === true || nav.doNotTrack === "1"));

// The route NAME for a location, or null for a page that is not a known type.
export function routeTemplate(loc) {
  const name = routeForPath(loc.pathname, loc.search).name;
  return VITALS_ROUTES.includes(name) ? name : null;
}

const validValue = ([name, value]) =>
  VITALS_METRICS.includes(name) && typeof value === "number" && Number.isFinite(value) && value >= 0;

export function vitalsBody(route, metrics) {
  if (!route) return null;
  const kept = Object.entries(metrics || {}).filter(validValue);
  return kept.length ? JSON.stringify({ route, metrics: Object.fromEntries(kept) }) : null;
}

// sendBeacon with a string body (sent as text/plain); if the browser has no
// beacon or refuses it, a keepalive POST that carries no cookies.
export function sendVitals(nav, fetchImpl, body) {
  try {
    if (typeof nav.sendBeacon === "function" && nav.sendBeacon(VITALS_ENDPOINT, body)) return;
  } catch (error) {
    console.warn("Vitals beacon refused, using fetch:", error && error.name ? error.name : "UnknownError");
  }
  Promise.resolve(fetchImpl(VITALS_ENDPOINT, {
    method: "POST", body, keepalive: true, credentials: "omit", headers: { "Content-Type": "application/json" },
  })).catch((error) => console.warn("Vitals beacon failed:", error && error.name ? error.name : "UnknownError"));
}

function appendScript(doc, src) {
  return new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.setAttribute("src", src);
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(src)), { once: true });
    doc.head.append(script);
  });
}

// After the load event, when the browser is idle (or shortly after, where
// requestIdleCallback is missing).
const defaultWhenIdle = (win, doc) => (fn) => {
  const idle = () => (typeof win.requestIdleCallback === "function"
    ? win.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS })
    : win.setTimeout(fn, IDLE_FALLBACK_MS));
  if (doc.readyState === "complete") idle();
  else win.addEventListener("load", idle, { once: true });
};

export function startVitals({
  win = globalThis.window,
  doc = globalThis.document,
  nav = globalThis.navigator,
  loc = globalThis.location,
  whenIdle = defaultWhenIdle(win, doc),
  loadLibrary = (src) => appendScript(doc, src),
  getLibrary = () => win.webVitals,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  if (!vitalsAllowed(nav)) return;
  const route = routeTemplate(loc);
  if (!route) return;
  const metrics = {};
  let sent = false;
  const flush = () => {
    if (sent) return;
    const body = vitalsBody(route, metrics);
    if (!body) return;
    sent = true;
    sendVitals(nav, fetchImpl, body);
  };
  whenIdle(() => loadLibrary(WEB_VITALS_SRC).then(() => {
    const library = getLibrary();
    if (!library) return;
    for (const name of VITALS_METRICS) library["on" + name]((metric) => { metrics[metric.name] = metric.value; });
    // Registered after the library's own listeners, so CLS / INP are
    // final by the time this runs.
    doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "hidden") flush(); });
    win.addEventListener("pagehide", flush);
  }).catch((error) => console.warn("Web vitals did not load:", error && error.message ? error.message : "UnknownError")));
}
