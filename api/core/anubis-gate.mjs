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

// The Anubis seam (owner order, Nov 22). In HUMAN_CHECK=anubis mode the
// worker hands every HTML document navigation to anubisGate() before the
// static assets answer, and forwards /.within.website/** to Anubis through
// anubisProxy() so its challenge pages, assets and pass endpoint stay
// same-origin. Anubis itself is the whole, unmodified program
// (TecharoHQ/anubis v1.28.2, MIT) in subrequest/forward-auth mode (TARGET=" ")
// at ANUBIS_URL, optionally behind a Cloudflare Access service token. Any
// failure to reach it fails OPEN to the self-hosted ALTCHA check: the page is
// served and its shell meta says "altcha" (the visitor holds no pass cookie).
// Nothing here logs or returns the Access secrets.
import {
  ANUBIS_API_EXEMPT_EXACT, ANUBIS_API_EXEMPT_PREFIXES, ANUBIS_CHECK_PATH, ANUBIS_CHECK_TIMEOUT_MS,
  ANUBIS_CLIENT_IP_HEADER, ANUBIS_COOKIE_PATTERN, ANUBIS_PAGE_CSP, ANUBIS_PROXY_MAX_BODY_BYTES,
  ANUBIS_PROXY_TIMEOUT_MS, ANUBIS_RESERVED_PREFIX, STATIC_HTML_PAGES,
} from "../../constants.mjs";
import { agentFromRequest } from "./agent-auth.mjs";
import { anubisConfig, hasAnubisPass } from "./anubis-pass.mjs";
import { readSession } from "./auth.mjs";
import { siteOrigin } from "./site.mjs";

// Never gated: the JSON API, agent and discovery surfaces, feeds, the
// worker's standalone pages, Anubis's own reserved paths, and static assets.
const EXEMPT_PREFIXES = Object.freeze(["/api/", "/.well-known/", ANUBIS_RESERVED_PREFIX, "/js/", "/locales/", "/icons/", "/fonts/"]);
const EXEMPT_EXACT = new Set([
  "/mcp", "/feed.xml", "/llms.txt", "/robots.txt", "/sitemap.xml", "/openapi.json", "/auth.md",
  ...STATIC_HTML_PAGES, ...STATIC_HTML_PAGES.map((page) => page.replace(/\.html$/, "")),
]);
const BOARD_FEED = /^\/c\/[^/]+\/feed\.xml$/;
// A top-level file (/styles.css, /sw.js, /favicon.ico...) with one of these
// extensions is a static asset; deeper paths are exempt only under the
// static prefixes above (review L4: /c/x/y.json is a page route).
const STATIC_EXTENSION = /\.(?:css|m?js|json|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|webmanifest|wasm|txt|xml)$/i;
const GATED_METHODS = new Set(["GET", "HEAD"]);

// isAnubisExemptPath(pathname) -> true when the gate must never see it. A
// value that is not an absolute path is not a document route: exempt.
export function isAnubisExemptPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return true;
  if (EXEMPT_EXACT.has(pathname) || BOARD_FEED.test(pathname)) return true;
  if (EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const topLevelFile = pathname.lastIndexOf("/") === 0;
  return topLevelFile && STATIC_EXTENSION.test(pathname.slice(1));
}

// anubisGateApplies(request) -> true for a GET/HEAD that asks for an HTML
// document at a non-exempt path. Mutations are never gated.
export function anubisGateApplies(request) {
  if (!GATED_METHODS.has(String(request.method).toUpperCase())) return false;
  if (!(request.headers.get("Accept") || "").toLowerCase().includes("text/html")) return false;
  return !isAnubisExemptPath(new URL(request.url).pathname);
}

const PASSED_REQUEST_HEADERS = ["User-Agent", "Accept", "Accept-Language"];
const PASSED_RESPONSE_HEADERS = ["Content-Type", "Content-Security-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options"];
const PROXY_METHODS = new Set(["GET", "HEAD", "POST"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const GATE_REDIRECT_STATUSES = new Set([303, 307]);
const ACCESS_HOST_SUFFIX = ".cloudflareaccess.com";
// Every Anubis page (deny included) links its own /.within.website/ assets;
// a 401/403 without that marker came from Cloudflare Access, not Anubis.
const ANUBIS_BODY_MARKER = ANUBIS_RESERVED_PREFIX;
const ANUBIS_DOWN = "The human check is temporarily unavailable. Please try again shortly.";
// Characters no honest redirect target carries (backslash tricks, spaces,
// controls): a Location containing any of them is refused outright.
const DEL_CHAR_CODE = 0x7f;
const FIRST_PRINTABLE_CHAR_CODE = 0x20;
const UNSAFE_LOCATION = {
  test: (value) => [...value].some((char) => {
    const code = char.charCodeAt(0);
    return char === "\\" || /\s/.test(char) || code < FIRST_PRINTABLE_CHAR_CODE || code === DEL_CHAR_CODE;
  }),
};

const isAnubisCookie = (pair) => ANUBIS_COOKIE_PATTERN.test(pair.slice(0, Math.max(pair.indexOf("="), 0)).trim());

// Only Anubis's own cookies go to Anubis (review M3): never the forum
// session, Cloudflare Access or any other cookie.
function anubisCookiesOnly(cookieHeader) {
  return (cookieHeader || "").split(";").map((pair) => pair.trim()).filter((pair) => pair && isAnubisCookie(pair)).join("; ");
}

// The request headers Anubis sees: an allowlist, so client-sent
// X-Wempo-Client-Ip / X-Forwarded-* / X-Real-IP / CF-Access-* never pass.
// The client IP comes only from Cloudflare's CF-Connecting-IP.
function upstreamHeaders(request, config, extra = []) {
  const url = new URL(request.url);
  const headers = new Headers();
  for (const name of [...PASSED_REQUEST_HEADERS, ...extra]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookie = anubisCookiesOnly(request.headers.get("Cookie"));
  if (cookie) headers.set("Cookie", cookie);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set(ANUBIS_CLIENT_IP_HEADER, clientIp);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  if (config.access) {
    headers.set("CF-Access-Client-Id", config.access.clientId);
    headers.set("CF-Access-Client-Secret", config.access.clientSecret);
  }
  return headers;
}

// Upstream Set-Cookie lines for Anubis's own cookies only (review L1): the
// tunnel zone's __cf_bm/__cflb, Access's CF_Authorization and anything else
// stay behind.
function passedSetCookies(upstream) {
  const lines = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  return lines.filter((line) => isAnubisCookie(line.trim()));
}

// Anubis's own headers (allowlisted, so the tunnel zone's Report-To, NEL,
// Server-Timing etc. stay behind), never cached, and a strict CSP when
// Anubis sends none. The forum's document CSP is NOT applied: it would break
// Anubis's challenge page.
function anubisResponseHeaders(upstream) {
  const headers = new Headers();
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", ANUBIS_PAGE_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "no-store");
  for (const line of passedSetCookies(upstream)) headers.append("Set-Cookie", line);
  return headers;
}

function parsedUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// A 401, or a 403 that is not an Anubis page, is Cloudflare Access talking.
async function isAccessRefusal(upstream) {
  if (upstream.status === 401) return true;
  if (upstream.status !== 403) return false;
  return !(await upstream.clone().text()).includes(ANUBIS_BODY_MARKER);
}

function failOpen(reason) {
  console.warn("Anubis check unavailable; serving the page with the ALTCHA fallback:", reason);
  return null;
}

// The gate may only send a visitor to Anubis's challenge on OUR origin.
function sameOriginChallenge(location, request, env) {
  const target = parsedUrl(location || "");
  const site = new URL(siteOrigin(env, request));
  if (!target || target.protocol !== "https:" || target.host !== site.host) return null;
  // Rebuilt on the site's own origin: only the path and query are taken over.
  return target.pathname.startsWith(ANUBIS_RESERVED_PREFIX) ? site.origin + target.pathname + target.search : null;
}

async function judge(upstream, request, env) {
  if (upstream.status === 200) return null;
  if (await isAccessRefusal(upstream)) return failOpen("access " + upstream.status);
  if (upstream.status === 403) {
    return new Response(await upstream.text(), { status: 403, headers: anubisResponseHeaders(upstream) });
  }
  if (REDIRECT_STATUSES.has(upstream.status)) {
    const location = sameOriginChallenge(upstream.headers.get("Location"), request, env);
    if (!location) return failOpen("redirect refused");
    const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
    for (const line of passedSetCookies(upstream)) headers.append("Set-Cookie", line);
    return new Response(null, { status: GATE_REDIRECT_STATUSES.has(upstream.status) ? upstream.status : 307, headers });
  }
  return failOpen("status " + upstream.status);
}

// askAnubis(request, config) -> Anubis's forward-auth verdict Response for
// this request, or null when it could not be reached in time.
async function askAnubis(request, config) {
  const url = new URL(request.url);
  const headers = upstreamHeaders(request, config);
  headers.set("X-Forwarded-Uri", url.pathname + url.search);
  headers.set("X-Forwarded-Method", String(request.method).toUpperCase());
  try {
    return await fetch(config.origin + ANUBIS_CHECK_PATH, {
      method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(ANUBIS_CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    return failOpen(error && error.name ? error.name : "network error");
  }
}

// anubisGate(request, env) -> a Response that replaces the page (Anubis's
// deny or a redirect to its challenge), or null to serve the page.
export async function anubisGate(request, env) {
  if (!anubisGateApplies(request)) return null;
  const config = anubisConfig(env);
  if (!config) return null;
  const upstream = await askAnubis(request, config);
  return upstream ? judge(upstream, request, env) : null;
}

function unavailable(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

// anubisApiGateApplies(request) -> true for a GET/HEAD under /api/ that is
// not one of the exempt bootstrap or machine endpoints. Writes are guarded by
// requireHumanCheck instead.
export function anubisApiGateApplies(request) {
  if (!GATED_METHODS.has(String(request.method).toUpperCase())) return false;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/") || ANUBIS_API_EXEMPT_EXACT.includes(pathname)) return false;
  return !ANUBIS_API_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// A signed-in member (a session row with a user) or a configured agent
// token. Both lookups are read-only SELECTs; a lookup failure counts as no.
async function signedIn(request, env) {
  try {
    const session = await readSession(request, env);
    if (session && session.user) return true;
    return Boolean(await agentFromRequest(request, env));
  } catch {
    return false;
  }
}

// anubisApiGate(request, env) -> a JSON refusal for an unauthenticated /api
// read Anubis does not pass (review M2: "no bots at all"), or null to answer.
// A pass cookie or a signed-in caller skips the check; Anubis unreachable
// fails open, as pages do. A challenge is a 401 (JSON clients never follow
// a redirect); the shell reloads into the page gate.
export async function anubisApiGate(request, env) {
  if (!anubisApiGateApplies(request)) return null;
  const config = anubisConfig(env);
  if (!config) return null;
  if (await hasAnubisPass(request, env)) return null;
  if (await signedIn(request, env)) return null;
  const upstream = await askAnubis(request, config);
  if (!upstream || upstream.status === 200) return null;
  if (await isAccessRefusal(upstream)) return failOpen("access " + upstream.status);
  if (upstream.status === 403) return unavailable(403, "Access denied.");
  if (REDIRECT_STATUSES.has(upstream.status)) return unavailable(401, "human check required");
  return failOpen("status " + upstream.status);
}

// Redirects from the proxy stay on our origin (review M1): the Location is
// refused outright if it holds a backslash, whitespace or a control
// character, then resolved against OUR origin; it must land on our origin
// (Anubis's own origin is rewritten to ours). An Access login means Anubis
// is unreachable; anything else is refused.
function proxiedLocation(location, config, request, env) {
  if (!location || UNSAFE_LOCATION.test(location)) return { error: 502 };
  const site = siteOrigin(env, request);
  let target;
  try {
    target = new URL(location, site + "/");
  } catch {
    return { error: 502 };
  }
  if (target.hostname.endsWith(ACCESS_HOST_SUFFIX)) return { error: 503 };
  if (target.origin !== site && target.origin !== config.origin) return { error: 502 };
  if (target.username || target.password) return { error: 502 };
  return { location: site + target.pathname + target.search };
}

// The request body, at most ANUBIS_PROXY_MAX_BODY_BYTES (review L2): a larger
// declared Content-Length is refused before reading, and a body without one
// is read chunk by chunk and abandoned past the cap. null = too large.
async function cappedBody(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > ANUBIS_PROXY_MAX_BODY_BYTES) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > ANUBIS_PROXY_MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// anubisProxy(request, env) -> Anubis's answer for a /.within.website/**
// request, or null when Anubis is not configured (the route falls through).
export async function anubisProxy(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(ANUBIS_RESERVED_PREFIX)) return null;
  const config = anubisConfig(env);
  if (!config) return null;
  const method = String(request.method).toUpperCase();
  if (!PROXY_METHODS.has(method)) return unavailable(405, "Method not allowed.");
  const body = method === "POST" ? await cappedBody(request) : undefined;
  if (body === null) return unavailable(413, "Request body too large.");
  let upstream;
  try {
    upstream = await fetch(config.origin + url.pathname + url.search, {
      method,
      headers: upstreamHeaders(request, config, ["Content-Type", "Referer"]),
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(ANUBIS_PROXY_TIMEOUT_MS),
    });
  } catch {
    return unavailable(503, ANUBIS_DOWN);
  }
  if (await isAccessRefusal(upstream)) return unavailable(503, ANUBIS_DOWN);
  const headers = anubisResponseHeaders(upstream);
  if (REDIRECT_STATUSES.has(upstream.status)) {
    const target = proxiedLocation(upstream.headers.get("Location"), config, request, env);
    if (target.error) return unavailable(target.error, ANUBIS_DOWN);
    headers.set("Location", target.location);
    return new Response(null, { status: upstream.status, headers });
  }
  return new Response(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}
