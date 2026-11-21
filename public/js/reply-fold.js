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

// Fold a reply (wave 2026-11-21-12 F2): each reply on a thread page carries a
// small "Fold" toggle in its header. Folding hides that one reply down to its
// author line, so a member can tuck away a long tangent and keep reading.
// For this page view only: nothing is stored, nothing is sent, and the reply
// stays visible to everyone else. The label never changes; aria-pressed alone
// carries the state (the v4.13 toggle convention).
import { t } from "./i18n.js";

export const FOLD_BUTTON_CLASS = "reply-fold";
const CARD_SELECTOR = "article.post-card";
const HEADER_SELECTOR = "header.post-header";

function createFoldButton(document, card) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet reply-fold";
  button.textContent = t("post.foldReply");
  button.setAttribute("title", t("post.foldReplyTitle"));
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    const folded = card.toggleAttribute("data-folded");
    button.setAttribute("aria-pressed", String(folded));
  });
  return button;
}

// Adds the toggle to every reply card inside `container` (sub-replies too).
// Idempotent: a header that already has one is left alone.
export function addReplyFolds(document, container) {
  if (!container || typeof container.querySelectorAll !== "function") return;
  for (const card of container.querySelectorAll(CARD_SELECTOR)) {
    const header = card.querySelector(HEADER_SELECTOR);
    if (!header || header.querySelector("." + FOLD_BUTTON_CLASS)) continue;
    header.append(createFoldButton(document, card));
  }
}
