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

// This week (v5.35.0). Pure DOM builders — the caller passes the document and
// does the fetch (routes/pages.js for /week, routes/feed.js for the home
// panel); nothing here touches storage or the network:
//   createWeekPage     — the /week body: the staff pick on top, the most
//                        replied threads of the last 7 days, the newest
//                        Showcase builds.
//   createWeekLink     — the home page's link to /week.
//   createNewestMembers — the home "Newest members" list (null when empty).
// Thread previews are masked twice over: the server masks before its cut, and
// threadExcerpt masks again before cutting to the card length.
import { boardLabel } from "./boards.js";
import { t, tn } from "./i18n.js";
import { threadExcerpt } from "./profile-extras.js";
import { createShowcaseGallery, createStaffPickTile } from "./traditions.js";

const make = (document, tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const appLink = (document, className, href, text) => {
  const link = make(document, "a", className, text);
  link.href = href;
  link.setAttribute("data-app-link", "");
  return link;
};

function createWeekThreads(document, threads) {
  if (!threads.length) return make(document, "p", "empty-state", t("week.threadsEmpty"));
  const list = make(document, "ol", "week-threads");
  for (const thread of threads) {
    const row = make(document, "li", "week-thread");
    row.append(appLink(document, "week-thread-link", "/posts/" + Number(thread.id), threadExcerpt(String(thread.excerpt ?? ""))));
    const meta = [boardLabel(thread.board), tn("counts.replies", Number(thread.replyCount) || 0)];
    if (thread.authorName) meta.unshift(thread.authorName);
    row.append(make(document, "span", "week-thread-meta muted", meta.join(t("counts.separator"))));
    list.append(row);
  }
  return list;
}

export function createWeekPage(document, data) {
  const page = make(document, "div", "week-page");
  if (data.staffPick) {
    const pick = make(document, "section", "week-staff-pick");
    pick.setAttribute("aria-label", t("staffPick.label"));
    pick.append(createStaffPickTile(document, data.staffPick));
    page.append(pick);
  }
  page.append(make(document, "h3", "week-section-title", t("week.threadsTitle")));
  page.append(createWeekThreads(document, Array.isArray(data.threads) ? data.threads : []));
  page.append(make(document, "h3", "week-section-title", t("week.showcaseTitle")));
  const showcase = Array.isArray(data.showcase) ? data.showcase : [];
  page.append(showcase.length
    ? createShowcaseGallery(document, showcase)
    : make(document, "p", "empty-state", t("week.showcaseEmpty")));
  return page;
}

export function createWeekLink(document) {
  const wrap = make(document, "p", "week-home-link");
  wrap.append(appLink(document, "week-link", "/week", t("week.homeLink")));
  return wrap;
}

export function createNewestMembers(document, members) {
  if (!Array.isArray(members) || !members.length) return null;
  const panel = make(document, "section", "newest-members");
  panel.append(make(document, "h3", "newest-members-title", t("newestMembers.title")));
  const list = make(document, "ul", "newest-members-list");
  for (const member of members) {
    const row = make(document, "li", "newest-member");
    const link = appLink(document, "newest-member-link", "/users/" + encodeURIComponent(member.username), "");
    if (member.avatarUrl) {
      const avatar = make(document, "img", "avatar newest-member-avatar");
      avatar.src = member.avatarUrl;
      avatar.alt = "";
      link.append(avatar);
    }
    link.append(make(document, "span", "newest-member-name", member.username));
    row.append(link);
    list.append(row);
  }
  panel.append(list);
  return panel;
}
