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

import { t } from "./i18n.js";

// Feed views (wave 2026-11-21-33): the home and category feeds offer three
// views as anchor chips — Active (the default bump order), Newest (threads by
// when they were started) and Unanswered (threads nobody has replied to yet,
// as far as you can see). The view rides the URL (`?view=new|unanswered`), so
// the chips are shareable and the back button works. The server judges
// "unanswered" with the same visibility rules as the card's reply count.
const VIEW_QUERY = Object.freeze({ new: "sort=new", unanswered: "unanswered=1" });

// The /api/posts query fragment for a view; "" for the default view.
export function feedViewQuery(view) {
  return Object.hasOwn(VIEW_QUERY, view) ? VIEW_QUERY[view] : "";
}

// basePath is "/" or "/c/<slug>"; activeView is undefined, "new" or "unanswered".
export function createFeedViews(document, basePath, activeView) {
  const nav = document.createElement("nav");
  nav.className = "feed-views";
  nav.setAttribute("aria-label", t("feed.viewLabel"));
  const spec = [
    [undefined, t("feed.viewActive")],
    ["new", t("feed.viewNewest")],
    ["unanswered", t("feed.viewUnanswered")],
  ];
  for (const [view, label] of spec) {
    const chip = document.createElement("a");
    chip.className = "feed-view";
    chip.textContent = label;
    chip.href = view ? basePath + "?view=" + view : basePath;
    chip.setAttribute("data-app-link", "");
    if (view === activeView) chip.setAttribute("aria-current", "page");
    nav.append(chip);
  }
  return nav;
}

// The empty-state line for a view; undefined keeps the caller's default.
export function feedViewEmptyText(view) {
  if (view === "unanswered") return t("feed.unansweredEmpty");
  return undefined;
}
