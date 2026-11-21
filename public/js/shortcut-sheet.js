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

// Keyboard shortcuts sheet (wave 2026-11-21-29 F2): a closed-by-default
// <details> beside the J/K hint on a thread page, listing the shortcuts the
// forum already has (J/K posts, Ctrl/Cmd+Enter posts, the image viewer's
// keys, the @mention picker's keys, Esc). It binds no keys itself (so WCAG
// 2.1.4 is untouched), stores nothing and sends nothing. Each row is one
// translated sentence, because locales name keys their own way (Strg, Entrée).
import { t } from "./i18n.js";

export const SHORTCUT_ROWS = Object.freeze([
  "shortcuts.posts",
  "shortcuts.submit",
  "shortcuts.images",
  "shortcuts.mentions",
  "shortcuts.close",
]);

export function createShortcutSheet(document) {
  const sheet = document.createElement("details");
  sheet.className = "shortcut-sheet";
  const summary = document.createElement("summary");
  summary.textContent = t("shortcuts.title");
  const list = document.createElement("ul");
  list.className = "shortcut-sheet-list";
  for (const key of SHORTCUT_ROWS) {
    const row = document.createElement("li");
    row.textContent = t(key);
    list.append(row);
  }
  sheet.append(summary, list);
  return sheet;
}
