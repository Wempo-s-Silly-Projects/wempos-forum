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

// Formatting help (wave 2026-11-21-23 F2): a native <details> disclosure under
// the forum composers listing exactly the markup the post renderer supports
// (markdown.js). The syntax column is language-neutral marker shapes; only
// the labels are translated. Static: no network, nothing stored, and it
// starts closed so the composer stays compact. createElement/textContent only.
import { t } from "./i18n.js";

// [syntax shown, label key] in the order a member is likeliest to need them.
export const FORMAT_ROWS = [
  ["**…**", "format.bold"],
  ["*…*", "format.italic"],
  ["~~…~~", "format.strike"],
  ["`…`", "format.code"],
  ["||…||", "format.spoiler"],
  ["[…](https://…)", "format.link"],
  ["@…", "format.mention"],
  ["- …", "format.list"],
  ["> …", "format.quote"],
  ["# …", "format.heading"],
  ["```", "format.codeBlock"],
];

export function createFormatHelp(document) {
  const details = document.createElement("details");
  details.className = "format-help";
  const summary = document.createElement("summary");
  summary.textContent = t("format.summary");
  const list = document.createElement("dl");
  list.className = "format-help-list";
  for (const [syntax, key] of FORMAT_ROWS) {
    const term = document.createElement("dt");
    const code = document.createElement("code");
    code.textContent = syntax;
    term.append(code);
    const meaning = document.createElement("dd");
    meaning.textContent = t(key);
    list.append(term, meaning);
  }
  const note = document.createElement("p");
  note.className = "form-note format-help-note";
  note.textContent = t("format.note");
  details.append(summary, list, note);
  return details;
}
