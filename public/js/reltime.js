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

// Wave 2026-11-21-3 F1c: locale-aware times. Durations (the ban countdown)
// use Intl.DurationFormat when the runtime has it, otherwise narrow
// Intl.NumberFormat units joined by Intl.ListFormat — the same "3d 2h 14m"
// shape either way. Relative stamps ("now", "5m ago") use
// Intl.RelativeTimeFormat. Every function is pure and DOM-free; a locale
// the runtime refuses falls back to English.
import { DEFAULT_LOCALE } from "./i18n.js";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const MS_PER_SECOND = 1000;

const safeLocale = (locale) => {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
};

// The countdown contract: leading zero units dropped, hours kept once days
// show, minutes always present, 0 minutes once the time has passed.
function durationParts(totalSeconds) {
  const minutesLeft = Math.max(0, Math.floor(Number(totalSeconds) / SECONDS_PER_MINUTE) || 0);
  const days = Math.floor(minutesLeft / (MINUTES_PER_HOUR * HOURS_PER_DAY));
  const hours = Math.floor(minutesLeft / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const minutes = minutesLeft % MINUTES_PER_HOUR;
  const parts = [];
  if (days > 0) parts.push(["day", days]);
  if (hours > 0 || days > 0) parts.push(["hour", hours]);
  parts.push(["minute", minutes]);
  return parts;
}

function withDurationFormat(parts, locale) {
  const duration = {};
  const options = { style: "narrow" };
  for (const [unit, value] of parts) {
    duration[`${unit}s`] = value;
    options[`${unit}sDisplay`] = "always";
  }
  return new Intl.DurationFormat(locale, options).format(duration);
}

function withListFormat(parts, locale) {
  const pieces = parts.map(([unit, value]) =>
    new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(value));
  return new Intl.ListFormat(locale, { type: "unit", style: "narrow" }).format(pieces);
}

export function formatDuration(totalSeconds, locale = DEFAULT_LOCALE,
  { preferDurationFormat = true } = {}) {
  const parts = durationParts(totalSeconds);
  const tag = safeLocale(locale);
  if (preferDurationFormat && typeof Intl.DurationFormat === "function") {
    return withDurationFormat(parts, tag);
  }
  return withListFormat(parts, tag);
}

// Narrow relative stamp for chat lists; "" for a date that does not parse,
// null when the runtime lacks Intl.RelativeTimeFormat (callers fall back).
export function formatRelative(input, { now = Date.now(), locale = DEFAULT_LOCALE } = {}) {
  const then = new Date(input).getTime();
  if (!Number.isFinite(then)) return "";
  if (typeof Intl.RelativeTimeFormat !== "function") return null;
  const format = new Intl.RelativeTimeFormat(safeLocale(locale), { numeric: "auto", style: "narrow" });
  const minutes = Math.round((Math.max(0, now - then) / MS_PER_SECOND) / SECONDS_PER_MINUTE);
  if (minutes < 1) return format.format(0, "second");
  if (minutes < MINUTES_PER_HOUR) return format.format(-minutes, "minute");
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return format.format(-hours, "hour");
  const days = Math.round(hours / HOURS_PER_DAY);
  if (days < DAYS_PER_WEEK) return format.format(-days, "day");
  return format.format(-Math.round(days / DAYS_PER_WEEK), "week");
}

// Post, reply-preview and edit-history stamps (v5.96.0 C2): long relative
// wording ("2 hours ago") for a week, then a short date; never seconds. A
// time ahead of `now` (clock skew) reads as now; "" for a date that does not
// parse. The full date + time rides formatFullTime for the title attribute.
export function formatPostTime(input, { now = Date.now(), locale = DEFAULT_LOCALE } = {}) {
  const then = new Date(input).getTime();
  if (!Number.isFinite(then)) return "";
  const tag = safeLocale(locale);
  const minutes = Math.floor(Math.max(0, now - then) / MS_PER_SECOND / SECONDS_PER_MINUTE);
  const days = Math.floor(minutes / (MINUTES_PER_HOUR * HOURS_PER_DAY));
  if (days >= DAYS_PER_WEEK || typeof Intl.RelativeTimeFormat !== "function") {
    return new Date(then).toLocaleDateString(tag, { dateStyle: "medium" });
  }
  const format = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  if (minutes < 1) return format.format(0, "second");
  if (minutes < MINUTES_PER_HOUR) return format.format(-minutes, "minute");
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return format.format(-hours, "hour");
  return format.format(-days, "day");
}

export function formatFullTime(input, locale = DEFAULT_LOCALE) {
  const then = new Date(input).getTime();
  if (!Number.isFinite(then)) return "";
  return new Date(then).toLocaleString(safeLocale(locale), { dateStyle: "long", timeStyle: "short" });
}
