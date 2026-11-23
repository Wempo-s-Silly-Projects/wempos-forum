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

// The search module's page (docs/modules.md): /search?q=<words>&sort=new.
// Loaded on demand by route-modules.js and never while the module is off
// (app.js swaps the route for not-found). Results come from
// GET /api/search/full with spoilers already masked; the searched words are
// marked with search-highlight.js (text nodes and <mark> only). The owner
// also gets the index backfill button. Nothing is stored in the browser.
import { api } from "../api.js";
import { addHeading, element, main, setMessage } from "../dom.js";
import { addText, createInput } from "../forms.js";
import { currentLocale, t } from "../i18n.js";
import { highlightTerms } from "../search-highlight.js";
import { fullSearchPagePath, searchPagePath } from "../search-filters.js";
import { state } from "../state.js";

const FULL_SEARCH_API = "/api/search/full";
const BACKFILL_API = "/api/search/backfill";
const QUERY_MAX_CHARS = 100;
const SORT_LABELS = Object.freeze({ relevant: "search.sortRelevant", new: "search.sortNew" });

export function fullSearchApiPath(query, sort, cursor = null) {
  const params = new URLSearchParams();
  params.set("q", String(query ?? ""));
  if (sort === "new") params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
  return FULL_SEARCH_API + "?" + params.toString();
}

function appendMarked(parent, text, terms) {
  for (const part of highlightTerms(text, terms)) {
    if (!part.hit) {
      parent.append(document.createTextNode(part.text));
      continue;
    }
    const mark = element("mark", "search-hit", part.text);
    parent.append(mark);
  }
  return parent;
}

function appLink(href, text, className = "") {
  const link = element("a", className, text);
  link.setAttribute("href", href);
  link.setAttribute("data-app-link", "");
  return link;
}

function searchForm(route) {
  const form = element("form", "full-search-form");
  form.setAttribute("role", "search");
  const field = createInput(document, {
    id: "full-search-query", name: "q", type: "search", label: t("search.fullLabel"),
    maxLength: QUERY_MAX_CHARS, value: route.query,
  });
  const submit = element("button", "button", t("shell.search"));
  submit.type = "submit";
  form.append(field, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = form.querySelector("#full-search-query")?.value ?? "";
    state.router.navigate(fullSearchPagePath(value.trim(), route.sort ?? null));
  });
  return form;
}

function sortChips(route) {
  const group = element("div", "feed-views search-filter-group");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("search.sortLabel"));
  const current = route.sort === "new" ? "new" : "relevant";
  for (const sort of Object.keys(SORT_LABELS)) {
    const chip = appLink(fullSearchPagePath(route.query, sort), t(SORT_LABELS[sort]), "feed-view search-filter");
    if (sort === current) chip.setAttribute("aria-current", "page");
    group.append(chip);
  }
  return group;
}

function resultItem(post, terms) {
  const item = element("li", "full-search-result");
  const link = appLink("/posts/" + post.threadId, "", "full-search-excerpt");
  appendMarked(link, post.excerpt, terms);
  const meta = element("p", "muted");
  meta.textContent = post.author + " · " + new Date(post.createdAt).toLocaleString(currentLocale());
  item.append(link, meta);
  return item;
}

function backfillPanel() {
  const panel = element("div", "full-search-backfill");
  const status = element("p", "muted");
  status.setAttribute("aria-live", "polite");
  const button = element("button", "button button-secondary", t("search.fullBuild"));
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = t("search.fullBuilding");
    try {
      let after = 0;
      for (;;) {
        const step = await api(BACKFILL_API, { method: "POST", body: { after } });
        after = step.after;
        if (step.done) break;
      }
      status.textContent = t("search.fullBuilt");
    } catch (error) {
      status.textContent = "";
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  panel.append(button, status);
  return panel;
}

function moreButton(route, list, cursor) {
  const button = element("button", "button button-secondary", t("longPost.showMore"));
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const data = await api(fullSearchApiPath(route.query, route.sort, cursor));
      for (const post of data.posts) list.append(resultItem(post, data.terms));
      button.replaceWith(...(data.nextCursor ? [moreButton(route, list, data.nextCursor)] : []));
    } catch (error) {
      button.disabled = false;
      setMessage(error.message, true);
    }
  });
  return button;
}

export async function renderFullSearchRoute(route, context, version) {
  addHeading(main, t("modules.label.search"), 2);
  main.append(searchForm(route));
  if (context.session?.user?.role === "owner") main.append(backfillPanel());
  if (!route.query) {
    addText(document, main, "p", t("search.fullHint"), "muted");
    return;
  }
  const classic = element("p");
  classic.append(appLink(searchPagePath(route.query), t("search.fullClassic")));
  main.append(sortChips(route), classic);
  const data = await api(fullSearchApiPath(route.query, route.sort));
  if (version !== state.renderVersion) return;
  if (data.posts.length === 0) {
    addText(document, main, "p", t("search.fullEmpty"), "empty-state");
    return;
  }
  const list = element("ol", "full-search-results");
  for (const post of data.posts) list.append(resultItem(post, data.terms));
  main.append(list);
  if (data.nextCursor) main.append(moreButton(route, list, data.nextCursor));
}
