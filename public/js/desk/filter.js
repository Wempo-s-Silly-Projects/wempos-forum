// v4.3: the desk's word-filter section builder. The filter list lives in D1
// (api/filterstore.mjs) and is edited from here — a full-list editor (save
// replaces the whole list) plus a bulk-add box that appends pasted entries
// with deduping. The bulk box reuses the filter's own entry-splitting rules
// server-side, so a pasted line that is really one regex pattern (commas
// inside a char class) stays whole, exactly like the filter will read it.
import { createForm, createTextarea, addText } from "../forms.js";

export function createFilterEditor(data, document) {
  const section = document.createElement("div");
  section.className = "filter-editor";
  const sourceNote = data.source === "database"
    ? "The list is stored in the database — edits apply everywhere within about 30 seconds."
    : data.source === "secret"
      ? "Currently serving from the FILTERED_WORDS secret. Saving here copies the list into the database (prefilled with the secret's entries); after that the database wins and the secret stops mattering."
      : "No filter is set yet. Save entries here to turn it on — nothing is filtered until then.";
  addText(document, section, "p", sourceNote, "muted");
  const stats = document.createElement("p");
  stats.className = "muted";
  stats.textContent = data.totalEntries + " entries" +
    (data.updatedAt ? " · last saved " + new Date(data.updatedAt).toLocaleString() : "");
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
