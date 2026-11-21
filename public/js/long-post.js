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
import { t } from "./i18n.js";

// Long posts fold in the feed (wave 2026-11-21-32 F2): a feed card whose body
// runs past LONG_POST_CHARS characters or LONG_POST_LINES lines shows a
// clipped body with a "Show more" / "Show less" toggle, so one wall of text
// can't push the rest of the feed off screen. The thread page always shows
// the whole post. Page-view only: the state lives on the card (data-folded)
// and resets on the next render; nothing is stored or requested.
export const LONG_POST_CHARS = 900;
export const LONG_POST_LINES = 14;

export function isLongPost(body) {
  const text = typeof body === "string" ? body : "";
  return text.length > LONG_POST_CHARS || text.split("\n").length > LONG_POST_LINES;
}

// One wrapper (the edit swap hides and restores it as a single body block)
// holding the clipped content and its toggle. renderInto(target) paints the
// body blocks into the content element.
export function createFoldedBody(document, postId, renderInto) {
  const fold = document.createElement("div");
  fold.className = "post-body-fold";
  const content = document.createElement("div");
  content.className = "post-body-fold-content";
  content.id = "post-body-fold-" + Number(postId);
  renderInto(content);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "button button-quiet post-fold-toggle";
  toggle.setAttribute("aria-controls", content.id);
  const setFolded = (folded) => {
    fold.dataset.folded = String(folded);
    toggle.setAttribute("aria-expanded", String(!folded));
    toggle.textContent = folded ? t("longPost.showMore") : t("longPost.showLess");
  };
  toggle.addEventListener("click", () => setFolded(fold.dataset.folded === "false"));
  // A keyboard user tabbing onto a link inside the clipped part gets the
  // whole post, so focus never lands on something they can't see.
  content.addEventListener("focusin", () => {
    if (fold.dataset.folded === "true") setFolded(false);
  });
  setFolded(true);
  fold.append(content, toggle);
  return fold;
}
