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

import { t, tn } from "./i18n.js";
import { isImeComposing } from "./focus-utils.js";
import { maskSpoilers } from "./markdown.js";
// Filter replies (wave 5.5 F2): a box above a thread's replies narrows them
// to the top-level replies whose text holds every typed word (case-
// insensitive), with a live "N of M replies match" line. Spoilers are masked
// before matching, so the filter never reveals what a spoiler hides. A
// reply's open sub-reply group follows its parent. Cards are read at filter
// time, and refreshReplyFilter re-runs it after "Load older replies".
// Page view only: nothing stored, nothing sent.

export const REPLY_FILTER_MIN_REPLIES = 3;
const CARD_SELECTOR = "article.post-card";
const SUB_GROUP_SELECTOR = ".sub-replies";
const OUT_ATTRIBUTE = "data-filtered-out";
const filters = new WeakMap();

const queryWords = (query) => String(query ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

export function replyMatches(body, query) {
  const words = queryWords(query);
  if (!words.length) return true;
  if (typeof body !== "string") return false;
  const haystack = maskSpoilers(body).toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

// Hides non-matching top-level cards (and the sub-reply group right after
// each); returns the counts for the status line.
function applyToList(replyList, query) {
  const active = queryWords(query).length > 0;
  let total = 0;
  let matched = 0;
  let parentOut = false;
  for (const node of [...replyList.children]) {
    if (node.matches?.(CARD_SELECTOR)) {
      total += 1;
      parentOut = active && !replyMatches(node.postBody, query);
      if (!parentOut) matched += 1;
      node.toggleAttribute(OUT_ATTRIBUTE, parentOut);
    } else if (node.matches?.(SUB_GROUP_SELECTOR)) {
      node.toggleAttribute(OUT_ATTRIBUTE, parentOut);
    }
  }
  return { active, total, matched };
}

export function createReplyFilter(document, replyList, replyCount) {
  if (!replyList || replyCount < REPLY_FILTER_MIN_REPLIES) return null;
  const box = document.createElement("div");
  box.className = "reply-filter";
  box.setAttribute("role", "search");
  box.setAttribute("aria-label", t("replyFilter.label"));
  const input = document.createElement("input");
  input.type = "search";
  input.className = "reply-filter-input";
  input.setAttribute("aria-label", t("replyFilter.label"));
  input.setAttribute("placeholder", t("replyFilter.placeholder"));
  input.setAttribute("autocomplete", "off");
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "button button-quiet reply-filter-clear";
  clear.textContent = t("replyFilter.clear");
  clear.hidden = true;
  const status = document.createElement("p");
  status.className = "reply-filter-status";
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  box.append(input, clear, status);

  const apply = () => {
    const { active, total, matched } = applyToList(replyList, input.value);
    clear.hidden = !active;
    status.hidden = !active;
    status.textContent = active ? tn("replyFilter.matches", matched, { total }) : "";
  };
  const reset = () => {
    input.value = "";
    apply();
    input.focus?.();
  };
  input.addEventListener("input", apply);
  input.addEventListener("keydown", (event) => {
    if (isImeComposing(event) || event.key !== "Escape" || !input.value) return;
    event.preventDefault();
    reset();
  });
  clear.addEventListener("click", reset);
  filters.set(replyList, apply);
  return box;
}

export function refreshReplyFilter(replyList) {
  if (replyList) filters.get(replyList)?.();
}
