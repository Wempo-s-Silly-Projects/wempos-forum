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
// static assets answer. The gate itself is the whole, unmodified Anubis
// program (TecharoHQ/anubis, MIT), planned to run as a container behind the
// worker; until that binding (env.ANUBIS) exists the seam passes everything
// through. Nothing here reads, logs or forwards secrets.
import { ANUBIS_RESERVED_PREFIX, STATIC_HTML_PAGES } from "../../constants.mjs";

// Never gated: the JSON API, agent and discovery surfaces, feeds, the
// worker's standalone pages, Anubis's own reserved paths, and static assets.
const EXEMPT_PREFIXES = Object.freeze(["/api/", "/.well-known/", ANUBIS_RESERVED_PREFIX, "/js/", "/locales/", "/icons/", "/fonts/"]);
const EXEMPT_EXACT = new Set([
  "/mcp", "/feed.xml", "/llms.txt", "/robots.txt", "/sitemap.xml", "/openapi.json", "/auth.md",
  ...STATIC_HTML_PAGES, ...STATIC_HTML_PAGES.map((page) => page.replace(/\.html$/, "")),
]);
const BOARD_FEED = /^\/c\/[^/]+\/feed\.xml$/;
// A last path segment with one of these extensions is a file, never a page.
const STATIC_EXTENSION = /\.(?:css|m?js|json|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|webmanifest|wasm|txt|xml)$/i;
const GATED_METHODS = new Set(["GET", "HEAD"]);

// isAnubisExemptPath(pathname) -> true when the gate must never see it. A
// value that is not an absolute path is not a document route: exempt.
export function isAnubisExemptPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return true;
  if (EXEMPT_EXACT.has(pathname) || BOARD_FEED.test(pathname)) return true;
  if (EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return STATIC_EXTENSION.test(lastSegment);
}

// anubisGateApplies(request) -> true for a GET/HEAD that asks for an HTML
// document at a non-exempt path. Mutations are never gated.
export function anubisGateApplies(request) {
  if (!GATED_METHODS.has(String(request.method).toUpperCase())) return false;
  if (!(request.headers.get("Accept") || "").toLowerCase().includes("text/html")) return false;
  return !isAnubisExemptPath(new URL(request.url).pathname);
}

// anubisGate(request, env) -> a Response that replaces the page (an Anubis
// challenge), or null to let the page through. No binding = pass through.
export async function anubisGate(request, env) {
  if (!anubisGateApplies(request)) return null;
  if (!env || !env.ANUBIS) return null;
  // TODO(anubis container): forward-auth. Ask the Anubis container (env.ANUBIS)
  // to judge this request (its forward-auth check endpoint, with the original
  // method, URL, cookies and client headers); a 2xx means pass (return null),
  // anything else is the challenge or deny response to return as-is. Until the
  // owner settles the container infrastructure, a bound ANUBIS still passes.
  return null;
}
