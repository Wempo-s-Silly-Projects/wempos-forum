
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

// Instance branding (v5.19.0, self-hosting part 2): the forum's name, tagline
// and footer live in site_settings (site_name / site_tagline / site_footer).
// GET /api/branding is public (the same copy every page shows); staff save it
// from the admin desk with POST /api/admin/branding. With no row, every
// surface shows the defaults below — the owner's forum exactly as it was.
// The shell receives the stored values as attribute-escaped <meta> tags
// (worker.mjs) and the client paints them with textContent only.
import { requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";

export const BRANDING_DEFAULTS = Object.freeze({
  name: "Wempo's Forum",
  tagline: "Have fun and meet new people!",
  footer: "Made by ItsWempo. Be chill, be kind, and have fun :3",
});

export const BRANDING_LIMITS = Object.freeze({
  name: 60,
  tagline: 120,
  footer: 200,
});

const SETTING_KEYS = Object.freeze({
  name: "site_name",
  tagline: "site_tagline",
  footer: "site_footer",
});

const FIELDS = Object.keys(SETTING_KEYS);

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const FIELD_LABELS = Object.freeze({
  name: "forum name",
  tagline: "tagline",
  footer: "footer",
});

// readStoredBranding(env) -> { name, tagline, footer } holding only what the
// owner saved ("" for anything unset). A failed read logs and falls back to
// the defaults: a branding hiccup must never take the page down with it.
export async function readStoredBranding(env) {
  const stored = { name: "", tagline: "", footer: "" };
  if (!env || !env.FORUM_DB) return stored;

  try {
    const { results } = await env.FORUM_DB.prepare(
      "SELECT key, value FROM site_settings WHERE key IN (?, ?, ?)",
    ).bind(
      SETTING_KEYS.name,
      SETTING_KEYS.tagline,
      SETTING_KEYS.footer,
    ).all();

    const byKey = new Map(
      (results || []).map((row) => [row.key, String(row.value ?? "")]),
    );

    return Object.fromEntries(
      FIELDS.map((field) => [
        field,
        byKey.get(SETTING_KEYS[field]) || "",
      ]),
    );
  } catch (error) {
    console.error(
      "Could not read the forum branding; using the defaults:",
      error,
    );
    return stored;
  }
}

const withDefaults = (stored) =>
  Object.fromEntries(
    FIELDS.map((field) => [
      field,
      stored[field] || BRANDING_DEFAULTS[field],
    ]),
  );

// readBranding(env) -> the effective copy: saved values over the defaults.
export async function readBranding(env) {
  return withDefaults(await readStoredBranding(env));
}

// siteName(env) -> the forum's effective name (discovery, the 2FA issuer).
export async function siteName(env) {
  return (await readBranding(env)).name;
}

function cleanField(body, field, words) {
  const raw = body[field];

  if (typeof raw !== "string") {
    throw new HttpError(
      400,
      `Send the ${FIELD_LABELS[field]} as text.`,
    );
  }

  const value = raw.trim();

  if (CONTROL_CHARACTERS.test(value)) {
    throw new HttpError(
      400,
      `The ${FIELD_LABELS[field]} must be a single line of plain text.`,
    );
  }

  // Count Unicode code points rather than UTF-16 code units, so
  // supplementary characters such as many emoji count as one character.
  const length = [...value].length;

  if (length > BRANDING_LIMITS[field]) {
    throw new HttpError(
      400,
      `The ${FIELD_LABELS[field]} must be ${BRANDING_LIMITS[field]} characters or fewer.`,
    );
  }

  return applyWordFilter(value, words);
}

// One batch: a value upserts its row, an empty value removes it (default back).
function brandingWrites(env, values) {
  const at = nowSeconds();

  return FIELDS.map((field) => (
    values[field]
      ? env.FORUM_DB.prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).bind(SETTING_KEYS[field], values[field], at)
      : env.FORUM_DB.prepare(
        "DELETE FROM site_settings WHERE key = ?",
      ).bind(SETTING_KEYS[field])
  ));
}

async function saveBranding(request, env) {
  await requireStaff(request, env);
  await rateLimit(request, env, "write");

  const body = await readJson(request);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "Send the forum name, tagline and footer.",
    );
  }

  const words = filterWords(env);

  const values = Object.fromEntries(
    FIELDS.map((field) => [
      field,
      cleanField(body, field, words),
    ]),
  );

  await env.FORUM_DB.batch(brandingWrites(env, values));

  return json({
    saved: true,
    ...(await readBranding(env)),
  });
}

export async function handleBrandingRoutes(
  request,
  env,
  url,
  path,
  method,
) {
  // `saved` is what the owner stored ("" = default): the desk edits that, so
  // saving an untouched form never pins the English defaults over the
  // translated copy.
  if (path === "/api/branding" && method === "GET") {
    const saved = await readStoredBranding(env);

    return json({
      ...withDefaults(saved),
      saved,
      defaults: BRANDING_DEFAULTS,
      limits: BRANDING_LIMITS,
    });
  }

  if (path === "/api/admin/branding" && method === "POST") {
    return saveBranding(request, env);
  }

  return null;
}
