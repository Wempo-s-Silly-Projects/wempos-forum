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

// Anonymous browser exception reporting. The browser sends a bounded message
// and stack so this Worker can fingerprint it, but only a daily aggregate is
// retained: route name, error category, one-way fingerprint and count.
import { assertSameOrigin, requireStaff } from "./core/auth.mjs";
import { json, rateLimit, readLimitedBody } from "./core/http.mjs";
import { utcDay } from "./analytics.mjs";
import { ROUTE_NAMES } from "../public/js/router.js";

const ROUTES = new Set(ROUTE_NAMES.filter((name) => name !== "not-found"));
const KINDS = new Set(["route-render", "window-error", "unhandled-rejection"]);
const MAX_BODY_BYTES = 4096;
const RETENTION_DAYS = 90;
const RETENTION_DELETE_LIMIT = 5000;
const CONTENT_TYPES = ["application/json", "text/plain"];
const plainObject = (value) => value !== null && typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;

async function readBody(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!CONTENT_TYPES.some((allowed) => type.startsWith(allowed))) return null;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      await readLimitedBody(request, MAX_BODY_BYTES),
    ));
  } catch {
    return null;
  }
}

function stripControlCharacters(value) {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0);
    return code <= 0x1f || code === 0x7f ? " " : character;
  }).join("");
}

export function validateClientError(body) {
  if (!plainObject(body) ||
      Object.keys(body).sort().join(",") !== "build,kind,message,route,stack") return null;
  if (typeof body.route !== "string" || !ROUTES.has(body.route) ||
      typeof body.kind !== "string" || !KINDS.has(body.kind) ||
      typeof body.message !== "string" || !body.message.trim() || body.message.length > 500 ||
      typeof body.stack !== "string" || body.stack.length > 2000 ||
      typeof body.build !== "string" || body.build.length > 100) return null;
  return {
    route: body.route,
    kind: body.kind,
    message: stripControlCharacters(body.message).trim(),
    stack: stripControlCharacters(body.stack).slice(0, 2000),
  };
}

async function fingerprint(message, stack) {
  const source = new TextEncoder().encode(message.slice(0, 300) + "\n" + stack.slice(0, 1200));
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const noContent = () => new Response(null, {
  status: 204,
  headers: { "Cache-Control": "no-store" },
});

async function receiveClientError(request, env) {
  try {
    assertSameOrigin(request);
    await rateLimit(request, env, "vitals");
    const error = validateClientError(await readBody(request));
    if (!error) return noContent();
    const hash = await fingerprint(error.message, error.stack);
    const day = utcDay();
    const db = env.FORUM_DB;
    await db.batch([
      db.prepare(
        "DELETE FROM client_errors_daily WHERE rowid IN " +
        "(SELECT rowid FROM client_errors_daily WHERE day < ? LIMIT ?)",
      ).bind(utcDay(RETENTION_DAYS - 1), RETENTION_DELETE_LIMIT),
      db.prepare(
        "INSERT INTO client_errors_daily (day, route, kind, fingerprint, count) VALUES (?, ?, ?, ?, 1) " +
        "ON CONFLICT(day, route, kind, fingerprint) DO UPDATE SET count = count + 1",
      ).bind(day, error.route, error.kind, hash),
    ]);
    console.warn("Client exception received:", error.kind, error.route, hash.slice(0, 12));
  } catch (error) {
    if (!(error && error.status)) {
      console.error("Client exception beacon dropped:", error && error.name ? error.name : "UnknownError");
    }
  }
  return noContent();
}

// Scheduled independently of incoming reports, so the 90-day retention
// window is enforced even when the forum receives no new browser errors.
export async function pruneClientErrors(env) {
  if (!env?.FORUM_DB) return;
  while (true) {
    const result = await env.FORUM_DB.prepare(
      "DELETE FROM client_errors_daily WHERE rowid IN " +
      "(SELECT rowid FROM client_errors_daily WHERE day < ? LIMIT ?)",
    ).bind(utcDay(RETENTION_DAYS - 1), RETENTION_DELETE_LIMIT).run();
    if (Number(result.meta?.changes) < RETENTION_DELETE_LIMIT) break;
  }
}

async function readClientErrors(request, env) {
  await requireStaff(request, env, false);
  await rateLimit(request, env, "read");
  const db = env.FORUM_DB;
  const since = utcDay(6);
  const result = await db.prepare(
    "SELECT day, route, kind, SUM(count) AS count, COUNT(*) AS fingerprints " +
    "FROM client_errors_daily WHERE day >= ? GROUP BY day, route, kind " +
    "ORDER BY day DESC, count DESC LIMIT 500",
  ).bind(since).all();
  const totals = (result.results || []).map((row) => ({
    day: String(row.day), route: String(row.route), kind: String(row.kind),
    count: Number(row.count) || 0, fingerprints: Number(row.fingerprints) || 0,
  }));
  return json({ retentionDays: RETENTION_DAYS, rows: totals }, 200, { "Cache-Control": "no-store" });
}

export async function handleClientErrorRoutes(request, env, url, path, method) {
  if (path === "/api/client-errors" && method === "POST") return receiveClientError(request, env);
  if (path === "/api/admin/client-errors" && method === "GET") return readClientErrors(request, env);
  return null;
}
