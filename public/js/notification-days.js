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

// Day dividers on the Notifications page (wave 2026-11-21-39, v4.44): rows
// arrive newest first and sit under "Today", "Yesterday" and "Earlier"
// headings, decided on the member's own calendar (local midnight, so DST
// days stay whole). A stamp ahead of the clock reads as today; a missing or
// unparseable stamp opens no heading. Page-view only: nothing stored, nothing
// sent. createElement/textContent only.
import { t } from "./i18n.js";

export const DAY_HEADING_CLASS = "notification-day";

const DAY_LABEL_KEYS = Object.freeze({
  today: "bell.dayToday",
  yesterday: "bell.dayYesterday",
  earlier: "bell.dayEarlier",
});

// "today" | "yesterday" | "earlier", or null when createdAt is not a parseable
// date string. `now` is a millisecond timestamp (Date.now() by default).
export function notificationDayKey(createdAt, now = Date.now()) {
  if (typeof createdAt !== "string" || !createdAt) return null;
  const at = new Date(createdAt).getTime();
  if (!Number.isFinite(at)) return null;
  const clock = new Date(now);
  const todayStart = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate()).getTime();
  const yesterdayStart = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() - 1).getTime();
  if (at >= todayStart) return "today";
  if (at >= yesterdayStart) return "yesterday";
  return "earlier";
}

export function createDayHeading(document, key) {
  const heading = document.createElement("h2");
  heading.className = DAY_HEADING_CLASS;
  heading.dataset.day = key;
  heading.textContent = t(DAY_LABEL_KEYS[key]);
  return heading;
}

// Hides each day heading whose rows (up to the next heading) are all hidden;
// called after the unread-only toggle sets each row's hidden flag.
export function syncDayHeadings(section, isRow) {
  let heading = null;
  let anyShown = false;
  const close = () => { if (heading) heading.hidden = !anyShown; };
  for (const node of [...section.children]) {
    if (String(node.className ?? "").split(" ").includes(DAY_HEADING_CLASS)) {
      close();
      heading = node;
      anyShown = false;
    } else if (isRow(node) && !node.hidden) {
      anyShown = true;
    }
  }
  close();
}
