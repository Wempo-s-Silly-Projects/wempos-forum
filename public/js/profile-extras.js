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

// Wave 2026-11-21-13: two profile delights. "Member since" formats the
// account's join date in the reader's own language (Intl, no strings to
// translate beyond the label). Recent threads lists a member's newest public
// threads as plain links; excerpts mask spoilers BEFORE they are cut, so a
// spoiler can never leak through a truncated, unclosed "||". DOM-pure: the
// caller passes the document and does the fetch.
import { DEFAULT_LOCALE, t } from "./i18n.js";
import { maskSpoilers } from "./markdown.js";

export const THREAD_EXCERPT_MAX = 120;
const ELLIPSIS = "…";

const safeLocale = (locale) => {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
};

export function formatJoinedDate(iso, locale = DEFAULT_LOCALE) {
  if (iso === null || iso === undefined || iso === "") return "";
  const when = new Date(iso);
  if (!Number.isFinite(when.getTime())) return "";
  return new Intl.DateTimeFormat(safeLocale(locale), { year: "numeric", month: "long", day: "numeric" })
    .format(when);
}

export function threadExcerpt(body) {
  const flat = maskSpoilers(body).replace(/\s+/g, " ").trim();
  return flat.length > THREAD_EXCERPT_MAX ? flat.slice(0, THREAD_EXCERPT_MAX) + ELLIPSIS : flat;
}

export function createRecentThreads(document, threads, locale = DEFAULT_LOCALE) {
  const list = document.createElement("ul");
  list.className = "recent-threads";
  if (!threads.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = t("profile.threadsEmpty");
    list.append(empty);
    return list;
  }
  for (const thread of threads) {
    const item = document.createElement("li");
    item.className = "recent-thread";
    const link = document.createElement("a");
    link.className = "recent-thread-link";
    link.href = "/posts/" + Number(thread.id);
    link.setAttribute("data-app-link", "");
    link.textContent = threadExcerpt(thread.body) || t("profile.threadUntitled");
    const when = document.createElement("time");
    when.className = "recent-thread-time";
    when.dateTime = thread.createdAt;
    when.textContent = formatJoinedDate(thread.createdAt, locale);
    item.append(link, when);
    list.append(item);
  }
  return list;
}
