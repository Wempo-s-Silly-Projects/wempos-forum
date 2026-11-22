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

// @mention autocomplete (wave 2026-11-21 F2): typing "@" plus a letter in a
// composer opens a suggestion list of members; Up/Down move, Enter/Tab pick,
// Escape closes, a click picks. Suggestions come from the existing
// GET /api/search member results through the one api() wrapper (the server
// already drops block-paired members). The token rule mirrors the server's
// MENTION_SCAN_PATTERN (api/mentions.mjs) so what the picker offers is exactly
// what notifies. Options are built with createElement/textContent only.
import { api } from "./api.js";
import { t } from "./i18n.js";
import { isImeComposing } from "./focus-utils.js";
import { replaceFieldRange } from "./field-edit.js";
import fuzzysort from "./vendor/fuzzysort.min.js";

export const MAX_MENTION_SUGGESTIONS = 6;
export const MENTION_SEARCH_DELAY_MS = 200;
const MENTION_MAX_QUERY = 100;
const MENTION_BEFORE_CARET = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]+)$/;

// The mention token that ends at the caret: { start (index of "@"), query
// (lowercased handle so far) } or null when the caret isn't in one.
export function mentionQueryAt(text, caret) {
  const left = String(text ?? "").slice(0, caret);
  const match = MENTION_BEFORE_CARET.exec(left);
  if (!match || match[1].length > MENTION_MAX_QUERY) return null;
  return { start: left.length - match[1].length - 1, query: match[1].toLowerCase() };
}

// Replaces text[start, caret) with "@username " and returns the new caret.
export function applyMention(text, start, caret, username) {
  const inserted = "@" + username + " ";
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  };
}

// Batch H: ranked by the vendored fuzzysort (match quality: contiguous runs,
// word starts, shorter names). Exact handles come first, then prefix
// matches, then other contiguous matches, then scattered ones, each by
// score; ties alphabetical. Username matches only
// (bio-only search hits dropped); capped.
const byName = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const mentionTier = (key, needle) => (key === needle ? 0 : key.startsWith(needle) ? 1 : key.includes(needle) ? 2 : 3);

export function rankMentionUsers(users, query) {
  const needle = String(query ?? "").toLowerCase();
  const named = (Array.isArray(users) ? users : []).filter((user) => typeof user?.username === "string");
  if (!needle) return named.slice(0, MAX_MENTION_SUGGESTIONS);
  return fuzzysort.go(needle, named, { key: "username", threshold: 0 })
    .map((result) => ({ user: result.obj, score: result.score, key: result.obj.username.toLowerCase() }))
    .sort((a, b) => mentionTier(a.key, needle) - mentionTier(b.key, needle) || b.score - a.score || byName(a, b))
    .slice(0, MAX_MENTION_SUGGESTIONS)
    .map((entry) => entry.user);
}

// Puts "@username " over field.value[start, caret) through field-edit.js, so
// the pick lands on the native undo stack.
export function insertMention(field, start, caret, username) {
  const inserted = "@" + username + " ";
  replaceFieldRange(field, start, caret, inserted);
}

// Wires one composer textarea. State lives in this closure; every async
// search result is checked against a sequence number so a slow answer never
// repaints over a newer query.
export function attachMentionPicker(textarea, document) {
  if (!textarea || !document) return;
  const listId = (textarea.id || "composer") + "-mentions";
  const list = document.createElement("ul");
  list.id = listId;
  list.className = "mention-picker";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("mentions.listLabel"));
  list.hidden = true;
  textarea.insertAdjacentElement("afterend", list);
  // ARIA 1.2 textbox popup pattern without role=combobox on the textarea:
  // aria-expanded is not allowed on a textbox, aria-haspopup is.
  textarea.setAttribute("aria-autocomplete", "list");
  textarea.setAttribute("aria-haspopup", "listbox");
  textarea.setAttribute("aria-controls", listId);

  let users = [];
  let active = 0;
  let token = null;
  let sequence = 0;
  let timer = null;

  const close = () => {
    users = [];
    token = null;
    list.hidden = true;
    list.replaceChildren();
    textarea.removeAttribute("aria-activedescendant");
  };

  const choose = (index) => {
    const user = users[index];
    if (!user || !token) return;
    const { start } = token;
    const caret = textarea.selectionStart;
    close();
    insertMention(textarea, start, caret, user.username);
    textarea.focus();
  };

  const paint = () => {
    list.replaceChildren(...users.map((user, index) => {
      const option = document.createElement("li");
      option.id = listId + "-" + index;
      option.className = "mention-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", index === active ? "true" : "false");
      option.textContent = "@" + user.username;
      // mousedown (not click) so the textarea keeps focus and the caret.
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        choose(index);
      });
      return option;
    }));
    list.hidden = users.length === 0;
    if (users.length) textarea.setAttribute("aria-activedescendant", listId + "-" + active);
    else textarea.removeAttribute("aria-activedescendant");
  };

  const search = async (query, mySequence) => {
    try {
      const data = await api("/api/search?q=" + encodeURIComponent(query));
      if (mySequence !== sequence) return;
      users = rankMentionUsers(data?.users, query);
      active = 0;
      paint();
    } catch {
      // Search failing just means no suggestions; typing carries on.
      if (mySequence === sequence) close();
    }
  };

  textarea.addEventListener("input", () => {
    clearTimeout(timer);
    sequence += 1;
    const found = mentionQueryAt(textarea.value, textarea.selectionStart);
    if (!found) {
      close();
      return;
    }
    token = found;
    const mySequence = sequence;
    timer = setTimeout(() => search(found.query, mySequence), MENTION_SEARCH_DELAY_MS);
  });

  textarea.addEventListener("keydown", (event) => {
    if (list.hidden || users.length === 0 || isImeComposing(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (active + step + users.length) % users.length;
      paint();
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  textarea.addEventListener("blur", () => {
    sequence += 1;
    close();
  });
}
