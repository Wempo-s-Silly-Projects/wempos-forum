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

// Ctrl+Enter / Cmd+Enter posts (wave 2026-11-21-19). The forum composers opt
// in through createTextarea({ submitShortcut: true }); plain Enter keeps
// making a newline. The shortcut goes through form.requestSubmit(), so the
// browser's own required/maxlength checks and the app's single submit handler
// (with its in-flight guard) run exactly as they do for the button. No
// network of its own, nothing stored.
import { t } from "./i18n.js";

// ARIA key tokens (spec syntax, never translated).
export const SUBMIT_SHORTCUT_KEYS = "Control+Enter Meta+Enter"; // i18n-ignore

// IME users confirm a candidate with Enter, so a composing keystroke is never
// a send; Shift/Alt combos are left to the platform.
export function isSubmitShortcut(event) {
  if (!event || event.key !== "Enter" || event.isComposing) return false;
  if (event.shiftKey || event.altKey) return false;
  return Boolean(event.ctrlKey || event.metaKey);
}

// Wires the shortcut onto one textarea and returns the muted hint line for
// the caller to place under it.
export function attachSubmitShortcut(document, textarea) {
  textarea.setAttribute("aria-keyshortcuts", SUBMIT_SHORTCUT_KEYS);
  textarea.addEventListener("keydown", (event) => {
    if (!isSubmitShortcut(event)) return;
    const form = textarea.form ?? textarea.closest?.("form");
    if (!form || typeof form.requestSubmit !== "function") return;
    event.preventDefault();
    if (form.dataset.submitting === "true") return;
    form.requestSubmit();
  });
  const hint = document.createElement("small");
  hint.className = "form-note composer-shortcut";
  hint.textContent = t("composer.sendShortcut");
  return hint;
}
