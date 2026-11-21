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

// Notification bell and the /notifications page (spec §12). Items are built
// with notificationItemView; clicking one marks it read and navigates to the
// target thread (handled by app.js's data-action="open-notification"). All DOM
// building is textContent-based.
import { addText } from "./forms.js";
import { t, tn } from "./i18n.js";
import { maskSpoilers } from "./markdown.js";

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
    // The server-stored label wins (mentions: "You were mentioned by X");
    // every other (or pre-0017) row keeps the generic reply copy.
    label: item.label
      ? String(item.label)
      : (preview ? t("bell.newReplyPreview", { preview }) : t("bell.newReply")),
  };
};

// Header bell: shown for signed-in users only (renderAccountNavigation decides
// whether to append it). The unread badge is hidden when the count is zero but
// stays in the DOM so updateBell() can reveal it later without a rebuild.
import { createIcon } from "./icons.js";

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
  for (const group of groups) {
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

function notificationRow(document, item) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "notification-item" + (item.read ? "" : " notification-unread");
  row.dataset.action = "open-notification";
  row.dataset.notificationId = String(item.id);
  // Post-less items carry no postId — the click marks read without navigating.
  if (item.targetPostId) row.dataset.postId = String(item.targetPostId);
  row.textContent = item.label;
  if (item.read) row.setAttribute("aria-disabled", "false");
  else row.setAttribute("aria-current", "true");
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
  row.textContent = preview
    ? tn("bell.threadGroupPreview", group.count, { preview })
    : tn("bell.threadGroup", group.count);
  if (group.read) row.setAttribute("aria-disabled", "false");
  else row.setAttribute("aria-current", "true");
  return row;
}
