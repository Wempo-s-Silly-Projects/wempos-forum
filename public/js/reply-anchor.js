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

// Link to a specific reply (wave 5.25 F1, client-only). Each top-level reply
// on the thread page carries id="reply-<id>", and its copy-link button copies
// /posts/<thread>#reply-<id>. When the page's hash names a reply that is
// already rendered (and not hidden or filtered out), it is scrolled into
// view and briefly highlighted; anything else is a no-op. Nothing is fetched or stored, so no
// reply the page did not already show can be revealed. The hash is checked
// against REPLY_HASH_PATTERN and never handed to a selector.
import { createCopyLinkButton, postPermalink } from "./copy-link.js";
import { jumpToNode, prefersReducedMotion } from "./focus-utils.js";

export const REPLY_HASH_PATTERN = /^#reply-([0-9]{1,15})$/;
export const REPLY_HIGHLIGHT_CLASS = "reply-target";
export const REPLY_HIGHLIGHT_FADE_CLASS = "reply-target-fade";
export const REPLY_HIGHLIGHT_MS = 2400;
const REPLY_ID_PATTERN = /^[0-9]{1,15}$/;
const ANCHOR_PREFIX = "reply-";
const CARD_SELECTOR = "article.post-card";

export function replyAnchorId(replyId) {
  const id = String(replyId ?? "");
  return REPLY_ID_PATTERN.test(id) ? ANCHOR_PREFIX + id : null;
}

// The absolute link to one reply, or null when either id is not plain digits.
export function replyPermalink(origin, threadId, replyId) {
  const base = postPermalink(origin, threadId);
  const anchor = replyAnchorId(replyId);
  return base && anchor ? base + "#" + anchor : null;
}

// The reply id from a "#reply-<digits>" hash, or null for anything else.
export function parseReplyHash(hash) {
  const match = REPLY_HASH_PATTERN.exec(typeof hash === "string" ? hash : "");
  return match ? match[1] : null;
}

// Gives a reply card its anchor id and swaps its generic copy-link button
// for one that copies the reply's own link (one link button per card).
export function anchorReplyCard(document, card, threadId, options = {}) {
  const replyId = card?.dataset?.postId;
  const anchor = replyAnchorId(replyId);
  if (!anchor) return;
  card.id = anchor;
  const button = createCopyLinkButton(document, replyId, {
    ...options,
    link: replyPermalink(options.origin ?? globalThis.location?.origin ?? "", threadId, replyId),
    labelKey: "render.copyReplyLink",
  });
  const actions = card.querySelector(".post-actions");
  const generic = actions?.querySelector(".copy-link-wrap");
  if (generic) {
    actions.insertBefore(button, generic);
    generic.remove();
  } else if (actions) {
    actions.append(button);
  }
}

// Hidden by a collapsed group ([hidden]) or by the reply filter
// ([data-filtered-out]) on the card or any ancestor.
const isShown = (card) => !card.closest("[hidden],[data-filtered-out]");

// Scrolls to and highlights the reply the hash names, when it is on the page.
// Returns the card, or null when nothing matched (a no-op).
export function highlightReplyFromHash(root, hash, {
  reducedMotion = prefersReducedMotion(),
  schedule = setTimeout,
} = {}) {
  const replyId = parseReplyHash(hash);
  if (!replyId || !root?.querySelectorAll) return null;
  const anchor = ANCHOR_PREFIX + replyId;
  const card = [...root.querySelectorAll(CARD_SELECTOR)].find((node) => node.id === anchor) ?? null;
  if (!card || !isShown(card)) return null;
  jumpToNode(card, { block: "center", reducedMotion });
  card.classList.add(REPLY_HIGHLIGHT_CLASS);
  if (!reducedMotion) card.classList.add(REPLY_HIGHLIGHT_FADE_CLASS);
  schedule(() => {
    card.classList.remove(REPLY_HIGHLIGHT_CLASS, REPLY_HIGHLIGHT_FADE_CLASS);
  }, REPLY_HIGHLIGHT_MS);
  return card;
}

// One hashchange listener per window, re-checking whatever page is current.
const boundWindows = new WeakSet();

export function bindReplyHashChange(win, getRoot, options = {}) {
  if (!win?.addEventListener || boundWindows.has(win)) return;
  boundWindows.add(win);
  win.addEventListener("hashchange", () => {
    highlightReplyFromHash(getRoot(), win.location?.hash, options);
  });
}
