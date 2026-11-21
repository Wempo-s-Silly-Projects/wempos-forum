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

// Keyboard post navigation (wave 2026-11-21-8 F3): on a thread page, J moves
// focus to the next post and K to the previous one, in reading order (sub-
// replies included). Character-key shortcuts only fire while focus is already
// inside the thread (WCAG 2.1.4 "active only on focus") and never while the
// member is typing, holding a modifier, or composing with an IME. Client-only:
// nothing is stored or sent.
import { t } from "./i18n.js";
import { jumpToNode } from "./focus-utils.js";

export const POST_KEY_STEPS = Object.freeze({ j: 1, k: -1 });
export const POST_CARD_SELECTOR = "article.post-card";
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isTypingTarget(node) {
  if (!node) return false;
  return TYPING_TAGS.has(node.tagName) || node.isContentEditable === true;
}

// The step for a keydown, or 0 when the event is not a bare J/K press.
// Caps Lock sends "J"/"K" without Shift, so the letter is compared
// case-insensitively; a held Shift (or any modifier) still blocks.
export function postKeyStep(event) {
  if (!event || event.defaultPrevented || event.isComposing) return 0;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  if (isTypingTarget(event.target)) return 0;
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  return Object.hasOwn(POST_KEY_STEPS, key) ? POST_KEY_STEPS[key] : 0;
}

// A card the page is not showing (wave 5.6 F4): set aside by the reply
// filter ([data-filtered-out]) or inside a collapsed group ([hidden]),
// checked up to `scope`.
const HIDDEN_SELECTOR = "[hidden],[data-filtered-out]";
export function isHiddenPost(card, scope) {
  for (let node = card; node && node !== scope; node = node.parentElement) {
    if (node.hidden === true || node.matches?.(HIDDEN_SELECTOR)) return true;
  }
  return false;
}

// Pure: the post `step` places away from `current` in `posts`, skipping any
// card `isSkipped` rejects, or null at either end (no wrap-around, so the
// edge is never a surprise jump).
export function adjacentPost(posts, current, step, isSkipped = () => false) {
  const list = Array.from(posts ?? []);
  const at = list.indexOf(current);
  if (at < 0 || !step) return null;
  for (let index = at + step; index >= 0 && index < list.length; index += step) {
    if (!isSkipped(list[index])) return list[index];
  }
  return null;
}

// Wires J/K on each container (the root card and the reply list). `scope`
// is where every post card of the thread lives (the route's main element).
export function bindPostKeys(scope, containers) {
  if (!scope) return;
  const onKeydown = (event) => {
    const step = postKeyStep(event);
    if (!step) return;
    const current = event.target?.closest?.(POST_CARD_SELECTOR);
    const target = adjacentPost(scope.querySelectorAll(POST_CARD_SELECTOR), current, step,
      (card) => isHiddenPost(card, scope));
    if (!target) return;
    event.preventDefault();
    jumpToNode(target, { block: "start" });
  };
  for (const container of containers ?? []) {
    if (!container) continue;
    container.addEventListener("keydown", onKeydown);
  }
}

export function createPostKeysHint(document) {
  const hint = document.createElement("p");
  hint.className = "post-keys-hint";
  hint.textContent = t("post.keysHint");
  return hint;
}
