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

// Link previews (batch L): GET /api/link-preview?url=<https URL> answers the
// page's OpenGraph title, description and site name, fetched by the Worker
// (so the linked site never sees a reader's address) only when a signed-in
// member clicks "Show link preview". Images are never fetched or returned.
//
// SSRF guard, per hop: https only, no credentials, default port; the host
// (or an IP literal) must resolve, and EVERY address it resolves to must be
// public unicast (ipaddr.js range() — loopback, private, link-local,
// unique-local, multicast, reserved, CGNAT, mapped and translated ranges
// all refuse). Redirects are followed by hand (redirect: "manual"), each
// Location re-checked the same way, at most LINK_PREVIEW_MAX_REDIRECTS.
// One AbortSignal bounds the whole chain; only text/html is read, and only
// the first LINK_PREVIEW_MAX_BYTES of it. Every refusal answers the same
// { ok: false }, so the route is not an oracle for which check failed.
// (Cloudflare's own fetch also cannot reach private networks; the guard
// does not rely on that.)
import ipaddr from "ipaddr.js";
import {
  LINK_PREVIEW_DESCRIPTION_MAX_CHARS, LINK_PREVIEW_DOH_ENDPOINT, LINK_PREVIEW_FAILURE_TTL_SECONDS,
  LINK_PREVIEW_MAX_BYTES, LINK_PREVIEW_MAX_REDIRECTS, LINK_PREVIEW_PRUNE_AFTER_SECONDS, LINK_PREVIEW_SITE_MAX_CHARS,
  LINK_PREVIEW_TIMEOUT_MS, LINK_PREVIEW_TITLE_MAX_CHARS, LINK_PREVIEW_TTL_SECONDS, LINK_PREVIEW_URL_MAX_CHARS,
} from "../constants.mjs";
import { assertNotBanned, requireSignedInRead } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit } from "./core/http.mjs";

export const LINK_PREVIEW_PATH = "/api/link-preview";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DNS_TYPES = Object.freeze({ A: 1, AAAA: 28 });
const USER_AGENT = "WemposForumLinkPreview/1.0";
const REFUSED = Object.freeze({ ok: false });

// Public unicast only. ipaddr.process folds ::ffff:a.b.c.d to IPv4 first.
export function isPublicAddress(ip) {
  const text = String(ip ?? "");
  if (!ipaddr.isValid(text)) return false;
  try {
    return ipaddr.process(text).range() === "unicast";
  } catch {
    return false;
  }
}

// The member-supplied string, or null when it is not a plain https URL.
export function checkPreviewUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > LINK_PREVIEW_URL_MAX_CHARS) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname) return null;
  if (url.href.length > LINK_PREVIEW_URL_MAX_CHARS) return null;
  url.hash = "";
  return url;
}

const bareHost = (hostname) => String(hostname ?? "").replace(/^\[(.*)\]$/, "$1");

async function dohLookup(hostname, type, fetcher, signal) {
  const query = new URL(LINK_PREVIEW_DOH_ENDPOINT);
  query.searchParams.set("name", hostname);
  query.searchParams.set("type", type);
  const response = await fetcher(query.href, { headers: { Accept: "application/dns-json" }, signal });
  if (!response.ok) return [];
  const answer = await response.json();
  if (!answer || answer.Status !== 0 || !Array.isArray(answer.Answer)) return [];
  return answer.Answer.filter((record) => record?.type === DNS_TYPES[type]).map((record) => String(record.data));
}

// Every address the host stands for: an IP literal is itself; a name asks
// DNS-over-HTTPS for both A and AAAA (CNAME chains are flattened by the
// resolver; only address records are kept).
export async function resolveHost(hostname, fetcher = fetch, signal) {
  const host = bareHost(hostname);
  if (ipaddr.isValid(host)) return [host];
  const [v4, v6] = await Promise.all([
    dohLookup(host, "A", fetcher, signal),
    dohLookup(host, "AAAA", fetcher, signal),
  ]);
  return [...v4, ...v6];
}

async function hostIsSafe(hostname, fetcher, signal) {
  const addresses = await resolveHost(hostname, fetcher, signal);
  return addresses.length > 0 && addresses.every(isPublicAddress);
}

// Reads at most `limit` bytes of the body, then stops the stream.
async function readCapped(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = limit - total;
    const piece = value.byteLength > room ? value.subarray(0, room) : value;
    chunks.push(piece);
    total += piece.byteLength;
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

const ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " });

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// Entities decoded, control characters dropped, whitespace collapsed, clamped.
function cleanText(raw, max) {
  return Array.from(decodeEntities(String(raw ?? ""))
    .replace(/[\t\n\r\f\v]/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim()).slice(0, max).join("");
}

function metaAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    attributes[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
  }
  return attributes;
}

// title / description / site name from <meta> tags (og:, twitter:, name=)
// with <title> as the last fallback. Never reads an image.
export function parseOpenGraph(html) {
  const source = String(html ?? "");
  const meta = {};
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = metaAttributes(match[0]);
    const key = (attributes.property || attributes.name || "").toLowerCase();
    if (key && attributes.content !== undefined && !(key in meta)) meta[key] = attributes.content;
  }
  const titleTag = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return {
    title: cleanText(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, LINK_PREVIEW_TITLE_MAX_CHARS),
    description: cleanText(meta["og:description"] ?? meta["twitter:description"] ?? meta.description ?? "",
      LINK_PREVIEW_DESCRIPTION_MAX_CHARS),
    siteName: cleanText(meta["og:site_name"] ?? "", LINK_PREVIEW_SITE_MAX_CHARS),
  };
}

async function guardedFetch(start, fetcher, signal) {
  let url = start;
  for (let hop = 0; hop <= LINK_PREVIEW_MAX_REDIRECTS; hop += 1) {
    if (!(await hostIsSafe(url.hostname, fetcher, signal))) return null;
    const response = await fetcher(url.href, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { Accept: "text/html", "User-Agent": USER_AGENT },
    });
    if (!REDIRECT_STATUSES.has(response.status)) return { url, response };
    await response.body?.cancel?.().catch?.(() => {});
    let next;
    try {
      next = new URL(response.headers.get("Location") ?? "", url);
    } catch {
      return null;
    }
    url = checkPreviewUrl(next.href);
    if (!url) return null;
  }
  return null;
}

// The whole guarded fetch: a preview object, or null for any refusal or
// failure (bad URL, unsafe address, too many hops, timeout, not HTML, no
// title).
export async function fetchPreview(raw, { fetcher = fetch } = {}) {
  const start = checkPreviewUrl(raw);
  if (!start) return null;
  const signal = AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS);
  try {
    const result = await guardedFetch(start, fetcher, signal);
    if (!result || !result.response.ok) return null;
    const type = (result.response.headers.get("Content-Type") || "").toLowerCase();
    if (!type.startsWith("text/html")) return null;
    const parsed = parseOpenGraph(await readCapped(result.response, LINK_PREVIEW_MAX_BYTES));
    if (!parsed.title) return null;
    return { url: start.href, host: start.hostname, ...parsed };
  } catch {
    return null;
  }
}

async function cachedPreview(db, url, now) {
  const row = await db.prepare(
    "SELECT ok, title, description, site_name, fetched_at FROM link_previews WHERE url = ? LIMIT 1",
  ).bind(url.href).first();
  if (!row) return undefined;
  const ttl = Number(row.ok) === 1 ? LINK_PREVIEW_TTL_SECONDS : LINK_PREVIEW_FAILURE_TTL_SECONDS;
  if (Number(row.fetched_at) + ttl <= now) return undefined;
  if (Number(row.ok) !== 1) return null;
  return {
    url: url.href, host: url.hostname,
    title: row.title ?? "", description: row.description ?? "", siteName: row.site_name ?? "",
  };
}

async function storePreview(db, url, preview, now) {
  await db.batch([
    db.prepare("DELETE FROM link_previews WHERE fetched_at < ?").bind(now - LINK_PREVIEW_PRUNE_AFTER_SECONDS),
    db.prepare(
      "INSERT INTO link_previews (url, ok, title, description, site_name, fetched_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(url) DO UPDATE SET ok = excluded.ok, title = excluded.title, " +
      "description = excluded.description, site_name = excluded.site_name, fetched_at = excluded.fetched_at",
    ).bind(url.href, preview ? 1 : 0, preview?.title ?? null, preview?.description || null,
      preview?.siteName || null, now),
  ]);
}

export async function handleLinkPreviewRoutes(request, env, url, path, method) {
  if (path !== LINK_PREVIEW_PATH) return null;
  if (method !== "GET") throw new HttpError(405, "That method is not supported.");
  const session = await requireSignedInRead(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "read");
  await rateLimit(request, env, "link-preview", String(session.user.id));
  const target = checkPreviewUrl(url.searchParams.get("url"));
  if (!target) return json(REFUSED);
  const db = env.FORUM_DB;
  const now = nowSeconds();
  const cached = await cachedPreview(db, target, now);
  if (cached !== undefined) return json(cached ? { ok: true, preview: cached } : REFUSED);
  const fetcher = typeof env.LINK_PREVIEW_FETCH === "function" ? env.LINK_PREVIEW_FETCH : fetch;
  const preview = await fetchPreview(target.href, { fetcher });
  await storePreview(db, target, preview, now);
  return json(preview ? { ok: true, preview } : REFUSED);
}
