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

// Thread outline (v5.46.0 F2): on a thread with OUTLINE_MIN_REPLIES or more
// replies, a collapsible "Jump to" list — one entry per reply, in page order,
// with its author and a relative time. An entry scrolls to and focuses its
// reply and marks itself aria-current. Client only: built from the replies
// already on the page, and only those the page actually rendered (a reply
// with no card is never listed), so it can't surface anything the server or
// the renderer held back. Open/closed is remembered per account
// (`forum-thread-outline:u<id>`, wiped on sign-out by wipeAccountLocalData);
// guests and blocked storage get a page-view-only toggle, collapsed by
// default. createElement/textContent only.
import { jumpToNode } from "./focus-utils.js";
import { currentLocale, t } from "./i18n.js";
import { formatRelative } from "./reltime.js";

export const OUTLINE_MIN_REPLIES = 8;
export const OUTLINE_STORAGE_KEY = "forum-thread-outline";
const OPEN_VALUE = "open";
const LIST_ID = "thread-outline-list";

export const outlineKey = (accountId = null) => (accountId ? OUTLINE_STORAGE_KEY + ":u" + accountId : null);

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readOutlineOpen(storage = browserStorage(), accountId = null) {
  try {
    const key = outlineKey(accountId);
    return Boolean(storage && key) && storage.getItem(key) === OPEN_VALUE;
  } catch {
    return false;
  }
}

export function writeOutlineOpen(storage = browserStorage(), accountId = null, open = false) {
  const key = outlineKey(accountId);
  if (!key) return;
  try {
    if (open) storage?.setItem(key, OPEN_VALUE);
    else storage?.removeItem(key);
  } catch {
    // Quota or blocked storage: the choice lasts for this page view only.
  }
}

// Sign-out wipe: every account's outline state goes.
export function clearAllThreadOutline(storage = browserStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(OUTLINE_STORAGE_KEY + ":u")) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

// The replies that have a rendered card in `replyList`, in payload (page)
// order. One pass over the cards, then one over the replies.
export function outlineEntries(replies, replyList) {
  const list = Array.isArray(replies) ? replies : [];
  const rendered = new Set();
  replyList?.querySelectorAll?.("[data-post-id]")?.forEach((card) => {
    rendered.add(String(card.getAttribute("data-post-id")));
  });
  return list
    .filter((reply) => reply && rendered.has(String(reply.id)))
    .map((reply) => ({
      id: Number(reply.id),
      name: typeof reply.author?.username === "string" && reply.author.username ? reply.author.username : null,
      createdAt: typeof reply.createdAt === "string" ? reply.createdAt : "",
    }));
}

function createEntry(document, entry, now) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet thread-outline-entry";
  button.dataset.replyId = String(entry.id);
  const author = document.createElement("span");
  author.className = "thread-outline-author";
  author.textContent = entry.name ?? t("glance.aMember");
  const time = document.createElement("time");
  time.className = "thread-outline-time";
  time.setAttribute("datetime", entry.createdAt);
  time.textContent = formatRelative(entry.createdAt, { now, locale: currentLocale() }) || "";
  button.append(author, document.createTextNode(" "), time);
  return button;
}

function setOpen(toggle, list, open) {
  toggle.setAttribute("aria-expanded", String(open));
  if (open) list.removeAttribute("hidden");
  else list.setAttribute("hidden", "");
}

// The outline, or null below the threshold. The target card is looked up at
// click time, so a card removed from the page later is a quiet no-op.
export function createThreadOutline(document, replies, replyList, {
  accountId = null, storage = browserStorage(), now = Date.now(),
} = {}) {
  const entries = outlineEntries(replies, replyList);
  if (entries.length < OUTLINE_MIN_REPLIES) return null;
  const nav = document.createElement("nav");
  nav.className = "thread-outline";
  nav.setAttribute("aria-label", t("outline.label"));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "button button-quiet thread-outline-toggle";
  toggle.textContent = t("outline.toggle");
  toggle.setAttribute("aria-controls", LIST_ID);
  const list = document.createElement("ol");
  list.className = "thread-outline-list";
  list.id = LIST_ID;
  const buttons = [];
  for (const entry of entries) {
    const item = document.createElement("li");
    const button = createEntry(document, entry, now);
    button.addEventListener("click", () => {
      const card = replyList?.querySelector?.('[data-post-id="' + entry.id + '"]');
      if (!card) return;
      for (const other of buttons) other.removeAttribute("aria-current");
      button.setAttribute("aria-current", "true");
      jumpToNode(card, { block: "start" });
    });
    buttons.push(button);
    item.append(button);
    list.append(item);
  }
  setOpen(toggle, list, readOutlineOpen(storage, accountId));
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    setOpen(toggle, list, open);
    writeOutlineOpen(storage, accountId, open);
  });
  nav.append(toggle, list);
  return nav;
}
