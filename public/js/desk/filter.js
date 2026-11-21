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

// v4.3: the desk's word-filter section builder. The filter list lives in D1
// (api/filterstore.mjs) and is edited from here — a full-list editor (save
// replaces the whole list) plus a bulk-add box that appends pasted entries
// with deduping. The bulk box reuses the filter's own entry-splitting rules
// server-side, so a pasted line that is really one regex pattern (commas
// inside a char class) stays whole, exactly like the filter will read it.
import { createForm, createTextarea, addText } from "../forms.js";
import { currentLocale, t, tn } from "../i18n.js";

export function createFilterEditor(data, document) {
  const section = document.createElement("div");
  section.className = "filter-editor";
  const sourceNote = data.source === "database"
    ? t("desk.filter.sourceDatabase")
    : data.source === "secret"
      ? t("desk.filter.sourceSecret")
      : t("desk.filter.sourceNone");
  addText(document, section, "p", sourceNote, "muted");
  const stats = document.createElement("p");
  stats.className = "muted";
  stats.textContent = tn("desk.filter.stats", data.totalEntries) +
    (data.updatedAt ? t("desk.filter.lastSaved", { when: new Date(data.updatedAt).toLocaleString(currentLocale()) }) : "");
  // The full-list editor: the textarea IS the new truth on save. Prefilled
  // with the effective list (D1 when present, else the secret) so a first
  // save migrates the list in place. Saving an empty list turns the filter
  // off deliberately.
  const editor = createForm(document, "filter-save", [
    createTextarea(document, {
      id: "filter-list",
      name: "words",
      label: t("desk.filter.listLabel"),
      rows: 14,
      maxLength: 262144,
      counter: true,
      value: data.words,
      description: t("desk.filter.listHelp"),
    }),
  ], t("desk.filter.saveButton"));
  // Bulk add: paste a batch, duplicates skip, the rest of the list untouched.
  const bulk = createForm(document, "filter-bulk-add", [
    createTextarea(document, {
      id: "filter-bulk",
      name: "entries",
      label: t("desk.filter.bulkLabel"),
      rows: 6,
      maxLength: 262144,
      counter: true,
      description: t("desk.filter.bulkHelp"),
    }),
  ], t("desk.filter.bulkButton"));
  section.append(stats, editor, bulk);
  return section;
}
