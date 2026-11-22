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

// Batch H: a small formatting toolbar above the composer textarea (in place
// of EasyMDE, which would swap the textarea for its own editor and break the
// live preview, drafts and the mention picker). It is a WAI-ARIA toolbar: one
// Tab stop, arrow keys / Home / End move between buttons. Each button is
// named by the existing format.* string and shows the marker it inserts.
// Ctrl/Cmd+B, I and K format from the textarea itself. Every edit goes
// through field-edit.js, so Ctrl/Cmd+Z undoes it.
import { t } from "./i18n.js";
import { FORMAT_KINDS, applyFormat } from "./composer-format.js";
import { createEmojiButton } from "./emoji-picker.js";
import { isImeComposing } from "./focus-utils.js";

const SHORTCUTS = new Map(FORMAT_KINDS.filter((entry) => entry.key).map((entry) => [entry.key, entry.kind]));

// The formatting kind a textarea keydown asks for, or null.
export function shortcutFormat(event) {
  if (!event || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  if (isImeComposing(event)) return null;
  return SHORTCUTS.get(String(event.key ?? "").toLowerCase()) ?? null;
}

// Only the toolbar's own buttons rove (not the emoji picker's inside it).
const toolButtons = (toolbar) => Array.from(toolbar.children).filter((node) => node.tagName === "BUTTON");

function moveFocus(toolbar, event) {
  const buttons = toolButtons(toolbar);
  const index = buttons.indexOf(event.target);
  if (index === -1) return;
  const last = buttons.length - 1;
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const target = buttons[(next + buttons.length) % buttons.length];
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  target.focus();
}

function formatButton(document, entry, field) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "composer-tool";
  button.dataset.format = entry.kind;
  button.textContent = entry.glyph;
  button.setAttribute("aria-label", t(entry.labelKey));
  button.title = t(entry.labelKey);
  if (entry.key) button.setAttribute("aria-keyshortcuts", "Control+" + entry.key.toUpperCase() + " Meta+" + entry.key.toUpperCase());
  // mousedown keeps the textarea's selection where the member left it.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => applyFormat(field, entry.kind));
  return button;
}

export function createComposerToolbar(field, document, { emoji = true } = {}) {
  const toolbar = document.createElement("div");
  toolbar.className = "composer-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", t("composer.toolbarLabel"));
  if (field?.id) toolbar.setAttribute("aria-controls", field.id);
  const buttons = FORMAT_KINDS.map((entry) => formatButton(document, entry, field));
  if (emoji) buttons.push(createEmojiButton(field, document, { host: toolbar }));
  buttons.forEach((button, index) => { button.tabIndex = index === 0 ? 0 : -1; });
  toolbar.append(...buttons);
  toolbar.addEventListener("keydown", (event) => moveFocus(toolbar, event));
  field?.addEventListener?.("keydown", (event) => {
    const kind = shortcutFormat(event);
    if (!kind) return;
    event.preventDefault();
    applyFormat(field, kind);
  });
  return toolbar;
}
