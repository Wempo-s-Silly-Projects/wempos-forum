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

// Quiet hours (wave 5.25 F2, opt-in, default off): between two hours of the
// device's local time, notification alerts — the unread count in the tab
// title, and any notification pop-up or sound — are held back. The bell's
// in-page badge keeps updating. The choice lives only in this browser and
// leaves with the member on sign-out (clearAllQuietHours rides
// wipeAccountLocalData). No network call; every storage touch is try/catch,
// so private windows and blocked storage read as off.
import { currentLocale, t } from "./i18n.js";

export const QUIET_HOURS_STORAGE_KEY = "forum-quiet-hours";
export const HOURS_PER_DAY = 24;
export const QUIET_HOURS_DEFAULT = Object.freeze({ enabled: false, start: 22, end: 7 });

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const normaliseHour = (value, fallback) =>
  Number.isInteger(value) && value >= 0 && value < HOURS_PER_DAY ? value : fallback;

const normalise = (value) => ({
  enabled: value?.enabled === true,
  start: normaliseHour(value?.start, QUIET_HOURS_DEFAULT.start),
  end: normaliseHour(value?.end, QUIET_HOURS_DEFAULT.end),
});

export function readQuietHours(storage = browserStorage()) {
  try {
    const raw = storage?.getItem(QUIET_HOURS_STORAGE_KEY);
    if (!raw) return { ...QUIET_HOURS_DEFAULT };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? normalise(parsed)
      : { ...QUIET_HOURS_DEFAULT };
  } catch {
    return { ...QUIET_HOURS_DEFAULT };
  }
}

// Stores a normalised copy and returns it; blocked storage keeps the choice
// for this page view only.
export function writeQuietHours(storage, settings) {
  const value = normalise(settings);
  try {
    storage?.setItem(QUIET_HOURS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Blocked storage: nothing persists.
  }
  return value;
}

export function clearAllQuietHours(storage = browserStorage()) {
  try {
    storage?.removeItem(QUIET_HOURS_STORAGE_KEY);
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

// start..end in whole hours, end excluded; start > end crosses midnight
// (22 -> 7 is 22:00-06:59); start === end is an empty window.
export function isQuietHour(hour, start, end) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function isQuietNow(settings, now = new Date()) {
  return settings?.enabled === true && isQuietHour(now.getHours(), settings.start, settings.end);
}

// The one gate every notification alert asks before it shows.
export function notificationAlertsAllowed(storage = browserStorage(), now = new Date()) {
  return !isQuietNow(readQuietHours(storage), now);
}

function hourLabel(hour) {
  try {
    return new Intl.DateTimeFormat(currentLocale(), { hour: "numeric", minute: "2-digit" })
      .format(new Date(2000, 0, 1, hour));
  } catch {
    return String(hour);
  }
}

function hourSelect(doc, className, labelText, selected) {
  const label = doc.createElement("label");
  label.className = "quiet-hours-field";
  const select = doc.createElement("select");
  select.className = className;
  for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
    const option = doc.createElement("option");
    option.value = String(hour);
    option.textContent = hourLabel(hour);
    if (hour === selected) option.selected = true;
    select.append(option);
  }
  select.value = String(selected);
  label.append(doc.createTextNode(labelText + " "), select);
  return { label, select };
}

// The settings controls: an on/off switch and From/Until hour selects.
// Rendering stores nothing; each change saves and calls onChange.
export function createQuietHoursControls(doc, storage, { onChange = () => {} } = {}) {
  const current = readQuietHours(storage);
  const wrapper = doc.createElement("div");
  wrapper.className = "quiet-hours";
  const toggle = doc.createElement("label");
  toggle.className = "quiet-hours-toggle";
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.className = "quiet-hours-switch";
  box.checked = current.enabled;
  toggle.append(box, doc.createTextNode(" " + t("quietHours.enable")));
  const start = hourSelect(doc, "quiet-hours-start", t("quietHours.start"), current.start);
  const end = hourSelect(doc, "quiet-hours-end", t("quietHours.end"), current.end);
  const range = doc.createElement("div");
  range.className = "quiet-hours-range";
  range.append(start.label, end.label);
  const save = () => {
    writeQuietHours(storage, {
      enabled: box.checked,
      start: Number(start.select.value),
      end: Number(end.select.value),
    });
    onChange();
  };
  for (const control of [box, start.select, end.select]) control.addEventListener("change", save);
  wrapper.append(toggle, range);
  return wrapper;
}
