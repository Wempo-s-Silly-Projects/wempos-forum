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

// Thread slow mode (v5.43): the thread page's "one reply every N" note and
// the staff form that sets it (PUT/DELETE /api/admin/threads/:id/slowmode).
// Builders only (createElement/textContent); the submit lives in
// routes/post.js. The server enforces the cooldown — this is display.
import { currentLocale, t } from "./i18n.js";

// Mirror of api/staff-tools.mjs SLOW_MODE_CHOICES (pinned equal by test).
export const SLOW_MODE_CHOICES = Object.freeze([30, 60, 300, 900]);
const SECONDS_PER_MINUTE = 60;

const positiveId = (value) => {
  const id = Number(value);
  if (typeof value === "string" ? !/^[1-9][0-9]{0,14}$/.test(value) : !Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("bad id");
  }
  return id;
};

export const slowModePath = (postId) => `/api/admin/threads/${positiveId(postId)}/slowmode`;

// "30 seconds" / "5 minutes" in the reader's language (Intl unit format).
export function formatSlowModeDuration(seconds, locale = currentLocale()) {
  const inMinutes = seconds >= SECONDS_PER_MINUTE && seconds % SECONDS_PER_MINUTE === 0;
  const options = { style: "unit", unit: inMinutes ? "minute" : "second", unitDisplay: "long" };
  const value = inMinutes ? seconds / SECONDS_PER_MINUTE : seconds;
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return new Intl.NumberFormat("en", options).format(value);
  }
}

export function createSlowModeNote(document, seconds) {
  if (!Number.isInteger(seconds) || seconds < 1) return null;
  const note = document.createElement("p");
  note.className = "slow-mode-note";
  note.textContent = t("slowMode.note", { duration: formatSlowModeDuration(seconds) });
  return note;
}

const option = (document, value, label, selected) => {
  const node = document.createElement("option");
  node.value = String(value);
  node.textContent = label;
  node.selected = selected;
  return node;
};

// Staff only (the caller checks the role; the server gates it again).
export function createSlowModeForm(document, postId, current) {
  const form = document.createElement("form");
  form.className = "slow-mode-form";
  form.dataset.form = "thread-slowmode";
  form.dataset.postId = String(postId);
  const select = document.createElement("select");
  select.id = `slow-mode-${postId}`;
  select.name = "seconds";
  const active = SLOW_MODE_CHOICES.includes(current) ? current : 0;
  select.append(option(document, 0, t("slowMode.off"), active === 0));
  for (const seconds of SLOW_MODE_CHOICES) {
    select.append(option(document, seconds, formatSlowModeDuration(seconds), active === seconds));
  }
  select.value = String(active);
  const label = document.createElement("label");
  label.setAttribute("for", select.id);
  label.textContent = t("slowMode.label");
  const button = document.createElement("button");
  button.type = "submit";
  button.className = "button button-quiet";
  button.textContent = t("slowMode.save");
  form.append(label, select, button);
  return form;
}
