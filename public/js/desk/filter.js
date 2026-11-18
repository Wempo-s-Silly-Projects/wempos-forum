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
// Re-expressed on the vendored kit (5.0 wave 6).
import { el } from "../vendor/frontload/dom.mjs";
import { addText, createForm } from "../vendor/designer/kit.mjs";
import { createTextarea } from "../forms.js";

export function createFilterEditor(data) {
  const section = el("div", { class: "filter-editor" });
  const sourceNote = data.source === "database"
    ? "The list is stored in the database — edits apply everywhere within about 30 seconds."
    : data.source === "secret"
      ? "Currently serving from the FILTERED_WORDS secret. Saving here copies the list into the database (prefilled with the secret's entries); after that the database wins and the secret stops mattering."
      : "No filter is set yet. Save entries here to turn it on — nothing is filtered until then.";
  addText(section, sourceNote, "muted");
  const stats = el("p", {
    class: "muted",
    text: data.totalEntries + " entries" +
      (data.updatedAt ? " · last saved " + new Date(data.updatedAt).toLocaleString() : ""),
  });
  // The full-list editor: the textarea IS the new truth on save. Prefilled
  // with the effective list (D1 when present, else the secret) so a first
  // save migrates the list in place. Saving an empty list turns the filter
  // off deliberately.
  const editor = createForm(document, "filter-save", [
    createTextarea(document, {
      id: "filter-list",
      name: "words",
      label: "The full filter list",
      rows: 14,
      maxLength: 262144,
      counter: true,
      value: data.words,
      description: "One entry per line (commas separate too). Plain words mask exactly as whole tokens; /regex/, bare regex, and *glob* entries keep their full pattern power. Saving an empty list turns the filter off.",
    }),
  ], "Save filter list");
  // Bulk add: paste a batch, duplicates skip, the rest of the list untouched.
  const bulk = createForm(document, "filter-bulk-add", [
    createTextarea(document, {
      id: "filter-bulk",
      name: "entries",
      label: "Bulk add entries",
      rows: 6,
      maxLength: 262144,
      counter: true,
      description: "One entry per line or comma-separated. Duplicates are skipped; nothing else in the list changes.",
    }),
  ], "Add entries");
  section.append(stats, editor, bulk);
  return section;
}
