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

// "Show spoilers" (wave 2026-11-21-17 F2): a card whose body renders at least
// one spoiler gets one quiet button that reveals all of that card's spoilers
// at once, then hides itself. Client-only; nested cards (sub-replies inside a
// reply's article) keep their own spoilers. DOM-pure: textContent only.
import { t } from "./i18n.js";
import { maskSpoilers, revealSpoiler } from "./markdown.js";

// True when the post page would render a spoiler: the shared mask changes
// the text exactly when parseInline turns a span into a spoiler.
export const hasSpoilers = (body) => maskSpoilers(body) !== String(body ?? "");

export function createRevealSpoilersButton(document, article) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet reveal-spoilers";
  button.textContent = t("render.revealSpoilers");
  button.addEventListener("click", () => {
    article.querySelectorAll(".spoiler").forEach((spoiler) => {
      if (spoiler.closest("article") === article) revealSpoiler(spoiler);
    });
    button.hidden = true;
  });
  return button;
}
