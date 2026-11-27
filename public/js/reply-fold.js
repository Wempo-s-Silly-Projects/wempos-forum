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

// Fold all replies (wave 2026-11-21-22 F2): one toggle above a long thread's
// replies folds every top-level reply at once, or unfolds them all again.
// Cards are read at click time (so "Load older replies" stays covered) and
// each card's own Fold toggle is kept in sync. A press folds whatever is
// still open; only when every reply is already folded does it unfold. The
// bulk toggle's aria-pressed follows the cards, so a manual unfold shows it
// as not pressed. Page view only: nothing stored, nothing sent.
export const FOLD_ALL_MIN_REPLIES = 3;

const topLevelCards = (list) => [...list.children].filter((node) => node.matches?.(CARD_SELECTOR));

const setCardFolded = (card, folded) => {
  card.toggleAttribute("data-folded", folded);
  card.querySelector(HEADER_SELECTOR)?.querySelector("." + FOLD_BUTTON_CLASS)
    ?.setAttribute("aria-pressed", String(folded));
};

export function createFoldAllToggle(document, replyList, replyCount) {
  if (!replyList || replyCount < FOLD_ALL_MIN_REPLIES) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet fold-all-replies";
  button.textContent = t("post.foldAll");
  button.setAttribute("title", t("post.foldAllTitle"));
  button.setAttribute("aria-pressed", "false");
  const allFolded = () => {
    const cards = topLevelCards(replyList);
    return cards.length > 0 && cards.every((card) => card.hasAttribute("data-folded"));
  };
  button.addEventListener("click", () => {
    const fold = !allFolded();
    for (const card of topLevelCards(replyList)) setCardFolded(card, fold);
    button.setAttribute("aria-pressed", String(fold));
  });
  // A single card's Fold toggle bubbles a click up the list: re-sync.
  replyList.addEventListener?.("click", (event) => {
    if (!event?.target?.matches?.("." + FOLD_BUTTON_CLASS)) return;
    button.setAttribute("aria-pressed", String(allFolded()));
  });
  return button;
}

// Wave 24: a thread whose first page was short gains the toggle once "Load
// older replies" brings it past the threshold. Idempotent: an existing toggle
// is returned as-is.
export function ensureFoldAllToggle(document, replyList) {
  if (!replyList?.parentNode) return null;
  const existing = replyList.parentNode.querySelector?.(".fold-all-replies");
  if (existing) return existing;
  const toggle = createFoldAllToggle(document, replyList, topLevelCards(replyList).length);
  if (!toggle) return null;
  // Trim list #14: the thread toolbar holds Jump to, Fold all and the filter.
  const toolbar = replyList.parentNode.querySelector?.(".thread-tools");
  if (toolbar) toolbar.insertBefore(toggle, toolbar.querySelector?.(".reply-filter") ?? null);
  else replyList.parentNode.insertBefore(toggle, replyList);
  return toggle;
}
