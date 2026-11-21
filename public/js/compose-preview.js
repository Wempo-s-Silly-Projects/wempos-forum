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
import { t } from "./i18n.js";
import { renderBodyBlocks } from "./render.js";

export function createComposePreview(bodyField, document) {
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

  button.addEventListener("click", () => {
    const opening = pane.hidden;
    pane.hidden = !opening;
    button.setAttribute("aria-pressed", String(opening));
    paint();
  });
  bodyField.addEventListener("input", paint);
  wrapper.append(button, pane);
  return wrapper;
}
