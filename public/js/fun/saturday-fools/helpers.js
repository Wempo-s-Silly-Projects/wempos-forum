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

// Saturday Fools framework helpers (docs/saturday-fools.md). These stay when
// a week's gag is stripped; gag modules import them for the accessibility
// rules every gag must keep: an unchanged accessible name and a CSP-safe way
// to hand a translated string to CSS (a custom property, no inline <style>).

// Marks the attribute a gag set, so undo removes only what the gag added.
export const FOOLS_LABEL_MARK = "data-fools-label";

// Pins `el`'s accessible name to its current text before a gag repaints the
// visible label: aria-label = the real text, only when it has none of its
// own. Screen readers and voice control keep the real name.
export function preserveAccessibleName(el) {
  if (!el || el.hasAttribute?.("aria-label")) return false;
  const name = String(el.textContent ?? "").trim();
  if (!name) return false;
  el.setAttribute("aria-label", name);
  el.setAttribute(FOOLS_LABEL_MARK, "");
  return true;
}

// Undoes preserveAccessibleName for everything under `root`.
export function restoreAccessibleNames(root) {
  for (const el of root?.querySelectorAll?.(`[${FOOLS_LABEL_MARK}]`) ?? []) {
    el.removeAttribute("aria-label");
    el.removeAttribute(FOOLS_LABEL_MARK);
  }
}

// A CSS string literal for `content: var(--x)`: quotes and backslashes
// escaped, control characters dropped.
export function cssString(text) {
  // eslint-disable-next-line no-control-regex -- dropping control characters is the point
  const clean = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/["\\]/g, "\\$&");
  return `"${clean}"`;
}

// Sets / clears a custom property through the CSSOM (CSP-safe: style-src
// never sees inline style text).
export function setCssVar(el, name, value) {
  el?.style?.setProperty?.(name, value);
}

export function clearCssVar(el, name) {
  el?.style?.removeProperty?.(name);
}
