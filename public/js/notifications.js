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

// Notification bell and the /notifications page (spec §12). Items are built
// with notificationItemView; clicking one marks it read and navigates to the
// target thread (handled by app.js's data-action="open-notification"). All DOM
// building is textContent-based.
import { addText } from "./forms.js";
import { currentLocale, t, tn } from "./i18n.js";
import { maskSpoilers } from "./markdown.js";
import { createUnreadOnlyToggle } from "./notification-filter.js";
import { createDayHeading, notificationDayKey } from "./notification-days.js";
import { formatRelative } from "./reltime.js";

const SPOILER_MARK = "||";

// v4.21: previews pass through maskSpoilers (the v4.20 law). The server cuts
// bodies at 80 chars, which can leave a spoiler's opener without its closer
// ("the twist: ||he di") — maskSpoilers cannot pair that, so anything from a
// leftover "||" on is dropped behind an ellipsis.
export const notificationPreview = (raw) => {
  const masked = maskSpoilers(String(raw ?? ""));
  const open = masked.indexOf(SPOILER_MARK);
  if (open === -1) return masked;
  return masked.slice(0, open).trim() + "\u2026";
};

// v4.21: label-less reply notifications that share a thread fold into one
// row, sitting where the newest of them sat. Labelled rows (mentions, appeal
// outcomes, chat pings) and post-less rows stay their own items. Pure.
export const groupNotifications = (items) => {
  const groups = [];
  const byThread = new Map();
  for (const entry of items ?? []) {
    const target = Number(entry?.targetPostId);
    const groupable = !entry?.label && target > 0;
    const existing = groupable ? byThread.get(target) : null;
    if (existing) {
      existing.ids.push(Number(entry.id));
      existing.count += 1;
      existing.read = existing.read && Boolean(entry.read);
      continue;
    }
    const group = {
      ids: [Number(entry?.id)],
      count: 1,
      read: Boolean(entry?.read),
      targetPostId: target > 0 ? target : null,
      preview: String(entry?.postPreview ?? ""),
      first: entry,
    };
    if (groupable) byThread.set(target, group);
    groups.push(group);
  }
  return groups;
};

// v5.39.0: a followed member's new thread is stored as "New thread from <name>"
// (api/follows.mjs) and painted in the viewer's language.
const FOLLOW_THREAD_PREFIX = "New thread from ";
const followThreadLabel = (label) => label.startsWith(FOLLOW_THREAD_PREFIX)
  ? t("bell.followThread", { username: label.slice(FOLLOW_THREAD_PREFIX.length) })
  : label;

// Pure, DOM-free. Returns { id, targetPostId, read, href, label }. The payload
// never includes the replier's identity, so the label stays generic.
export const notificationItemView = (item) => {
  const preview = notificationPreview(item?.postPreview);
  const rawTarget = Number(item?.targetPostId);
  // NULL = a label-only notification (appeal outcome, chat ping): nothing to
  // navigate to — clicking just marks it read.
  const targetPostId = rawTarget > 0 ? rawTarget : null;
  return {
    id: Number(item?.id),
    targetPostId,
    read: Boolean(item?.read),
    href: targetPostId ? `/posts/${targetPostId}` : null,
    createdAt: typeof item?.createdAt === "string" ? item.createdAt : null,
    // The server-stored label wins (mentions: "You were mentioned by X");
    // every other (or pre-0017) row keeps the generic reply copy.
    label: item.label
      ? followThreadLabel(String(item.label))
      : (preview ? t("bell.newReplyPreview", { preview }) : t("bell.newReply")),
  };
};

// Header bell: shown for signed-in users only (renderAccountNavigation decides
// whether to append it). The unread badge is hidden when the count is zero but
// stays in the DOM so updateBell() can reveal it later without a rebuild.
import { createIcon } from "./icons.js";
import { applyTabUnread, pageStorage } from "./tab-unread.js";
import { EVENTS, bus } from "./event-bus.js";

export const createNotificationBell = (unreadCount, document) => {
  const bell = document.createElement("a");
  bell.id = "notification-bell";
  // icon-button is required: the shared icon sizing/stroke CSS scopes to it.
  bell.className = "button button-secondary notification-bell icon-button";
  bell.href = "/notifications";
  const count = Number(unreadCount) || 0;
  bell.setAttribute("aria-label",
    count ? t("bell.labelUnread", { count }) : t("bell.label"));
  bell.append(createIcon(document, "bell"));
  // The unread indicator is a tiny red (coral) DOT — the count lives in the
  // bell's aria-label, not in a number pill (owner spec, v2.5).
  const badge = document.createElement("span");
  badge.className = "notification-badge";
  badge.dataset.notificationCount = "true";
  badge.textContent = "";
  badge.hidden = count === 0;
  bell.append(badge);
  return bell;
};

// Refresh the badge in the already-rendered header. A no-op when the bell is
// not in the DOM (guests, or a page rendered before the header existed).
export function updateBell(unreadCount) {
  const badge = document.querySelector("#notification-bell [data-notification-count]");
  if (!badge) return;
  const count = Number(unreadCount) || 0;
  badge.textContent = ""; // a dot, not a number — the count lives in aria-label
  badge.hidden = count === 0;
  applyTabUnread(document, count, pageStorage()); // opt-in tab-title count (v5.3)
  bus.emit(EVENTS.unread, "notifications", count); // favicon badge + other tabs (batch K bus)
  const bell = document.querySelector("#notification-bell");
  if (bell) {
    bell.setAttribute("aria-label",
      count ? t("bell.labelUnread", { count }) : t("bell.label"));
  }
}

// Notifications page: heading, "Mark all read" (data-form handled through the
// button's data-action in app.js), and the newest items as buttons. Rows carry
// data-notification-id and their target post id; unread rows add the
// notification-unread class so styles can highlight them.
export function renderNotificationsPage(main, items) {
  const document = main.ownerDocument;
  const section = document.createElement("section");
  section.className = "panel notifications-panel";
  const heading = document.createElement("h1");
  heading.className = "page-heading";
  heading.textContent = t("bell.label");
  section.append(heading);
  const groups = groupNotifications(items);
  if (!groups.length) {
    addText(document, section, "p",
      t("bell.empty"), "empty-state");
    main.append(section);
    return section;
  }
  // v4.42: "Unread only" hides read rows in place (page-view only).
  section.append(createUnreadOnlyToggle(document, section));
  // v4.44: Today / Yesterday / Earlier headings (notification-days.js); a
  // group files under its newest reply, and an undated row opens none.
  const now = Date.now();
  let lastDay = null;
  for (const group of groups) {
    const day = notificationDayKey(notificationItemView(group.first).createdAt, now);
    if (day && day !== lastDay) {
      section.append(createDayHeading(document, day));
      lastDay = day;
    }
    section.append(group.count > 1
      ? threadGroupRow(document, group)
      : notificationRow(document, notificationItemView(group.first)));
  }
  const markAll = document.createElement("button");
  markAll.type = "button";
  markAll.className = "button button-secondary";
  markAll.dataset.action = "mark-notifications-read";
  markAll.textContent = t("bell.markAllRead");
  section.append(markAll);
  main.append(section);
  return section;
}

// Wave 22 a11y: unread used to ride aria-current="true", which screen readers
// announce as "current", not "unread". The state is now spoken as a
// visually-hidden "Unread" word at the start of the row's name (the bold +
// border styling stays for sighted readers).
function markUnread(document, row) {
  const tag = document.createElement("span");
  tag.className = "visually-hidden";
  tag.textContent = t("bell.unreadTag") + " ";
  row.prepend(tag);
}

// v4.43: when the notification arrived ("5 min. ago"), as a <time> stamp at
// the end of the row. Intl.RelativeTimeFormat localizes it, so there is no
// new string; runtimes without it get the locale's date and time. No stamp
// when the time is missing or does not parse.
function addTimeStamp(document, row, createdAt) {
  if (!createdAt || !Number.isFinite(new Date(createdAt).getTime())) return;
  const locale = currentLocale();
  const stamp = document.createElement("time");
  stamp.className = "notification-time";
  stamp.setAttribute("datetime", createdAt);
  stamp.textContent = formatRelative(createdAt, { locale }) || new Date(createdAt).toLocaleString(locale);
  row.append(" ", stamp);
}

function notificationRow(document, item) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "notification-item" + (item.read ? "" : " notification-unread");
  row.dataset.action = "open-notification";
  row.dataset.notificationId = String(item.id);
  // Post-less items carry no postId — the click marks read without navigating.
  if (item.targetPostId) row.dataset.postId = String(item.targetPostId);
  row.append(document.createTextNode(item.label));
  if (item.read) row.setAttribute("aria-disabled", "false");
  else markUnread(document, row);
  addTimeStamp(document, row, item.createdAt);
  return row;
}

// One row for several replies in one thread: the click marks the whole
// thread's reply notifications read (POST read-thread) and opens the thread.
function threadGroupRow(document, group) {
  const preview = notificationPreview(group.preview);
  const row = document.createElement("button");
  row.type = "button";
  row.className = "notification-item notification-group" + (group.read ? "" : " notification-unread");
  row.dataset.action = "open-notification-thread";
  row.dataset.postId = String(group.targetPostId);
  row.append(document.createTextNode(preview
    ? tn("bell.threadGroupPreview", group.count, { preview })
    : tn("bell.threadGroup", group.count)));
  if (group.read) row.setAttribute("aria-disabled", "false");
  else markUnread(document, row);
  // Rows arrive newest first, so the group's first entry is its newest.
  addTimeStamp(document, row, notificationItemView(group.first).createdAt);
  return row;
}
