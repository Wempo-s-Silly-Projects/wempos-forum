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

// Chat widget DM thread list (wave 2026-11-21-5 split): the one-probe list
// read, the launcher badge and unread refresh, the list rows (1:1 and group),
// and the New-chat strip above them.
import { api } from "./api.js";
import { createIcon } from "./icons.js";
import { t } from "./i18n.js";
import { readPins, sortPinnedFirst } from "./chat-pins.js";
import { isMuted, readMutes, unmutedUnreadTotal } from "./chat-mutes.js";
import { state } from "./state.js";
import { FILTER_QUERY_MAX, filterConversations, onlyUnread } from "./chat-filter.js";
import { groupTitle, imageIdOf } from "./dm-extras.js";
import { buildAvatar, conversationKey, el, kindOf, ui } from "./chat-widget-state.js";
import { GIF_PREVIEW_LABEL, gifIdOf } from "./chat-widget-gifs.js";
import { openThread } from "./chat-widget-composer.js";
import { openChatThread, relativeTime } from "./chat-widget.js";

const MESSAGE_PREVIEW_MAX = 60;

let newChatInFlight = false;
let olderGroupsInFlight = false;

export const loadThreads = async () => {
  const data = await api("/api/dm/threads");
  return {
    threads: Array.isArray(data?.threads) ? data.threads : [],
    groups: Array.isArray(data?.groups) ? data.groups.map((group) => ({ ...group, kind: "group" })) : [],
    groupsCursor: typeof data?.groupsCursor === "string" ? data.groupsCursor : null,
    // v4.11: the server's whole unread total (every page); null on an older
    // server, where the badge falls back to summing the loaded rows.
    dmUnread: Number.isFinite(Number(data?.dmUnread)) && data?.dmUnread != null ? Number(data.dmUnread) : null,
  };
};

// Fresh first-page rows win; older pages already loaded stay listed after them.
const mergeOlderGroups = (firstPage) => [
  ...firstPage,
  ...ui.olderGroups.filter((older) => !firstPage.some((group) => group.id === older.id)),
];

export const applyConversations = (data) => {
  ui.threads = data.threads;
  ui.groups = mergeOlderGroups(data.groups);
  ui.groupsCursor = data.groupsCursor ?? null;
  ui.dmUnread = data.dmUnread ?? null;
};

// A group the viewer can no longer read (removed, or the group is gone — the
// server's one 404) drops out of BOTH cached pages, so a stale older-page row
// never lingers after the 5s first-page refresh.
export const dropGroup = (groupId) => {
  const gone = (group) => Number(group.id) === Number(groupId);
  ui.groups = ui.groups.filter((group) => !gone(group));
  ui.olderGroups = ui.olderGroups.filter((group) => !gone(group));
};

// The next group page: after the last older page loaded, else after page one.
const nextGroupsCursor = () => (ui.olderGroups.length ? ui.olderGroupsCursor : ui.groupsCursor);

const loadOlderGroups = async () => {
  const cursor = nextGroupsCursor();
  if (!cursor || olderGroupsInFlight) return;
  olderGroupsInFlight = true;
  try {
    const data = await api("/api/dm/threads?before=" + encodeURIComponent(cursor));
    const page = Array.isArray(data?.groups) ? data.groups.map((group) => ({ ...group, kind: "group" })) : [];
    ui.olderGroups = [...ui.olderGroups, ...page.filter((group) => !ui.olderGroups.some((older) => older.id === group.id))];
    ui.olderGroupsCursor = typeof data?.groupsCursor === "string" ? data.groupsCursor : null;
    ui.groups = mergeOlderGroups(ui.groups.filter((group) => !ui.olderGroups.some((older) => older.id === group.id)));
    paintThreadList();
  } catch (error) {
    showNewChatError(error?.message || t("chat.chatFailed"));
  } finally {
    olderGroupsInFlight = false;
  }
};

export const refreshUnread = async () => {
  applyConversations(await loadThreads());
  paintBadge();
  if (ui.open && !ui.activeThread) paintThreadList();
};

// The account the per-member lists (mutes) are keyed on: the panel's own
// probe once opened, else the app's signed-in user — the badge paints while
// the panel is still closed.
const accountId = () => ui.widgetUser?.id ?? state.currentUser?.id ?? null;

// v4.31: muted chats (local, per account) stop counting toward the badge.
export const paintBadge = () => {
  if (!ui.badge) return;
  const total = unmutedUnreadTotal({
    serverTotal: ui.dmUnread,
    rows: [...ui.threads, ...ui.groups],
    mutes: readMutes(undefined, accountId()),
    keyOf: conversationKey,
  });
  ui.badge.textContent = String(total);
  ui.badge.hidden = total === 0;
};

export const paintThreadList = () => {
  if (!ui.threadListEl) return;
  ui.threadListEl.replaceChildren();
  // Pinned chats (v4.10, local-only) float above the activity order.
  const pins = readPins(undefined, ui.widgetUser?.id);
  const mutes = readMutes(undefined, accountId());
  const allRows = [...ui.threads, ...ui.groups];
  if (allRows.length === 0) {
    ui.threadListEl.append(el("p", "chat-widget-empty", t("chat.noChats")));
    return;
  }
  // The quick filter (v4.11) narrows the rows by name, and "Unread only"
  // (v4.32) by unread; both local-only, no request.
  const rows = sortPinnedFirst(onlyUnread(filterConversations(allRows, ui.listFilter, rowLabel), ui.listUnreadOnly)
    .sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || ""))), pins, conversationKey);
  const emptyLine = ui.listUnreadOnly ? t("chat.noUnreadChats") : t("chat.noFilterMatch");
  if (rows.length === 0) ui.threadListEl.append(el("p", "chat-widget-empty", emptyLine));
  // Screen readers hear an emptied filter through the status beside the input.
  if (ui.filterStatusEl) ui.filterStatusEl.textContent = rows.length === 0 ? emptyLine : "";
  for (const thread of rows) {
    const row = el("button", "chat-widget-thread");
    row.type = "button";
    const label = rowLabel(thread);
    const name = el("span", "chat-widget-thread-name", label);
    if (thread.unread > 0) name.classList.add("has-unread");
    if (pins.includes(conversationKey(thread))) {
      row.classList.add("is-pinned");
      const mark = el("span", "chat-widget-thread-pin");
      mark.append(createIcon(document, "pin"), el("span", "visually-hidden", t("dm.pinnedLabel")));
      name.append(mark);
    }
    if (isMuted(mutes, conversationKey(thread))) {
      row.classList.add("is-muted");
      name.append(el("span", "chat-widget-thread-muted", t("dm.mutedLabel")));
    }
    const preview = el("span", "chat-widget-thread-preview", previewOf(thread));
    const time = el("span", "chat-widget-thread-time", thread.lastMessageAt ? relativeTime(thread.lastMessageAt) : "");
    time.title = thread.lastMessageAt || "";
    const avatar = buildAvatar(kindOf(thread) === "group" ? { username: label } : thread.other);
    if (kindOf(thread) === "group") avatar.classList.add("is-group");
    row.append(avatar, name, preview, time);
    row.addEventListener("click", () => openThread(thread).catch(() => { /* the row stays clickable */ }));
    ui.threadListEl.append(row);
  }
  if (nextGroupsCursor()) {
    const older = el("button", "chat-widget-older chat-widget-older-groups", t("dm.olderGroups"));
    older.type = "button";
    older.addEventListener("click", () => { loadOlderGroups(); });
    ui.threadListEl.append(older);
  }
};

// The name a list row shows (and the quick filter matches).
const rowLabel = (thread) => (kindOf(thread) === "group"
  ? groupTitle(thread, ui.widgetUser?.id)
  : thread.other?.username || "unknown");

// The quick filter box: mounted once per open OUTSIDE the rows container (the
// 5s repaint would otherwise wipe what is typed); each keystroke repaints.
export const buildListFilter = () => {
  const input = el("input", "chat-widget-filter");
  input.type = "search";
  input.maxLength = FILTER_QUERY_MAX;
  input.placeholder = t("chat.filterChats");
  input.setAttribute("aria-label", t("chat.filterChats"));
  input.setAttribute("autocomplete", "off");
  input.value = ui.listFilter;
  input.addEventListener("input", () => {
    ui.listFilter = input.value;
    paintThreadList();
  });
  // A polite status mounted empty beside the input (outside the repainted
  // rows) so "No chats match" is announced, not just painted.
  const wrap = el("div", "chat-widget-filter-wrap");
  ui.filterStatusEl = el("span", "visually-hidden");
  ui.filterStatusEl.setAttribute("role", "status");
  wrap.append(input, buildUnreadOnlyToggle(), ui.filterStatusEl);
  return wrap;
};

// "Unread only" (v4.32): a labelled checkbox beside the filter box; it lives
// outside the repainted rows, so the 5s refresh keeps its state.
const buildUnreadOnlyToggle = () => {
  const label = el("label", "chat-widget-unread-only");
  const box = el("input");
  box.type = "checkbox";
  box.checked = ui.listUnreadOnly;
  box.addEventListener("change", () => {
    ui.listUnreadOnly = box.checked;
    paintThreadList();
  });
  label.append(box, el("span", "", t("chat.unreadOnly")));
  return label;
};

const previewOf = (thread) => {
  const raw = typeof thread.lastMessagePreview === "string" ? thread.lastMessagePreview : "";
  const preview = gifIdOf(raw) ? GIF_PREVIEW_LABEL : imageIdOf(raw) ? t("dm.imagePreview") : raw;
  if (thread.unread > 0) return preview;
  const clipped = preview.length > MESSAGE_PREVIEW_MAX
    ? `${preview.slice(0, MESSAGE_PREVIEW_MAX - 1)}…` : preview;
  return clipped || t("chat.noMessages");
};

// The New-chat affordance: a compact strip above the thread rows (a username
// input + one submit button). It lives OUTSIDE the rows container —
// paintThreadList's replaceChildren would otherwise wipe a half-typed
// username on every 5s poll repaint — so it mounts once per open and only
// paints its refusal line into the list.
export const buildNewChatForm = () => {
  const form = el("form", "chat-widget-new");
  const input = el("input", "chat-widget-new-input");
  input.type = "text";
  input.name = "username";
  input.placeholder = t("chat.newChatPlaceholder");
  input.setAttribute("aria-label", t("chat.newChatUsername"));
  input.setAttribute("autocomplete", "off");
  const newChatButton = el("button", "button button-primary chat-widget-new-send", t("chat.newChat"));
  newChatButton.type = "submit";
  form.append(input, newChatButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    createThreadByUsername(input.value);
  });
  return form;
};

const createThreadByUsername = async (rawUsername) => {
  const username = rawUsername.trim();
  if (!username || newChatInFlight) return;
  const newChatButton = ui.newChatFormEl?.querySelector(".chat-widget-new-send");
  newChatInFlight = true;
  if (newChatButton) newChatButton.disabled = true;
  try {
    const data = await api("/api/dm/threads", { method: "POST", body: { username } });
    if (data?.id == null) throw new Error(t("chat.chatFailed"));
    if (ui.newChatFormEl) ui.newChatFormEl.querySelector(".chat-widget-new-input").value = "";
    // The door re-reads the list first, so the new row is on it before the
    // conversation opens.
    await openChatThread(data.id);
  } catch (error) {
    showNewChatError(error?.message || t("chat.chatFailed"));
  } finally {
    newChatInFlight = false;
    if (newChatButton) newChatButton.disabled = false;
  }
};

// The refusal rides the send-error slot idiom: one textContent-only line
// appended at the list's tail; a second failure rewrites it, and the next
// repaint wipes it.
export const showNewChatError = (message) => {
  if (!ui.threadListEl) return;
  const existing = ui.threadListEl.querySelector(".chat-widget-new-error");
  if (existing) {
    existing.textContent = message;
    return;
  }
  ui.threadListEl.append(el("p", "chat-widget-new-error", message));
};
