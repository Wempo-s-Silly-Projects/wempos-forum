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

// Batch H: the one way composer and chat code edits a text field. Every
// programmatic insertion (formatting, mentions, quotes, emoji, pasted HTML)
// goes through the vendored text-field-edit, which types via the browser's
// own editing command, so the edit lands on the native undo stack (Ctrl/Cmd+Z
// undoes it) and fires a real `input` event. Where that command is missing,
// the text is spliced in with setRangeText and an `input` event is sent so
// drafts, counters and previews still see it (that one edit has no undo).
import { insertTextIntoField } from "./vendor/text-field-edit.js";

const spliceByValue = (field, start, end, text) => {
  const value = String(field.value ?? "");
  field.value = value.slice(0, start) + text + value.slice(end);
};

// Replaces field.value[start, end) with text; an optional { start, end }
// selection is applied afterwards (otherwise the caret follows the text).
export function replaceFieldRange(field, start, end, text, selection = null) {
  if (!field) return;
  const inserted = String(text ?? "");
  if (typeof field.setSelectionRange !== "function") {
    spliceByValue(field, start, end, inserted);
    return;
  }
  field.focus?.();
  field.setSelectionRange(start, end);
  const before = field.value;
  try {
    insertTextIntoField(field, inserted);
  } catch {
    // No editing host (detached field, old engine): fall through to splice.
  }
  if (field.value === before && (inserted !== "" || start !== end)) {
    if (typeof field.setRangeText === "function") field.setRangeText(inserted, start, end, "end");
    else spliceByValue(field, start, end, inserted);
    field.dispatchEvent?.(new Event("input", { bubbles: true }));
  }
  if (selection) field.setSelectionRange(selection.start, selection.end);
  else field.setSelectionRange(start + inserted.length, start + inserted.length);
}

export function insertAtCaret(field, text) {
  if (!field) return;
  const value = String(field.value ?? "");
  const start = Number.isInteger(field.selectionStart) ? field.selectionStart : value.length;
  const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;
  replaceFieldRange(field, start, end, text);
}
