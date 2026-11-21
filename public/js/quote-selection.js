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

// Quote what you selected (wave 2026-11-21-24 F2): when the reader has
// selected part of a reply's body, Quote quotes just that part. Only text
// inside THIS card's own body blocks counts (never its header, a nested
// sub-reply or another card), buttons such as Copy are skipped, and every
// spoiler is masked whether or not this reader revealed it, so a quote never
// gives one away. Read from the page only: nothing stored, nothing sent.
import { SPOILER_MASK } from "./markdown.js";
import { collapseWhitespace } from "./quotes.js";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CARD_SELECTOR = "article.post-card";
const BODY_BLOCK_SELECTOR = ".post-body, .post-heading, .md-list, .post-quote, .post-codeblock";
const SPOILER_SELECTOR = ".spoiler";

const elementOf = (node) => (node?.nodeType === ELEMENT_NODE ? node : node?.parentNode ?? null);

const inCardBody = (node, card) => {
  const block = elementOf(node)?.closest?.(BODY_BLOCK_SELECTOR);
  return Boolean(block) && block.closest(CARD_SELECTOR) === card;
};

function flatten(node) {
  let out = "";
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === TEXT_NODE) out += child.textContent;
    else if (child.nodeType !== ELEMENT_NODE || child.tagName === "BUTTON") continue;
    else if (child.matches(SPOILER_SELECTOR)) out += SPOILER_MASK;
    else out += " " + flatten(child) + " ";
  }
  return out;
}

// The selected text, single-line and masked, or "" when the selection is
// empty or reaches outside `card`'s body (the caller then quotes the snippet).
export function selectedQuoteText(selection, card) {
  if (!selection || !card || selection.isCollapsed || selection.rangeCount < 1) return "";
  const range = selection.getRangeAt(0);
  if (!inCardBody(range.startContainer, card) || !inCardBody(range.endContainer, card)) return "";
  // Wholly inside one spoiler: the clone holds bare text with no span left
  // to mask, so the whole selection is the mask.
  if (elementOf(range.commonAncestorContainer)?.closest?.(SPOILER_SELECTOR)) return SPOILER_MASK;
  return collapseWhitespace(flatten(range.cloneContents()));
}
