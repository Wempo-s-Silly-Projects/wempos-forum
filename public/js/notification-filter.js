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

// "Unread only" on the Notifications page (wave 2026-11-21-37, v4.42): a
// checkbox that hides read rows in place, the bell's twin of the chat list's
// v4.32 filter. Page-view only: nothing stored, nothing sent, and it resets on
// the next render. createElement/textContent only.
import { t } from "./i18n.js";
import { syncDayHeadings } from "./notification-days.js";

const ROW_SELECTOR = ".notification-item";
const UNREAD_CLASS = "notification-unread";

const isUnreadRow = (row) => String(row.className ?? "").split(" ").includes(UNREAD_CLASS);

// Hides the section's read rows when `on` (shows every row when off) and
// reveals the "No unread notifications." line when nothing is left showing.
export function applyUnreadOnly(section, status, on) {
  const rows = [...section.querySelectorAll(ROW_SELECTOR)];
  for (const row of rows) row.hidden = Boolean(on) && !isUnreadRow(row);
  // v4.44: a day heading with nothing left showing under it hides too.
  syncDayHeadings(section, (node) => rows.includes(node));
  const empty = Boolean(on) && !rows.some(isUnreadRow);
  status.textContent = empty ? t("bell.noUnread") : "";
  status.hidden = !empty;
}

// The labelled checkbox plus its empty-state line (role=status, so the empty
// result is announced). The change handler reads the section's rows at that
// moment, so the toggle can be built before the rows are appended.
export function createUnreadOnlyToggle(document, section) {
  const wrap = document.createElement("div");
  wrap.className = "notifications-filter";
  const label = document.createElement("label");
  label.className = "notifications-unread-only";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = false;
  const text = document.createElement("span");
  text.textContent = t("bell.unreadOnly");
  label.append(box, text);
  const status = document.createElement("p");
  status.className = "notifications-unread-empty empty-state";
  status.setAttribute("role", "status");
  status.hidden = true;
  box.addEventListener("change", () => applyUnreadOnly(section, status, box.checked));
  wrap.append(label, status);
  return wrap;
}
