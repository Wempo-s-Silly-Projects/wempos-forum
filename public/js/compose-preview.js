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

// Wave 2026-11-21-3 F3: composer Preview. A toggle under the textarea opens
// a live pane rendered by the SAME renderer posts use (markdown, mentions,
// links, spoilers) and refreshed on every keystroke while open. The textarea
// always stays visible and is never written to; nothing leaves the browser.
// Batch H: on wide screens a "Side by side" toggle sets the textarea and the
// open preview next to each other, split by the vendored split.js (loaded on
// first use; it sizes panes through the CSSOM, which the CSP allows). Off, or
// when the window narrows, everything returns to the stacked layout.
import { t } from "./i18n.js";
import { renderBodyBlocks } from "./render.js";

const WIDE_QUERY = "(min-width: 64rem)"; // i18n-ignore
const SPLIT_SIZES = [50, 50];
const SPLIT_MIN_PX = 240;
const SPLIT_GUTTER_PX = 8;
const defaultLoadSplit = async () => (await import("./vendor/split.js")).default;
const defaultMatchMedia = (query) => globalThis.matchMedia?.(query) ?? null;

export function createComposePreview(bodyField, document, {
  matchMedia = defaultMatchMedia,
  loadSplit = defaultLoadSplit,
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "compose-preview";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet compose-preview-toggle";
  button.textContent = t("composer.preview");
  button.setAttribute("aria-pressed", "false");
  const pane = document.createElement("div");
  pane.className = "compose-preview-pane";
  pane.setAttribute("role", "region");
  pane.setAttribute("aria-label", t("composer.previewLabel"));
  pane.hidden = true;

  const paint = () => {
    if (pane.hidden) return;
    pane.replaceChildren();
    const body = String(bodyField.value ?? "");
    if (!body.trim()) {
      const note = document.createElement("p");
      note.className = "compose-preview-empty";
      note.textContent = t("composer.previewEmpty");
      pane.append(note);
      return;
    }
    renderBodyBlocks({ body }, document, pane);
  };

  const splitToggle = document.createElement("button");
  splitToggle.type = "button";
  splitToggle.className = "button button-quiet compose-split-toggle";
  splitToggle.textContent = t("composer.sideBySide");
  splitToggle.setAttribute("aria-pressed", "false");
  const wide = matchMedia(WIDE_QUERY);
  splitToggle.hidden = !wide?.matches;
  let split = null;

  const unsplit = () => {
    if (!split) return;
    const { container, fieldBox, instance } = split;
    split = null;
    instance?.destroy?.();
    container.parentNode?.insertBefore(fieldBox, container);
    wrapper.append(pane);
    container.remove();
    splitToggle.setAttribute("aria-pressed", "false");
  };

  const setOpen = (opening) => {
    pane.hidden = !opening;
    button.setAttribute("aria-pressed", String(opening));
    if (!opening) unsplit();
    paint();
  };

  const sideBySide = async () => {
    const fieldBox = bodyField.parentNode;
    if (!fieldBox?.parentNode) return;
    setOpen(true);
    const container = document.createElement("div");
    container.className = "compose-split";
    fieldBox.parentNode.insertBefore(container, fieldBox);
    container.append(fieldBox, pane);
    const pending = { container, fieldBox, instance: null };
    split = pending;
    splitToggle.setAttribute("aria-pressed", "true");
    try {
      const Split = await loadSplit();
      if (split !== pending) return;
      pending.instance = Split([fieldBox, pane], {
        sizes: SPLIT_SIZES, minSize: SPLIT_MIN_PX, gutterSize: SPLIT_GUTTER_PX,
      });
    } catch {
      // split.js unavailable: stay stacked rather than half-split.
      unsplit();
    }
  };

  button.addEventListener("click", () => setOpen(pane.hidden));
  splitToggle.addEventListener("click", () => (split ? unsplit() : sideBySide()));
  wide?.addEventListener?.("change", (event) => {
    splitToggle.hidden = !event.matches;
    if (!event.matches) unsplit();
  });
  bodyField.addEventListener("input", paint);
  wrapper.append(button, splitToggle, pane);
  return wrapper;
}
