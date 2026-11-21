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

// Wave 5.9 F2: search results at a glance. Under "Results for …" one row says
// what was found ("2 replies · 1 member · 5 posts"); each entry scrolls to and
// focuses its section. It only counts the arrays already in the /api/search
// payload — page-view only, nothing stored, nothing sent.
import { t, tn } from "./i18n.js";

export const SEARCH_SECTION_IDS = Object.freeze({
  replies: "search-replies",
  people: "search-people",
  posts: "search-posts",
});

const SECTION_KEYS = Object.freeze({
  replies: "search.jumpReplies",
  people: "search.jumpPeople",
  posts: "search.jumpPosts",
});

const countOf = (list) => (Array.isArray(list) ? list.length : 0);

// Page order: replies (only when the payload has that section), people, posts.
export const searchSummaryCounts = (results) => [
  { section: "replies", count: countOf(results?.replies) },
  { section: "people", count: countOf(results?.users) },
  { section: "posts", count: countOf(results?.posts) },
].filter((entry) => entry.count > 0);

const jumpTo = (target) => {
  if (!target) return;
  target.setAttribute("tabindex", "-1");
  if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
  target.focus();
};

export const createSearchSummary = (document, results, findTarget) => {
  const counts = searchSummaryCounts(results);
  if (!counts.length) return null;
  const nav = document.createElement("nav");
  nav.className = "search-summary";
  nav.setAttribute("aria-label", t("search.summaryLabel"));
  const label = document.createElement("span");
  label.className = "search-summary-label";
  label.textContent = t("search.jumpTo");
  nav.append(label);
  for (const { section, count } of counts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-quiet search-summary-jump";
    button.dataset.section = section;
    button.textContent = tn(SECTION_KEYS[section], count);
    button.addEventListener("click", () => jumpTo(findTarget(SEARCH_SECTION_IDS[section])));
    nav.append(button);
  }
  return nav;
};
