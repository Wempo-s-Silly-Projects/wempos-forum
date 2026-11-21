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

// Wave 2026-11-21-36 F2 — Poll dialog polish. While a member types a poll:
// options that say the same thing (same text ignoring case and outer spaces —
// the server's own duplicate rule) are flagged with aria-invalid and one
// warning line, and a live preview shows the question and options the way
// voters will read them. Page-view only: nothing stored, nothing requested.
// The server still refuses duplicates; this only says so before submitting.
import { t } from "./i18n.js";

export const POLL_SLOTS = [1, 2, 3, 4];

export const pollOptionKey = (label) => String(label ?? "").trim().toLowerCase();

// 0-based indices of every non-blank label whose key appears more than once.
export function duplicatePollSlots(labels) {
  const seen = new Map();
  labels.forEach((label, index) => {
    const key = pollOptionKey(label);
    if (!key) return;
    seen.set(key, [...(seen.get(key) || []), index]);
  });
  return new Set([...seen.values()].filter((slots) => slots.length > 1).flat());
}

const field = (dialog, id) => dialog.querySelector("[id=" + id + "]");

export function readPollDraft(dialog) {
  return {
    question: String(field(dialog, "poll-question")?.value ?? "").trim(),
    labels: POLL_SLOTS.map((slot) => String(field(dialog, "poll-option-" + slot)?.value ?? "").trim()),
  };
}

export function createPollPreview(document, question, labels) {
  const preview = document.createElement("div");
  preview.className = "poll-preview";
  const title = document.createElement("p");
  title.className = "poll-preview-title";
  title.textContent = t("composer.pollPreview");
  preview.append(title);
  const options = labels.filter(Boolean);
  if (!question && !options.length) {
    const hint = document.createElement("p");
    hint.className = "poll-preview-empty muted";
    hint.textContent = t("composer.pollPreviewEmpty");
    preview.append(hint);
    return preview;
  }
  const heading = document.createElement("p");
  heading.className = "poll-preview-question";
  heading.textContent = question;
  const list = document.createElement("ul");
  list.className = "poll-preview-options";
  for (const label of options) {
    const item = document.createElement("li");
    item.className = "poll-preview-option";
    item.textContent = label;
    list.append(item);
  }
  preview.append(heading, list);
  return preview;
}

// Paints the warning, the aria-invalid marks and the preview from the
// dialog's current values; answers whether any duplicate is showing.
export function refreshPollHelpers(dialog, document) {
  const { question, labels } = readPollDraft(dialog);
  const duplicates = duplicatePollSlots(labels);
  POLL_SLOTS.forEach((slot, index) => {
    const input = field(dialog, "poll-option-" + slot);
    if (!input) return;
    if (duplicates.has(index)) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  });
  const warning = dialog.querySelector(".poll-duplicate");
  if (warning) warning.hidden = duplicates.size === 0;
  const slot = dialog.querySelector(".poll-preview-slot");
  if (slot) slot.replaceChildren(createPollPreview(document, question, labels));
  return duplicates.size > 0;
}

// Adds the warning line and the preview slot once (after the options note)
// and repaints on every input; safe to call on every open.
export function attachPollHelpers(dialog, document) {
  if (!dialog.querySelector(".poll-preview-slot")) {
    const warning = document.createElement("p");
    warning.className = "poll-duplicate";
    warning.setAttribute("role", "alert");
    warning.textContent = t("composer.pollDuplicate");
    warning.hidden = true;
    const slot = document.createElement("div");
    slot.className = "poll-preview-slot";
    const note = field(dialog, "poll-options-note");
    if (note && note.parentNode) {
      note.insertAdjacentElement("afterend", slot);
      note.insertAdjacentElement("afterend", warning);
    } else {
      dialog.append(warning, slot);
    }
    dialog.addEventListener("input", () => refreshPollHelpers(dialog, document));
  }
  return refreshPollHelpers(dialog, document);
}
