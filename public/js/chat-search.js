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

// Search inside a conversation (wave 5.36): a small search box in the chat
// header. Two or more characters ask the server (GET …/search?q=); each hit
// shows author, time and the server's spoiler-masked excerpt, built with text
// nodes only. Clicking a hit scrolls to and highlights that message when it is
// loaded, otherwise pages older messages (the existing ?after= scrollback)
// until it loads, bounded by CHAT_JUMP_MAX_PAGES. Nothing is stored.
import { t } from "./i18n.js";
import { conversationBase } from "./dm-extras.js";
import { appendHighlighted } from "./search-highlight.js";
import { isImeComposing } from "./focus-utils.js";

export const CHAT_JUMP_MAX_PAGES = 20;
const QUERY_MIN_CHARS = 2;
const QUERY_MAX_CHARS = 100;
const TYPING_DELAY_MS = 300;
const HIT_CLASS = "chat-widget-message-hit";

export function chatSearchPath(conversation, query) {
  const params = new URLSearchParams();
  params.set("q", String(query ?? ""));
  return conversationBase(conversation) + "/search?" + params.toString();
}

function hitButton(document, hit, query, { onJump, formatTime }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-widget-search-hit";
  const who = document.createElement("span");
  who.className = "chat-widget-search-who";
  who.textContent = typeof hit.authorUsername === "string" ? hit.authorUsername : "";
  const time = document.createElement("span");
  time.className = "chat-widget-search-time";
  time.textContent = formatTime(hit.createdAt);
  const excerpt = document.createElement("span");
  excerpt.className = "chat-widget-search-excerpt";
  appendHighlighted(document, excerpt, String(hit.maskedExcerpt ?? ""), query);
  button.append(who, time, excerpt);
  button.addEventListener("click", (event) => {
    event.preventDefault?.();
    onJump(Number(hit.id));
  });
  return button;
}

// The search box for one conversation. `box.runSearch()` searches now.
export function buildChatSearch(document, { conversation, apiFn, onJump, formatTime = (iso) => String(iso ?? "") }) {
  const box = document.createElement("div");
  box.className = "chat-widget-search";
  const input = document.createElement("input");
  input.type = "search";
  input.className = "chat-widget-search-input";
  input.maxLength = QUERY_MAX_CHARS;
  input.setAttribute("aria-label", t("chat.searchLabel"));
  input.placeholder = t("chat.searchPlaceholder");
  const results = document.createElement("div");
  results.className = "chat-widget-search-results";
  box.append(input, results);
  let latest = 0;
  let timer = null;

  const runSearch = async () => {
    latest += 1;
    const ticket = latest;
    const query = input.value.trim();
    if (query.length < QUERY_MIN_CHARS) {
      results.replaceChildren();
      return;
    }
    try {
      const data = await apiFn(chatSearchPath(conversation, query));
      if (ticket !== latest) return;
      const hits = Array.isArray(data?.results) ? data.results : [];
      if (!hits.length) {
        const empty = document.createElement("p");
        empty.className = "chat-widget-search-empty";
        empty.textContent = t("chat.searchNoMatches");
        results.replaceChildren(empty);
        return;
      }
      results.replaceChildren(...hits.map((hit) => hitButton(document, hit, query, { onJump, formatTime })));
    } catch {
      // A failed search leaves the box as it was; the reader can retry.
      if (ticket === latest) results.replaceChildren();
    }
  };

  input.addEventListener("input", () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; runSearch(); }, TYPING_DELAY_MS);
  });
  input.addEventListener("keydown", (event) => {
    if (isImeComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault?.();
      runSearch();
    } else if (event.key === "Escape") {
      input.value = "";
      runSearch();
    }
  });
  box.runSearch = runSearch;
  return box;
}

const findMessage = (scroll, id) => [...(scroll?.querySelectorAll("[data-message-id]") ?? [])]
  .find((node) => node.getAttribute("data-message-id") === String(id)) ?? null;

// Scrolls to and highlights message `id`; pages older (loadOlder resolves
// true when it added messages) until it is painted. False when not found.
export async function jumpToMessage(id, { getScroll, loadOlder, maxPages = CHAT_JUMP_MAX_PAGES }) {
  for (let pages = 0; ; pages += 1) {
    const scroll = getScroll();
    const node = findMessage(scroll, id);
    if (node) {
      scroll.querySelectorAll("." + HIT_CLASS).forEach((old) => old.classList.remove(HIT_CLASS));
      node.classList.add(HIT_CLASS);
      node.scrollIntoView?.({ block: "center" });
      return true;
    }
    if (pages >= maxPages) return false;
    if (!(await loadOlder())) return false;
  }
}
