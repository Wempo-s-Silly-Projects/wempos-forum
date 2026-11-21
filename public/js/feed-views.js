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

import { t } from "./i18n.js";

// Feed views (wave 2026-11-21-33): the home and category feeds offer two
// views as anchor chips — Active (the default bump order) and Newest (threads
// by when they were started). The view rides the URL (`?view=new`), so the
// chips are shareable and the back button works. The Unanswered chip was
// removed on the owner's call (Nov 21); the server's `unanswered=1` filter
// remains but nothing in the UI links to it.
const VIEW_QUERY = Object.freeze({ new: "sort=new" });

// The /api/posts query fragment for a view; "" for the default view.
export function feedViewQuery(view) {
  return Object.hasOwn(VIEW_QUERY, view) ? VIEW_QUERY[view] : "";
}

// basePath is "/" or "/c/<slug>"; activeView is undefined or "new".
export function createFeedViews(document, basePath, activeView) {
  const nav = document.createElement("nav");
  nav.className = "feed-views";
  nav.setAttribute("aria-label", t("feed.viewLabel"));
  const spec = [
    [undefined, t("feed.viewActive")],
    ["new", t("feed.viewNewest")],
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
export function feedViewEmptyText() {
  return undefined;
}
