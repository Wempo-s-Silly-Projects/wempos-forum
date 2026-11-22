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

// Batch K: the forum's service worker, hand-written (Workbox needs a build
// step this repo does not have). Registered as /sw.js?build=<deploy stamp>,
// so each deploy installs a new worker with a new cache and drops the old.
// - Static assets (scripts, styles, locale tables, icons) are cached on first
//   use and then served from the cache for fast repeat loads.
// - /api/* is never touched: requests go straight to the network and no API
//   answer is ever stored (they can carry personal data).
// - Pages are never cached (the HTML can carry personal data); a navigation
//   that fails offline gets the static offline page instead.
"use strict";

const BUILD = new URL(self.location.href).searchParams.get("build") || "unversioned";
const CACHE_PREFIX = "forum-static-";
const CACHE_NAME = CACHE_PREFIX + BUILD;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/styles.css", "/responsive.css"];
const STATIC_PREFIXES = ["/js/", "/locales/", "/icons/"];
const STATIC_FILES = new Set(["/styles.css", "/responsive.css", "/og-image.png", "/og-image.svg"]);

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return STATIC_FILES.has(url.pathname) || STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

// Only a plain, successful, same-origin answer that the server allows to be
// stored, and never an HTML document.
function isStorable(response) {
  if (!response || !response.ok || (response.type && response.type !== "basic" && response.type !== "default")) return false;
  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  if (/no-store|private/.test(cacheControl)) return false;
  return !(response.headers.get("Content-Type") || "").toLowerCase().includes("text/html");
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isStorable(response)) await cache.put(request, response.clone());
  return response;
}

async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkOrOffline(request));
    return;
  }
  if (isStaticAsset(url)) event.respondWith(cacheFirst(request));
});
