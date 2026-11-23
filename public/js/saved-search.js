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

// Search the saved posts on the page (L2 wave): a search box on /bookmarks
// that filters the cards already shown, full text, in this browser only.
// MiniSearch 7.2.0 (MIT, vendored verbatim as public/js/vendor/minisearch.js)
// loads with a dynamic import the first time the member types; it indexes the
// cards' visible text (spoilers are already masked on the page), so nothing
// new is fetched, stored or sent. Matching is prefix and typo-tolerant, and
// every word must match. Cards added by "Load older" are picked up because
// each search indexes the cards on the page at that moment (a page holds a
// few dozen cards, so this stays instant). If MiniSearch fails
// to load, every card simply stays shown.
import { t } from "./i18n.js";

const INPUT_ID = "saved-search-input";
const HIDDEN = "hidden";
const SEARCH_OPTIONS = Object.freeze({ prefix: true, fuzzy: 0.2, combineWith: "AND" });

const loadDefault = () => import("./vendor/minisearch.js").then((module) => module.default);

// The top-level cards of every post list under root (never a nested card).
export function savedCards(root) {
  const lists = Array.from(root?.querySelectorAll?.(".post-list") ?? []);
  return lists.flatMap((list) => Array.from(list.children).filter((node) => node.classList?.contains("post-card")));
}

// The ids of the docs matching query, or null for a blank query (show all).
export function matchingIndexes(MiniSearch, docs, query) {
  const text = String(query ?? "").trim();
  if (!text) return null;
  const index = new MiniSearch({ fields: ["text"], searchOptions: SEARCH_OPTIONS });
  index.addAll(docs);
  return new Set(index.search(text).map((result) => result.id));
}

function showMatches(cards, matches, none) {
  cards.forEach((card, index) => {
    if (!matches || matches.has(index)) card.removeAttribute(HIDDEN);
    else card.setAttribute(HIDDEN, "");
  });
  if (matches && matches.size === 0) none.removeAttribute(HIDDEN);
  else none.setAttribute(HIDDEN, "");
}

export function createSavedSearch(document, root, { loadMiniSearch = loadDefault } = {}) {
  const box = document.createElement("div");
  box.className = "saved-search";
  const label = document.createElement("label");
  label.className = "saved-search-label";
  label.setAttribute("for", INPUT_ID);
  label.textContent = t("feed.savedSearchLabel");
  const input = document.createElement("input");
  input.id = INPUT_ID;
  input.setAttribute("type", "search");
  input.className = "saved-search-input";
  input.setAttribute("autocomplete", "off");
  const none = document.createElement("p");
  none.className = "saved-search-none muted";
  none.setAttribute("role", "status");
  none.setAttribute(HIDDEN, "");
  none.textContent = t("feed.savedSearchNone");
  let library = null;
  input.addEventListener("input", () => {
    library ??= loadMiniSearch();
    const query = input.value;
    library.then((MiniSearch) => {
      if (input.value !== query) return;
      const cards = savedCards(root);
      const docs = cards.map((card, id) => ({ id, text: card.textContent }));
      showMatches(cards, matchingIndexes(MiniSearch, docs, query), none);
    }, () => {
      // MiniSearch did not load: the list stays exactly as rendered.
    });
  });
  box.append(label, input, none);
  return box;
}
