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

// Custom status (v5.38.0 F2, migration 0066). Opt-in: no row = no status.
// PUT /api/me/status sets text (<= 60 characters after trim) and/or one
// allowlisted emoji with an expiry from a fixed list; DELETE clears it. Both
// writes are signed in + CSRF (requireUser), not banned, rate limited on the
// shared write tier. The text goes through the same word filter posts use and
// a hit is refused, never masked into storage. Reads (readStatus) drop expired
// rows and actively banned members in SQL, with "now" bound at read time — no
// cron. The profile payload, which already refuses block pairs, carries it.
import { assertNotBanned, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";

export const STATUS_TEXT_MAX = 60;
const STATUS_EMOJI_MAX_UNITS = 16;
const HOUR = 3600;
const DAY_MS = 86400 * 1000;
const MAX_TZ_OFFSET_MINUTES = 840; // UTC-14 … UTC+14
export const STATUS_EXPIRIES = new Set(["never", "1h", "4h", "today", "week"]);

// One grapheme made only of pictographs, ZWJ, VS16, skin tones or regional
// indicators (flags), and holding at least one pictograph or a flag pair.
const EMOJI_PARTS = /^(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]|‍|️)+$/u;
const EMOJI_CORE = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]{2}/u;
// C0/C1 controls and line/paragraph separators: a status is one plain line.
// Wave 5.41 L1: also the bidi embedding/override (U+202A-202E) and isolate
// (U+2066-2069) controls, which can render the line reversed — text the word
// filter never saw in that order. The plain marks (U+200E/200F) stay allowed.
const isControlChar = (ch) => {
  const code = ch.codePointAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
};
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// "" = none; the trimmed emoji when valid; null = invalid. Pure.
export function normalizeStatusEmoji(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const emoji = value.trim();
  if (emoji === "") return "";
  if (emoji.length > STATUS_EMOJI_MAX_UNITS || !EMOJI_PARTS.test(emoji) || !EMOJI_CORE.test(emoji)) return null;
  return [...segmenter.segment(emoji)].length === 1 ? emoji : null;
}

// "" = none; the trimmed text when valid; null = invalid. Pure.
export function normalizeStatusText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  const chars = [...text];
  if (chars.some(isControlChar) || chars.length > STATUS_TEXT_MAX) return null;
  return text;
}

// Unix seconds when the status stops showing; null = never; undefined =
// unknown expiry. "today" ends at the member's next local midnight, from the
// browser's getTimezoneOffset() minutes (UTC minus local).
export function statusExpiresAt(expiry, nowSec, tzOffsetMinutes = 0) {
  if (expiry === "never") return null;
  if (expiry === "1h") return nowSec + HOUR;
  if (expiry === "4h") return nowSec + 4 * HOUR;
  if (expiry === "week") return nowSec + 7 * 24 * HOUR;
  if (expiry === "today") {
    const offsetMs = tzOffsetMinutes * 60 * 1000;
    const localMs = nowSec * 1000 - offsetMs;
    return (Math.floor(localMs / DAY_MS + 1) * DAY_MS + offsetMs) / 1000;
  }
  return undefined;
}

function tzOffsetFrom(value) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || Math.abs(value) > MAX_TZ_OFFSET_MINUTES) {
    throw new HttpError(400, "That time zone isn't valid.");
  }
  return value;
}

// The member's live status, or null: expired rows and actively banned
// members are filtered in SQL; a word added to the filter after the save is
// masked at read.
export async function readStatus(env, userId) {
  const row = await env.FORUM_DB.prepare(
    "SELECT s.text, s.emoji, s.expires_at FROM user_status s WHERE s.user_id = ? " +
    "AND (s.expires_at IS NULL OR s.expires_at > ?) AND NOT " + ACTIVE_BAN_SQL("s.user_id") + " LIMIT 1",
  ).bind(Number(userId), nowSeconds()).first();
  if (!row) return null;
  return {
    text: applyWordFilter(String(row.text ?? ""), filterWords(env)),
    emoji: String(row.emoji ?? ""),
    expiresAt: row.expires_at === null || row.expires_at === undefined
      ? null
      : new Date(Number(row.expires_at) * 1000).toISOString(),
  };
}

function parseStatusBody(env, body) {
  const text = normalizeStatusText(body?.text);
  if (text === null) throw new HttpError(400, "A status can be up to " + STATUS_TEXT_MAX + " characters on one line.");
  const emoji = normalizeStatusEmoji(body?.emoji);
  if (emoji === null) throw new HttpError(400, "Pick a single emoji, or leave it empty.");
  if (text === "" && emoji === "") throw new HttpError(400, "Add some status text or an emoji.");
  if (typeof body?.expiry !== "string" || !STATUS_EXPIRIES.has(body.expiry)) {
    throw new HttpError(400, "Choose when the status clears.");
  }
  if (text !== "" && applyWordFilter(text, filterWords(env)) !== text) {
    throw new HttpError(400, "That status can't be used here.");
  }
  return { text, emoji, expiry: body.expiry, tzOffset: tzOffsetFrom(body?.tzOffset) };
}

export async function handleStatusRoutes(request, env, url, path, method) {
  if (path !== "/api/me/status" || (method !== "PUT" && method !== "DELETE")) return null;
  const session = await requireUser(request, env);
  const userId = Number(session.user.id);
  await assertNotBanned(env, userId);
  await rateLimit(request, env, "write", String(userId));
  const db = env.FORUM_DB;
  if (method === "DELETE") {
    await db.prepare("DELETE FROM user_status WHERE user_id = ?").bind(userId).run();
    return json({ ok: true });
  }
  const { text, emoji, expiry, tzOffset } = parseStatusBody(env, await readJson(request));
  const at = nowSeconds();
  const expiresAt = statusExpiresAt(expiry, at, tzOffset);
  await db.prepare(
    "INSERT INTO user_status (user_id, text, emoji, expires_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET text = excluded.text, emoji = excluded.emoji, " +
    "expires_at = excluded.expires_at, updated_at = excluded.updated_at",
  ).bind(userId, text, emoji, expiresAt, at).run();
  return json({
    status: { text, emoji, expiresAt: expiresAt === null ? null : new Date(expiresAt * 1000).toISOString() },
  });
}
