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

// Regulars on this page (wave 5.7 F2): on a category page, up to three
// members who started two or more of the topics already loaded, most topics
// first (ties by name), as links to their profiles. Derived only from the
// feed payload on screen — the server's visibility law already dropped
// hidden, banned and blocked authors — so no query, storage or network.
// Usernames go in via textContent only. DOM-pure: the caller passes the
// document.
import { t } from "./i18n.js";

export const REGULAR_MIN_TOPICS = 2;
export const REGULARS_MAX = 3;

export function pickRegulars(posts) {
  if (!Array.isArray(posts)) return [];
  const byAuthor = new Map();
  for (const post of posts) {
    const id = post?.author?.id;
    const username = post?.author?.username;
    if (!Number.isSafeInteger(id) || typeof username !== "string" || username === "") continue;
    const seen = byAuthor.get(id);
    byAuthor.set(id, seen ? { ...seen, count: seen.count + 1 } : { id, username, count: 1 });
  }
  return [...byAuthor.values()]
    .filter((regular) => regular.count >= REGULAR_MIN_TOPICS)
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username))
    .slice(0, REGULARS_MAX);
}

export function createBoardRegulars(doc, posts) {
  const regulars = pickRegulars(posts);
  if (!regulars.length) return null;
  const line = doc.createElement("p");
  line.className = "muted board-regulars";
  line.append(doc.createTextNode(t("feed.regularsHere") + " "));
  regulars.forEach((regular, index) => {
    if (index > 0) line.append(doc.createTextNode(t("counts.separator")));
    const link = doc.createElement("a");
    link.className = "board-regular";
    link.setAttribute("href", "/users/" + encodeURIComponent(regular.username));
    link.setAttribute("data-app-link", "");
    link.textContent = regular.username;
    line.append(link);
  });
  return line;
}
