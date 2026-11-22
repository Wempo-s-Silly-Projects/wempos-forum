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

// Leaderboard table (Batch J): the all-time leaderboard as a real table, so
// sortable-tables.js can sort it by any column and stat-count.js can tick
// the scores up. Counts carry data-sort with the raw number (locale
// separators never confuse the sort); names are textContent-only links.
import { currentLocale, t } from "./i18n.js";

const COLUMNS = Object.freeze([
  { label: "ux.lbRank", numeric: true },
  { label: "ux.lbMember", numeric: false },
  { label: "ux.lbThreads", numeric: true },
  { label: "feed.repliesTitle", numeric: true },
  { label: "dm.reactionsLabel", numeric: true },
  { label: "ux.lbScore", numeric: true },
]);

function headerRow(document) {
  const row = document.createElement("tr");
  for (const column of COLUMNS) {
    const cell = document.createElement("th");
    cell.setAttribute("scope", "col");
    if (column.numeric) cell.setAttribute("data-sort-method", "number");
    cell.textContent = t(column.label);
    row.append(cell);
  }
  return row;
}

function numberCell(document, className, value, locale) {
  const cell = document.createElement("td");
  cell.className = className;
  const number = Number(value) || 0;
  cell.setAttribute("data-sort", String(number));
  cell.textContent = number.toLocaleString(locale);
  return cell;
}

function bodyRow(document, entry, index, locale) {
  const row = document.createElement("tr");
  row.className = "leaderboard-row";
  const rank = numberCell(document, "leaderboard-rank", index + 1, locale);
  rank.textContent = "#" + (index + 1);
  const name = document.createElement("td");
  const link = document.createElement("a");
  link.className = "leaderboard-name";
  link.textContent = entry.username;
  link.setAttribute("href", "/users/" + encodeURIComponent(entry.username));
  link.setAttribute("data-app-link", "");
  name.append(link);
  const score = numberCell(document, "leaderboard-score", entry.score, locale);
  score.setAttribute("data-count-up", String(Number(entry.score) || 0));
  row.append(rank, name,
    numberCell(document, "leaderboard-count", entry.threads, locale),
    numberCell(document, "leaderboard-count", entry.replies, locale),
    numberCell(document, "leaderboard-count", entry.reactionsReceived, locale),
    score);
  return row;
}

export function createLeaderboardTable(document, rows, { locale = currentLocale() } = {}) {
  const table = document.createElement("table");
  table.className = "leaderboard-table";
  table.setAttribute("aria-label", t("pages.leaderboardTitle"));
  const head = document.createElement("thead");
  head.append(headerRow(document));
  const body = document.createElement("tbody");
  for (const [index, entry] of rows.entries()) body.append(bodyRow(document, entry, index, locale));
  table.append(head, body);
  return table;
}
