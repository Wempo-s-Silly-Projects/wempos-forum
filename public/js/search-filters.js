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

// Search filters (wave 5.36): date-range and sort chips on the search page.
// The filters ride the URL (`/?q=…&since=…&sort=…`), so a filtered search is
// shareable and the back button works; defaults are left out of the URL.
// Every URL is built with the URL API from validated values only.
import { t } from "./i18n.js";
import { SEARCH_SINCE, SEARCH_SORTS } from "./router.js";

export { SEARCH_SINCE, SEARCH_SORTS };

const URL_BASE = "https://forum.invalid";

const knownFilters = ({ since, sort } = {}) => ({
  since: SEARCH_SINCE.includes(since) && since !== SEARCH_SINCE[0] ? since : null,
  sort: SEARCH_SORTS.includes(sort) && sort !== SEARCH_SORTS[0] ? sort : null,
});

const applyFilters = (params, filters) => {
  const { since, sort } = knownFilters(filters);
  if (since) params.set("since", since);
  if (sort) params.set("sort", sort);
  return params;
};

// The search page path for a query plus filters, e.g. "/?q=cats&since=week".
export function searchPagePath(query, filters = {}) {
  const url = new URL("/", URL_BASE);
  url.searchParams.set("q", String(query ?? ""));
  applyFilters(url.searchParams, filters);
  return url.pathname + url.search;
}

// The /api/search request for a search route (deep reply search included).
export function searchApiPath(route) {
  const params = new URLSearchParams();
  params.set("q", String(route?.query ?? ""));
  params.set("in", "replies");
  return "/api/search?" + applyFilters(params, route).toString();
}

const SINCE_LABELS = Object.freeze({
  any: "search.sinceAny", week: "search.sinceWeek", month: "search.sinceMonth", year: "search.sinceYear",
});
const SORT_LABELS = Object.freeze({ relevant: "search.sortRelevant", new: "search.sortNew" });

function chipGroup(document, label, chips) {
  const group = document.createElement("div");
  group.className = "feed-views search-filter-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  for (const { text, href, current } of chips) {
    const chip = document.createElement("a");
    chip.className = "feed-view search-filter";
    chip.textContent = text;
    chip.href = href;
    chip.setAttribute("data-app-link", "");
    if (current) chip.setAttribute("aria-current", "page");
    group.append(chip);
  }
  return group;
}

// Two chip groups (date range, sort); each chip keeps the query and the
// other group's current choice.
export function createSearchFilters(document, route) {
  const current = knownFilters(route);
  const since = current.since ?? SEARCH_SINCE[0];
  const sort = current.sort ?? SEARCH_SORTS[0];
  const nav = document.createElement("nav");
  nav.className = "search-filters";
  nav.append(
    chipGroup(document, t("search.sinceLabel"), SEARCH_SINCE.map((value) => ({
      text: t(SINCE_LABELS[value]),
      href: searchPagePath(route.query, { since: value, sort }),
      current: value === since,
    }))),
    chipGroup(document, t("search.sortLabel"), SEARCH_SORTS.map((value) => ({
      text: t(SORT_LABELS[value]),
      href: searchPagePath(route.query, { since, sort: value }),
      current: value === sort,
    }))),
  );
  return nav;
}
