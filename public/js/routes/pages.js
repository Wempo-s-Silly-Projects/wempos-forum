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

// v4.0 plan 4 Task 6: the standalone content pages — the rules page (site
// copy through the markdown subset), the all-time leaderboard, and the
// accountability archive (read route + load-older fragmenting), plus the
// site-search submit and the rules save action. Bodies moved verbatim out of
// app.js.
import { api } from "../api.js";
import { addHeading, element, main, setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import { renderBodyBlocks } from "../render.js";
import { t, currentLocale } from "../i18n.js";
import { createWeekPage } from "../week.js";
import { createLeaderboardTable } from "../leaderboard-table.js";
import { createLoadMoreTag, createTagPage, createTagThreadRows, tagListingPath } from "../tags.js";
import { rememberSearch } from "../recent-searches.js";
import { fullSearchPagePath, searchPagePath } from "../search-filters.js";
import { siteModuleOn } from "../site-modules.js";

async function renderRulesRoute(context, version) {
  const data = await api("/api/rules");
  if (version !== state.renderVersion) return;
  addHeading(main, t("pages.rulesTitle"), 2);
  if (!data.rules) {
    addText(document, main, "p", t("pages.rulesEmpty"), "empty-state");
    return;
  }
  renderBodyBlocks({ body: data.rules }, document, main);
  if (data.updatedAt) {
    addText(document, main, "p", t("pages.rulesUpdated", { date: new Date(data.updatedAt).toLocaleString(currentLocale()) }), "muted");
  }
}

async function renderLeaderboardRoute(context, version) {
  const data = await api("/api/leaderboard");
  if (version !== state.renderVersion) return;
  addHeading(main, t("pages.leaderboardTitle"), 2);
  const rows = data.allTime.leaderboard;
  if (!rows.length) {
    addText(document, main, "p", t("pages.leaderboardEmpty"), "empty-state");
    return;
  }
  // Batch J: a sortable table (sortable-tables.js) with counting scores.
  main.append(createLeaderboardTable(document, rows));
}

// This week (v5.35): the staff pick, the most replied threads and the newest
// Showcase builds of the last 7 days — public, guests included.
async function renderWeekRoute(context, version) {
  const data = await api("/api/week");
  if (version !== state.renderVersion) return;
  addHeading(main, t("week.title"), 2);
  addText(document, main, "p", t("week.lede"), "muted");
  main.append(createWeekPage(document, data));
}

// Thread tags (v5.44): /tag/<slug> — the tagged threads, newest first, for
// guests too. An unknown tag is the server's 404, painted as the 404 page by
// app.js.
async function renderTagRoute(route, context, version) {
  const data = await api(tagListingPath(route.slug));
  if (version !== state.renderVersion) return;
  addHeading(main, t("tags.pageTitle", { label: String(data.tag?.label ?? "") }), 2);
  main.append(createTagPage(document, data));
}

async function loadMoreTag(button) {
  const older = await api(tagListingPath(button.dataset.slug, button.dataset.before));
  const threads = Array.isArray(older.threads) ? older.threads : [];
  if (threads.length) button.before(createTagThreadRows(document, threads));
  if (older.nextBefore) button.replaceWith(createLoadMoreTag(document, button.dataset.slug, older.nextBefore));
  else button.remove();
}

async function renderArchiveRoute(context, version) {
  // The accountability archive (v2.4.1): everyone can read what was deleted,
  // so no auth is needed — this route renders for guests too.
  const data = await api("/api/archive");
  if (version !== state.renderVersion) return;
  addHeading(main, t("pages.archiveTitle"), 2);
  if (!data.archive.length) {
    main.append(element("p", "archive-empty", t("pages.archiveEmpty")));
    return;
  }
  main.append(await renderArchiveListFragment(data.archive));
  if (!data.nextBefore) return;
  const older = element("button", "button button-secondary", t("pages.archiveLoadOlder"));
  older.type = "button";
  older.dataset.action = "load-more-archive";
  older.dataset.before = String(data.nextBefore);
  main.append(older);
}

async function renderArchiveListFragment(entries) {
  const list = element("div", "archive-list");
  for (const entry of entries) {
    const card = element("article", "archive-card");
    const header = element("p", "archive-header");
    header.append(element("span", "archive-author", t("pages.archiveAuthor", { name: entry.authorName })));
    header.append(element("span", "archive-meta",
      t(entry.deletedBecause === "account-delete" ? "pages.archiveMetaAccount" : "pages.archiveMetaPost", {
        date: new Date(entry.deletedAt).toLocaleString(currentLocale()),
        by: entry.deletedByName || t("pages.archiveUnknown"),
      })));
    card.append(header);
    const bodyBlock = element("p", "archive-body");
    bodyBlock.textContent = entry.body;
    card.append(bodyBlock);
    list.append(card);
  }
  return list;
}

async function loadMoreArchive(button) {
  // The accountability archive paginates on the raw row id (newest-first);
  // each page appends below the previous one like the feed routes.
  const older = await api("/api/archive?before=" + button.dataset.before);
  const rendered = await renderArchiveListFragment(older.archive);
  button.before(rendered);
  button.remove();
  if (!older.nextBefore) return;
  const next = element("button", "button button-secondary", t("pages.archiveLoadOlder"));
  next.type = "button";
  next.dataset.action = "load-more-archive";
  next.dataset.before = String(older.nextBefore);
  main.append(next);
}

async function submitSiteSearch(text) {
  const query = text("q").trim();
  // Wave 5.36: remembered in this browser only (account-scoped, never sent).
  rememberSearch(undefined, state.currentUser?.id ?? null, query);
  // The search module on: the header box opens the full-text page, which
  // links back to the classic people-and-threads search.
  state.router.navigate(siteModuleOn("search") ? fullSearchPagePath(query) : searchPagePath(query));
}
export const FORM_HANDLERS = {
  "site-search": (form, text) => submitSiteSearch(text),
};

export const ACTIONS = {
    "save-forum-rules": async () => {
      const input = document.querySelector("#rules-input");
      if (!input) return;
      await api("/api/rules", { method: "POST", body: input.value });
      state.router.navigate("/rules");
      setMessage(t("pages.rulesSaved"));
    },
    "load-more-archive": (button) => loadMoreArchive(button),
    "load-more-tag": (button) => loadMoreTag(button),
};

export { renderRulesRoute, renderLeaderboardRoute, renderArchiveRoute, renderWeekRoute, renderTagRoute };
