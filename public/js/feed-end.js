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
import { jumpToNode } from "./focus-utils.js";

// End of feed (wave 2026-11-21-35 F2): once Load older brings in a feed's
// final page, the list closes with "You've reached the end of this feed."
// and a Back to top button that scrolls to and focuses the page's first
// heading, so a long scroll has a clear finish and a one-press way back.
// Page-view only: nothing is stored or requested.

// Mirrors constants.mjs FEED_PAGE_SIZE (pinned equal by the wave-35 test).
export const FEED_END_PAGE_SIZE = 20;

// True for a non-empty final page: short, or full with no further cursor.
// An empty first page already shows the feed's empty-state line; an empty
// Load older page (wave 40: the feed held exactly FEED_END_PAGE_SIZE posts,
// so a cursor came back) is the end of the feed too.
export function reachedFeedEnd(page, { olderPage = false } = {}) {
  const posts = page && Array.isArray(page.posts) ? page.posts : [];
  if (!posts.length) return olderPage;
  return posts.length !== FEED_END_PAGE_SIZE || !page.nextBefore;
}

const firstHeading = (scope) =>
  scope?.querySelector?.("h1") ?? scope?.querySelector?.("h2") ?? null;

export function createFeedEnd(document, scope) {
  const end = document.createElement("div");
  end.className = "feed-end";
  const text = document.createElement("p");
  text.className = "feed-end-text";
  text.setAttribute("role", "status");
  text.textContent = t("feed.endOfFeed");
  const top = document.createElement("button");
  top.type = "button";
  top.className = "button button-quiet feed-end-top";
  top.textContent = t("feed.backToTop");
  top.addEventListener("click", () => jumpToNode(firstHeading(scope)));
  end.append(text, top);
  return end;
}
