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

// Rules page (v2.5): owner-editable site copy — GET /api/rules (public) and
// POST /api/admin/rules (admin-only; the desk has the editor). The rules'
// markdown renders via the same safe subset as post bodies; HTML stays
// literal and images/embeds never render (the markdown renderer's rules).
import { requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readLimitedBody } from "./core/http.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";

const RULES_KEY = "rules";
export const RULES_MAX_BYTES = 20 * 1024;

export async function handleRulesRoutes(request, env, url, path, method) {
  if (path !== "/api/rules") return null;
  if (method === "GET") {
    const row = await env.FORUM_DB.prepare(
      "SELECT value, updated_at FROM site_settings WHERE key = ? LIMIT 1",
    ).bind(RULES_KEY).first();
    return json({
      rules: row ? row.value : "",
      updatedAt: row ? new Date(Number(row.updated_at) * 1000).toISOString() : null,
    });
  }
  if (method === "POST") {
    await requireStaff(request, env);
    await rateLimit(request, env, "write");
    const raw = await readLimitedBody(request, RULES_MAX_BYTES + 1024);
    const text = new TextDecoder().decode(raw);
    // api() JSON-encodes the body (the CSS route's same convention): decode
    // the string payload.
    let rulesText = text.trim();
    const looksJson = (request.headers.get("Content-Type") || "").includes("application/json") ||
      (rulesText.startsWith("\"") && rulesText.endsWith("\"") && rulesText.length > 1);
    if (looksJson) {
      try {
        const parsed = JSON.parse(rulesText);
        rulesText = typeof parsed === "string" ? parsed : String(parsed?.rules ?? rulesText);
      } catch {
        /* a merely-quoted css-like value stays */
      }
    }
    rulesText = rulesText.trim();
    // The filter covers everything the site stores — rules included (the
    // owner's own ask; overrides the old site-copy exemption).
    rulesText = applyWordFilter(rulesText, filterWords(env));
    if (rulesText.length > RULES_MAX_BYTES) {
      throw new HttpError(413, "The rules must be 20 KiB or smaller.");
    }
    await env.FORUM_DB.batch([
      env.FORUM_DB.prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).bind(RULES_KEY, rulesText, nowSeconds()),
    ]);
    return json({ saved: true, rules: rulesText });
  }
  return null;
}
