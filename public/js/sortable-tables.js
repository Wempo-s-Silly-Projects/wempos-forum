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

// Sortable tables (Batch J): the leaderboard and the desk's visit tables
// sort by any column with the vendored tablesort (MIT) and its number
// plugin. tablesort makes each header a focusable columnheader that sorts on
// click or Enter and keeps aria-sort on the sorted one, so screen readers
// hear the order. Sorting is client-only, over the rows already shown.
import { loadVendorScripts } from "./vendor-load.js";

export const SORTABLE_TABLE_SELECTOR = "table.leaderboard-table, table.visits-table"; // i18n-ignore
export const TABLESORT_SOURCES = Object.freeze([
  "/js/vendor/tablesort.min.js",
  "/js/vendor/tablesort.number.min.js",
]);
const WIRED_ATTRIBUTE = "data-sortable";

export const loadTablesort = () => loadVendorScripts(globalThis.document, TABLESORT_SOURCES, () => globalThis.Tablesort);

export function sortableTables(root) {
  return [...(root?.querySelectorAll?.(SORTABLE_TABLE_SELECTOR) ?? [])]
    .filter((table) => !table.hasAttribute(WIRED_ATTRIBUTE));
}

export function makeTablesSortable(root, { Tablesort }) {
  for (const table of sortableTables(root)) {
    table.setAttribute(WIRED_ATTRIBUTE, "");
    new Tablesort(table);
  }
}
