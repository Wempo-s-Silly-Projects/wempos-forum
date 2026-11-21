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

// Chat widget: the floating launcher in the bottom-right corner and the panel
// that expands above it. The widget is its own little client — it rides the
// shared api() wrapper (fetch only), it mounts itself on import, and it stays
// INERT for signed-out visitors: the single boot probe GET /api/dm/threads
// decides everything (a 401/404/503 leaves no DOM and no polling behind).
// The panel carries the two-tab interior: the old /chat page's Lobby stream
// (the retired endpoint shapes, the .chat-message class family, the 15s poll
// rhythm) and the DMs rail (the shipped conversation + New-chat strip). The
// Lobby tab degrades to hidden until its own boot probe GET /api/chat
// succeeds — the original boot-probe law, one more door.
// Polling while the panel is open refreshes the thread list and the open
// conversation every 5s; while closed, an unread-counter refresh rides every
// 30s. Every timer sleeps while document.hidden — background tabs make no
// requests. Sends are single-flight: the in-flight flag and the disabled
// button both gate the action, so Enter and a double click can never queue
// two POSTs for one message (the 11-12 double-send defect, killed at the UI).
import { api } from "./api.js";
import { createIcon } from "./icons.js";
import { currentLocale, i18nReady, t, tn } from "./i18n.js";
import { isEmojiOnly } from "./dm-effects.js";
import { formatRelative } from "./reltime.js";
import {
  buildEffectsToggle, buildGroupManage, buildImageButton, buildNewGroupForm, conversationBase,
  effectsEnabled, fillImageBody, groupTitle, imageIdOf, uploadDmImage,
} from "./dm-extras.js";

const PANEL_POLL_MS = 5_000;
const UNREAD_POLL_MS = 30_000;
const LOBBY_POLL_MS = 15_000;
const PANEL_WIDTH_MAX = 360;
const MESSAGE_PREVIEW_MAX = 60;
const LOBBY_MESSAGE_MAX = 500;
// GIFs in chat: a message whose WHOLE body is `[gif:<library-id>]` renders as
// the library image — the same by-reference convention posts use (gifIds
// point at the approved library; no byte copies), served from the existing
// /api/gifs/:id route. Bodies stay plain text on the wire and in D1.
const GIF_ID_SHAPE = /^[0-9a-f-]{36}$/;
const GIF_TOKEN = /^\[gif:([0-9a-f-]{36})\]$/;
const GIF_PREVIEW_LABEL = "GIF";

let launcher = null;
let badge = null;
let panel = null;
let threadListEl = null;
let conversationEl = null;

let threads = [];
// v4.7 group DMs ride the same probe (GET /api/dm/threads → groups); a
// conversation is { kind: "dm" | "group", id } and kind defaults to "dm".
let groups = [];
let activeThread = null;
let conversation = null; // GET /api/dm/threads/:id result for activeThread
let open = false;
let sendInFlight = false;
let panelTimer = null;
let unreadTimer = null;
let composerEl = null;
let sendButton = null;
let newChatFormEl = null;
let newChatInFlight = false;
let listSideEl = null;

// The Lobby tab's state: the old chat module's cursors and guards, scoped to
// the widget. Session identity rides ONE /api/session probe per panel open —
// it decides the mine marker and the staff-only delete arm. The presence
// beacon stays with who-online.js; this module never sends it.
let lobbyEl = null;
let lobbyOnlineEl = null;
let lobbyOnline = 0;
let lobbyMessagesEl = null;
let lobbyAvailable = false;
let lobbyLog = [];
let lobbyLastId = 0;
let lobbyTimer = null;
let lobbyVersion = 0;
let lobbySendInFlight = false;
let widgetUser = null;
let activeTab = "dms";
// The GIF picker: the approved library list is read once per panel open; the
// DM picker survives the conversation's 5s full repaint (its nodes are
// re-attached, not rebuilt).
let gifLibrary = null;
let dmGifPicker = null;
// Message effects (opt-in): the switch's state, and the newest message id
// painted per conversation so only fresh arrivals pop.
let effectsOn = false;
let lastPainted = { key: null, maxId: 0 };

const kindOf = (conversation) => (conversation?.kind === "group" ? "group" : "dm");
const conversationKey = (conversation) => `${kindOf(conversation)}:${conversation?.id ?? ""}`;
const sameConversation = (a, b) => Boolean(a && b) && conversationKey(a) === conversationKey(b);

const isStaff = () => Boolean(widgetUser && (widgetUser.role === "owner" || widgetUser.role === "admin"));

// Locale-aware stamp (wave 2026-11-21-3); the keyed short forms below stay
// only for runtimes without Intl.RelativeTimeFormat.
const relativeTime = (iso) => {
  const localized = formatRelative(iso, { locale: currentLocale() });
  if (localized !== null) return localized;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return t("chat.timeNow");
  if (minutes < 60) return t("chat.timeMinutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("chat.timeHours", { count: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return t("chat.timeDays", { count: days });
  return t("chat.timeWeeks", { count: Math.round(days / 7) });
};

const el = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const gifIdOf = (body) => {
  const match = typeof body === "string" ? body.trim().match(GIF_TOKEN) : null;
  return match ? match[1] : null;
};

const gifToken = (gifId) => `[gif:${gifId}]`;

// A message body node: a GIF token becomes a lazy <img> from the library's
// serving route; anything else (and a token whose image 404s — unknown or
// unapproved ids) stays plain text. createElement/textContent only.
const messageBodyNode = (className, body, { dm = false, authorName = "" } = {}) => {
  const node = el("p", className);
  const imageId = dm ? imageIdOf(body) : null;
  if (imageId) return fillImageBody(node, imageId, authorName);
  const gifId = gifIdOf(body);
  if (!gifId) {
    if (body !== undefined) node.textContent = body;
    if (dm && effectsOn && isEmojiOnly(body)) node.classList.add("chat-emoji-jumbo");
    return node;
  }
  node.classList.add("chat-gif-body");
  const img = el("img", "chat-gif");
  img.src = "/api/gifs/" + encodeURIComponent(gifId);
  img.alt = "GIF";
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => {
    node.classList.remove("chat-gif-body");
    node.replaceChildren();
    node.textContent = body;
  }, { once: true });
  node.append(img);
  return node;
};

// The approved library (GET /api/gifs, the post composer picker's own list),
// cached for the panel's lifetime; ids are shape-checked before use.
const loadGifLibrary = async () => {
  if (gifLibrary) return gifLibrary;
  const data = await api("/api/gifs");
  const rows = Array.isArray(data?.gifs) ? data.gifs : [];
  gifLibrary = rows.filter((gif) => typeof gif?.id === "string" && GIF_ID_SHAPE.test(gif.id));
  return gifLibrary;
};

// The GIF button + its grid. The caller seats the toggle beside its Send
// button and the grid inside its composer (CSS floats it above). Picking a
// GIF closes the grid and hands the id to onPick.
const buildGifPicker = (onPick) => {
  const toggle = el("button", "chat-widget-gif-button", "GIF");
  toggle.type = "button";
  toggle.setAttribute("aria-label", t("chat.sendGif"));
  toggle.setAttribute("aria-expanded", "false");
  const grid = el("div", "chat-widget-gif-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", t("chat.gifLibrary"));
  grid.hidden = true;
  const closeGrid = () => {
    grid.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  const paintGrid = (gifs) => {
    grid.replaceChildren();
    if (gifs.length === 0) {
      grid.append(el("p", "chat-widget-gif-note", t("chat.gifsEmpty")));
      return;
    }
    for (const gif of gifs) {
      const pick = el("button", "chat-widget-gif-pick");
      pick.type = "button";
      pick.setAttribute("aria-label", t("chat.sendThisGif"));
      const img = el("img");
      img.src = typeof gif.url === "string" && gif.url.startsWith("/api/gifs/")
        ? gif.url : "/api/gifs/" + encodeURIComponent(gif.id);
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      pick.append(img);
      pick.addEventListener("click", () => {
        closeGrid();
        onPick(gif.id);
      });
      grid.append(pick);
    }
  };
  toggle.addEventListener("click", async () => {
    if (!grid.hidden) {
      closeGrid();
      return;
    }
    grid.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    grid.replaceChildren(el("p", "chat-widget-gif-note", t("chat.gifsLoading")));
    try {
      paintGrid(await loadGifLibrary());
    } catch {
      grid.replaceChildren(el("p", "chat-widget-gif-note", t("chat.gifsFailed")));
    }
  });
  grid.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeGrid();
    toggle.focus();
  });
  return { toggle, grid };
};

const loadThreads = async () => {
  const data = await api("/api/dm/threads");
  return {
    threads: Array.isArray(data?.threads) ? data.threads : [],
    groups: Array.isArray(data?.groups) ? data.groups.map((group) => ({ ...group, kind: "group" })) : [],
  };
};

const applyConversations = (data) => {
  threads = data.threads;
  groups = data.groups;
};

// The one boot decision: a successful thread read mounts the widget; every
// failure (signed-out 401, the endpoint still landing, a 503) leaves the
// module invisible — no launcher, no timers.
const boot = async () => {
  if (document.querySelector(".chat-widget-launcher")) return;
  try {
    applyConversations(await loadThreads());
  } catch {
    return;
  }
  await i18nReady();
  launcher = el("button", "chat-widget-launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-label", t("chat.title"));
  launcher.setAttribute("aria-expanded", "false");
  // The launcher rides the site's own icon system (the stroke "chat" icon,
  // currentColor) — not an emoji text node; the glyph span stays the seat.
  const glyph = el("span", "chat-widget-glyph");
  glyph.setAttribute("aria-hidden", "true");
  glyph.append(createIcon(document, "chat"));
  glyph.setAttribute("aria-hidden", "true");
  badge = el("span", "chat-widget-badge");
  badge.hidden = true;
  launcher.append(glyph, badge);
  launcher.addEventListener("click", togglePanel);
  document.body.append(launcher);
  // The Lobby tab's own boot probe rides the old /chat read: a success seeds
  // the stream (newest 50, oldest-first) and the online count; a failure
  // keeps the tab hidden — the degrade law, one more door past the widget's
  // signed-in gate above.
  try {
    const lobbyData = await api("/api/chat");
    lobbyAvailable = true;
    lobbyLog = Array.isArray(lobbyData?.messages) ? lobbyData.messages : [];
    lobbyLastId = Number(lobbyData?.lastId || 0);
  } catch {
    // The lobby lane is unshipped (or signed-out): the tab stays hidden.
    lobbyAvailable = false;
  }
  paintBadge();
  unreadTimer = setInterval(() => {
    if (document.hidden || open) return;
    refreshUnread().catch(() => { /* transient — the badge keeps its last value */ });
  }, UNREAD_POLL_MS);
};

const refreshUnread = async () => {
  applyConversations(await loadThreads());
  paintBadge();
  if (open && !activeThread) paintThreadList();
};

const paintBadge = () => {
  if (!badge) return;
  const total = [...threads, ...groups].reduce((sum, thread) => sum + (thread.unread || 0), 0);
  badge.textContent = String(total);
  badge.hidden = total === 0;
};

const togglePanel = () => {
  if (open) closePanel();
  else openPanel();
};

const openPanel = async () => {
  if (open) return;
  open = true;
  launcher.setAttribute("aria-expanded", "true");
  panel = el("div", "chat-widget-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("chat.title"));
  // The two-tab head: the Lobby stream and the DMs rail (the shipped
  // interior). The Lobby tab stays hidden until the stream is available.
  const head = el("div", "chat-widget-head");
  head.append(el("span", "chat-widget-title", t("chat.heading")));
  const tabs = el("div", "chat-widget-tabs");
  const lobbyTab = el("button", "chat-widget-tab", t("chat.tabLobby"));
  lobbyTab.type = "button";
  lobbyTab.dataset.widgetTab = "lobby";
  lobbyTab.setAttribute("aria-selected", "false");
  lobbyTab.hidden = true;
  lobbyTab.addEventListener("click", () => {
    showTab("lobby");
  });
  const dmsTab = el("button", "chat-widget-tab", t("chat.tabDms"));
  dmsTab.type = "button";
  dmsTab.dataset.widgetTab = "dms";
  dmsTab.setAttribute("aria-selected", "false");
  dmsTab.addEventListener("click", () => {
    showTab("dms");
  });
  tabs.append(lobbyTab, dmsTab);
  head.append(tabs);
  const close = el("button", "chat-widget-close");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", t("chat.closePanel"));
  close.addEventListener("click", closePanel);
  head.append(close);
  threadListEl = el("div", "chat-widget-threads");
  conversationEl = el("div", "chat-widget-conversation");
  conversationEl.hidden = true;
  // The New-chat affordance mounts once per open, OUTSIDE the rows container
  // paintThreadList replaces (see buildNewChatForm).
  listSideEl = el("div", "chat-widget-list");
  newChatFormEl = buildNewChatForm();
  const newGroupEl = buildNewGroupForm(
    (groupId) => openThread({ kind: "group", id: groupId }).then(() => refreshUnread()),
    showNewChatError,
  );
  effectsOn = effectsEnabled();
  const effectsEl = buildEffectsToggle((on) => {
    effectsOn = on;
    paintConversation();
  });
  listSideEl.append(newChatFormEl, newGroupEl, effectsEl, threadListEl);
  lobbyEl = buildLobby();
  panel.append(head, listSideEl, conversationEl, lobbyEl);
  document.body.append(panel);
  // Session identity (mine rows, the staff delete arm) rides one probe per
  // open; a failure just drops the perks, never the stream.
  widgetUser = await api("/api/session")
    .then((data) => (data?.user ? data.user : null))
    .catch(() => null);
  paintThreadList();
  panelTimer = setInterval(() => {
    if (document.hidden) return;
    const refresh = [refreshUnread().catch(() => { /* keep painted data */ })];
    if (activeThread) refresh.push(openThread(activeThread, { silent: true }));
    Promise.all(refresh).catch(() => { /* next tick retries */ });
  }, PANEL_POLL_MS);
  if (lobbyAvailable) {
    lobbyTab.hidden = false;
    lobbyTimer = setInterval(() => {
      if (document.hidden) return;
      pollLobbySafely();
    }, LOBBY_POLL_MS);
  }
  showTab(lobbyAvailable ? "lobby" : "dms");
  const data = await loadThreads().catch(() => null);
  if (data) {
    applyConversations(data);
    paintBadge();
    if (!activeThread) paintThreadList();
  }
};

const closePanel = () => {
  open = false;
  launcher.setAttribute("aria-expanded", "false");
  clearInterval(panelTimer);
  panelTimer = null;
  clearInterval(lobbyTimer);
  lobbyTimer = null;
  panel.remove();
  panel = null;
  threadListEl = null;
  conversationEl = null;
  newChatFormEl = null;
  listSideEl = null;
  lobbyEl = null;
  lobbyOnlineEl = null;
  lobbyMessagesEl = null;
  composerEl = null;
  sendButton = null;
  activeThread = null;
  conversation = null;
  gifLibrary = null;
  dmGifPicker = null;
  lastPainted = { key: null, maxId: 0 };
};

// The tab switcher: the Lobby stream and the DMs pair are mutually exclusive
// surfaces inside the panel; the DM rail's own inner state (list vs the open
// conversation) survives the round trip.
const showTab = (nextTab) => {
  if (nextTab !== "lobby" && nextTab !== "dms") return;
  if (nextTab === "lobby" && !lobbyAvailable) return;
  activeTab = nextTab;
  if (!panel) return;
  const showLobby = nextTab === "lobby";
  const lobbyTab = panel.querySelector('[data-widget-tab="lobby"]');
  const dmsTab = panel.querySelector('[data-widget-tab="dms"]');
  if (lobbyTab) lobbyTab.setAttribute("aria-selected", String(showLobby));
  if (dmsTab) dmsTab.setAttribute("aria-selected", String(!showLobby));
  if (lobbyEl) lobbyEl.hidden = !showLobby;
  if (listSideEl) listSideEl.hidden = showLobby || Boolean(activeThread);
  if (conversationEl) conversationEl.hidden = showLobby || !activeThread;
  if (showLobby) pollLobbySafely();
};

// DM polish: the initial-circle avatar the DM rail and the conversation's
// theirs rows ride. Role seats are colored from the forum's role-badge tokens
// when the payload carries one.
const buildAvatar = (other) => {
  const username = typeof other?.username === "string" ? other.username : "?";
  const circle = el("span", "chat-widget-avatar", username.charAt(0).toUpperCase() || "?");
  circle.setAttribute("aria-hidden", "true");
  if (other?.role === "owner" || other?.role === "admin") {
    circle.classList.add("role-badge-" + other.role);
  }
  return circle;
};

const paintThreadList = () => {
  if (!threadListEl) return;
  threadListEl.replaceChildren();
  const rows = [...threads, ...groups].sort((a, b) =>
    String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || "")));
  if (rows.length === 0) {
    threadListEl.append(el("p", "chat-widget-empty", t("chat.noChats")));
    return;
  }
  for (const thread of rows) {
    const row = el("button", "chat-widget-thread");
    row.type = "button";
    const label = kindOf(thread) === "group"
      ? groupTitle(thread, widgetUser?.id)
      : thread.other?.username || "unknown";
    const name = el("span", "chat-widget-thread-name", label);
    if (thread.unread > 0) name.classList.add("has-unread");
    const preview = el("span", "chat-widget-thread-preview", previewOf(thread));
    const time = el("span", "chat-widget-thread-time", thread.lastMessageAt ? relativeTime(thread.lastMessageAt) : "");
    time.title = thread.lastMessageAt || "";
    const avatar = buildAvatar(kindOf(thread) === "group" ? { username: label } : thread.other);
    if (kindOf(thread) === "group") avatar.classList.add("is-group");
    row.append(avatar, name, preview, time);
    row.addEventListener("click", () => openThread(thread).catch(() => { /* the row stays clickable */ }));
    threadListEl.append(row);
  }
};

const previewOf = (thread) => {
  const raw = typeof thread.lastMessagePreview === "string" ? thread.lastMessagePreview : "";
  const preview = gifIdOf(raw) ? GIF_PREVIEW_LABEL : imageIdOf(raw) ? t("dm.imagePreview") : raw;
  if (thread.unread > 0) return preview;
  const clipped = preview.length > MESSAGE_PREVIEW_MAX
    ? `${preview.slice(0, MESSAGE_PREVIEW_MAX - 1)}…` : preview;
  return clipped || t("chat.noMessages");
};

const openThread = async (thread, { silent = false } = {}) => {
  if (!silent) {
    activeThread = thread;
    conversation = null;
  }
  if (!sameConversation(activeThread, thread)) return;
  const data = await api(conversationBase(thread));
  if (!open || !sameConversation(activeThread, thread)) return;
  conversation = { ...data, kind: kindOf(thread) };
  if (data.unread > 0) {
    api(`${conversationBase(thread)}/read`, { method: "POST" })
      .then(() => {
        const clear = (row) => (sameConversation(row, thread) ? { ...row, unread: 0 } : row);
        threads = threads.map(clear);
        groups = groups.map(clear);
        paintBadge();
      })
      .catch(() => { /* the next poll re-acks */ });
  }
  paintConversation();
  const threadRow = [...threads, ...groups].find((row) => sameConversation(row, thread));
  if (threadRow && !silent) paintThreadList();
};

// The conversation paints oldest-first (the API returns newest-first, so the
// display flips a copy — the source array is never mutated). New messages
// from the 5s poll keep the scroll pinned to the bottom only when the reader
// already sat there.
const paintConversation = () => {
  if (!conversationEl || !conversation) return;
  // The reader's scroll: a full re-render (the 5s poll replaces every node)
  // keeps the bottom pinned only when the reader already sat there.
  const previousScroll = conversationEl.querySelector(".chat-widget-messages");
  const pinned = previousScroll
    ? previousScroll.scrollHeight - previousScroll.scrollTop - previousScroll.clientHeight < 60
    : true;
  // The 5s poll rebuilds the composer; carry a half-typed draft (and focus)
  // over — but only within the SAME thread, never into another conversation.
  const draft = composerEl && composerEl.value
    ? { threadId: composerEl.dataset.threadId, value: composerEl.value,
      focused: document.activeElement === composerEl,
      start: composerEl.selectionStart, end: composerEl.selectionEnd }
    : null;
  // The group strip's open state and half-typed add-member name survive the
  // repaint too — same conversation only.
  const sameAsBefore = composerEl?.dataset.threadId === conversationKey(conversation);
  const manageWasOpen = sameAsBefore && Boolean(conversationEl.querySelector(".chat-widget-group-manage")?.open);
  const addDraft = sameAsBefore ? conversationEl.querySelector(".chat-widget-group-add-input")?.value || "" : "";
  conversationEl.replaceChildren();
  const back = el("button", "chat-widget-back");
  back.type = "button";
  back.textContent = t("chat.allChats");
  back.addEventListener("click", () => {
    dmGifPicker = null;
    activeThread = null;
    conversation = null;
    conversationEl.hidden = true;
    listSideEl.hidden = false;
    paintThreadList();
  });
  const isGroup = kindOf(conversation) === "group";
  const title = el("span", "chat-widget-peer", isGroup
    ? groupTitle(conversation, widgetUser?.id) : conversation.other?.username || "unknown");
  conversationEl.append(back, title);
  if (isGroup) {
    const leaveToList = () => {
      back.click();
      return refreshUnread();
    };
    const manage = buildGroupManage(conversation, {
      viewerId: widgetUser?.id,
      onChange: () => openThread(activeThread, { silent: true }),
      onLeft: leaveToList,
      onError: showSendError,
    });
    manage.open = manageWasOpen;
    const addInput = manage.querySelector(".chat-widget-group-add-input");
    if (addInput) addInput.value = addDraft;
    conversationEl.append(manage);
  }
  const messages = [...(conversation.messages || [])].reverse();
  const scroll = el("div", "chat-widget-messages");
  // Pop only messages newer than the last paint of THIS conversation.
  const key = conversationKey(conversation);
  const popAfter = lastPainted.key === key ? lastPainted.maxId : Infinity;
  const maxId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
  lastPainted = { key, maxId: Math.max(maxId, lastPainted.key === key ? lastPainted.maxId : 0) };
  for (const message of messages) {
    const bubble = el("div", message.mine ? "chat-widget-message mine" : "chat-widget-message");
    if (!message.mine) {
      // The whose-row: the leading initial-circle avatar before the name.
      const who = el("span", "chat-widget-message-who");
      who.append(buildAvatar(message), el("span", "chat-widget-message-who-name", message.authorUsername || ""));
      bubble.append(who);
    }
    const body = messageBodyNode("chat-widget-message-body", message.body,
      { dm: true, authorName: message.authorUsername });
    if (body.classList.contains("chat-emoji-jumbo") && Number(message.id) > popAfter) {
      body.classList.add("chat-emoji-pop");
    }
    const time = el("span", "chat-widget-message-time", relativeTime(message.createdAt));
    time.title = message.createdAt || "";
    bubble.append(body, time);
    scroll.append(bubble);
  }
  const older = el("button", "chat-widget-older");
  older.type = "button";
  older.textContent = t("chat.loadOlder");
  older.hidden = messages.length === 0;
  const oldest = messages[0];
  older.addEventListener("click", async () => {
    if (!oldest) return;
    try {
      const data = await api(`${conversationBase(activeThread)}?after=${encodeURIComponent(oldest.id)}`);
      const more = Array.isArray(data?.messages) ? data.messages : [];
      conversation = { ...conversation, messages: [...more, ...(conversation.messages || [])] };
      paintConversation();
    } catch { /* the button stays for the next try */ }
  });
  scroll.prepend(older);
  conversationEl.append(scroll);
  if (pinned) scroll.scrollTop = scroll.scrollHeight;
  const composer = el("div", "chat-widget-composer");
  composerEl = el("textarea", "chat-widget-input");
  composerEl.rows = 1;
  composerEl.placeholder = t("chat.writeMessage");
  composerEl.setAttribute("aria-label", t("chat.messageUser", { name: title.textContent }));
  composerEl.dataset.threadId = conversationKey(activeThread);
  if (draft && draft.threadId === composerEl.dataset.threadId) {
    composerEl.value = draft.value;
    if (draft.focused) {
      const restored = composerEl;
      queueMicrotask(() => {
        restored.focus();
        restored.setSelectionRange(draft.start, draft.end);
      });
    }
  }
  composerEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  sendButton = el("button", "button button-primary chat-widget-send");
  sendButton.type = "button";
  sendButton.textContent = t("common.send");
  sendButton.addEventListener("click", sendMessage);
  if (!dmGifPicker) dmGifPicker = buildGifPicker((gifId) => sendDmBody(gifToken(gifId)));
  const imageButton = buildImageButton(sendDmImage);
  composer.append(dmGifPicker.grid, composerEl, imageButton, dmGifPicker.toggle, sendButton);
  conversationEl.append(composer);
  conversationEl.hidden = false;
  if (listSideEl) listSideEl.hidden = true;
};

const sendMessage = () => sendDmBody(composerEl ? composerEl.value.trim() : "", { clearComposer: true });

// One DM send (typed text or a GIF token); a GIF send leaves the typed draft.
const sendDmBody = async (body, { clearComposer = false } = {}) => {
  if (sendInFlight || !activeThread || !composerEl) return;
  if (!body) return;
  sendInFlight = true;
  sendButton.disabled = true;
  try {
    const data = await api(conversationBase(activeThread), {
      method: "POST",
      body: { body },
    });
    if (clearComposer && composerEl) composerEl.value = "";
    landSentMessage(data);
  } catch (error) {
    showSendError(error?.message || t("chat.sendFailed"));
  } finally {
    sendInFlight = false;
    if (sendButton) sendButton.disabled = false;
  }
};

// The send's success arm, shared by text and image sends: add the stored
// message once (newest-first array, so the poll's copy dedupes by id).
const landSentMessage = (data) => {
  if (data?.message?.id && !((conversation?.messages || []).some((row) => row.id === data.message.id))) {
    conversation = { ...conversation, messages: [data.message, ...(conversation.messages || [])] };
  }
  paintConversation();
  refreshUnread().catch(() => { /* badge catches up on its next tick */ });
};

// One image send (v4.7): multipart through the same single-flight gate.
const sendDmImage = async (file) => {
  if (sendInFlight || !activeThread || !file) return;
  sendInFlight = true;
  if (sendButton) sendButton.disabled = true;
  try {
    landSentMessage(await uploadDmImage(activeThread, file));
  } catch (error) {
    showSendError(error?.message || t("chat.sendFailed"));
  } finally {
    sendInFlight = false;
    if (sendButton) sendButton.disabled = false;
  }
};

// The refusal paints a single line above the composer (textContent only);
// the next successful render wipes it.
const showSendError = (message) => {
  const composer = composerEl?.closest(".chat-widget-composer");
  if (!composer) return;
  // One note, reused: a second failure rewrites the line instead of stacking.
  const existing = composer.parentElement?.querySelector(".chat-widget-send-error");
  if (existing) {
    existing.textContent = message;
    return;
  }
  const note = el("p", "chat-widget-send-error", message);
  composer.before(note);
};

// ----------
// The Lobby tab: the old /chat page's public stream inside the widget. GET
// /api/chat?after=<id> carries new room messages plus the online count (the
// retired shape the backend lane restored); POST /api/chat sends; the
// staff-only × deletes through DELETE /api/chat/:id. The old class family
// (chat-message, role badges) and the old poll rhythm (15s) ride verbatim.
// ----------

// The background poll should quietly retry on the next interval rather than
// create unhandled promise rejections during temporary network failures.
const pollLobbySafely = () => {
  pollLobby().catch(() => {});
};

// The Lobby tab's DOM: the online count line, the old stream list, the send
// form. Built once per panel open.
const buildLobby = () => {
  const host = el("div", "chat-widget-lobby");
  host.hidden = true;
  lobbyOnlineEl = el("p", "chat-online chat-widget-lobby-online");
  const list = el("div", "chat-messages");
  list.dataset.chatMessages = "";
  lobbyMessagesEl = list;
  const form = el("form", "chat-widget-lobby-send");
  const input = el("input", "chat-widget-lobby-input");
  input.type = "text";
  input.name = "body";
  input.maxLength = LOBBY_MESSAGE_MAX;
  input.required = true;
  input.placeholder = t("chat.messageLobby");
  input.setAttribute("aria-label", t("chat.messageLobby"));
  const send = el("button", "button button-primary chat-widget-lobby-send-button", t("common.send"));
  send.type = "submit";
  const gifPicker = buildGifPicker((gifId) => sendLobbyBody(gifToken(gifId), null));
  form.append(gifPicker.grid, input, gifPicker.toggle, send);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendLobbyMessage(input);
  });
  host.append(lobbyOnlineEl, lobbyMessagesEl, form);
  return host;
};

// One stream row, the old renderChatMessage's room arm byte-kin: the author
// name, the role badge, the absolute timestamp, the filtered body — textContent
// only — and the staff-only delete control.
const lobbyMessageRow = (message) => {
  const row = el("div", "chat-message");
  row.dataset.chatMessageId = String(message.id);
  if (widgetUser && Number(widgetUser.id) === Number(message.author.id)) {
    row.classList.add("chat-mine");
  }
  const head = el("p", "chat-message-head");
  head.append(el("span", "chat-message-author", message.author.username));
  if (
    message.author.role === "owner" ||
    message.author.role === "admin"
  ) {
    head.append(
      el("span", "role-badge role-badge-" + message.author.role, message.author.role === "owner" ? t("chat.roleOwner") : t("chat.roleAdmin")),
    );
  }
  const when = el("time");
  when.dateTime = message.createdAt;
  when.textContent = new Date(message.createdAt).toLocaleString(currentLocale());
  head.append(when);
  row.append(head, messageBodyNode("chat-message-body", message.body));
  if (isStaff()) {
    const remove = el("button", "chat-message-delete", "×");
    remove.type = "button";
    remove.dataset.chatMessageId = String(message.id);
    remove.setAttribute("aria-label", t("chat.deleteLobbyMessage"));
    remove.addEventListener("click", () => {
      deleteLobbyMessage(remove).catch(() => { /* the row stays for a retry */ });
    });
    row.append(remove);
  }
  return row;
};

// Paint the whole stream (each panel open re-renders the carried log).
const paintLobbyLog = () => {
  if (!lobbyMessagesEl) return;
  lobbyMessagesEl.replaceChildren();
  for (const message of lobbyLog) {
    lobbyMessagesEl.append(lobbyMessageRow(message));
  }
  lobbyMessagesEl.scrollTop = lobbyMessagesEl.scrollHeight;
  if (lobbyOnlineEl) lobbyOnlineEl.textContent = lobbyOnlineText();
};

// Incoming lobby messages: append, deduped by id (the poll's echo-safe arm).
const appendLobbyMessages = (messages) => {
  if (!lobbyMessagesEl || !Array.isArray(messages)) return;
  for (const message of messages) {
    if (!message || message.id == null) continue;
    if (lobbyLog.some((row) => row.id === message.id)) continue;
    lobbyLog = [...lobbyLog, message];
    lobbyMessagesEl.append(lobbyMessageRow(message));
    if (Number(message.id) > lobbyLastId) lobbyLastId = Number(message.id);
  }
  lobbyMessagesEl.scrollTop = lobbyMessagesEl.scrollHeight;
};

const lobbyOnlineText = () => {
  // The old line ("N online now"); the zero case renders its own quiet note.
  return tn("chat.onlineNow", lobbyOnline);
};

const pollLobby = async () => {
  const requestedVersion = ++lobbyVersion;
  // lobbyLastId 0 = fresh load: the absent param asks the server for the
  // newest page (after=0 would return the OLDEST page instead) — the old
  // cursor law.
  const data = await api(
    lobbyLastId > 0 ? "/api/chat?after=" + lobbyLastId : "/api/chat",
  );
  if (!open || requestedVersion !== lobbyVersion) return;
  lobbyAvailable = true;
  lobbyOnline = Number(data?.online || 0);
  if (lobbyOnlineEl) lobbyOnlineEl.textContent = lobbyOnlineText();
  appendLobbyMessages(Array.isArray(data?.messages) ? data.messages : []);
  const nextLastId = Number(data?.lastId || 0);
  if (nextLastId > lobbyLastId) lobbyLastId = nextLastId;
};

// Room send: POST then append locally (the poll dedupe skips the echo) — the
// old submitChatMessage's shape, single-flighted for the widget's form.
const sendLobbyMessage = (input) => sendLobbyBody(String(input?.value ?? "").trim(), input);

// One lobby send (typed text or a GIF token); clearInput is null for a GIF
// send so the typed draft survives.
const sendLobbyBody = async (body, clearInput) => {
  if (!body || lobbySendInFlight) return;
  lobbySendInFlight = true;
  try {
    const data = await api("/api/chat", { method: "POST", body: { body } });
    if (clearInput) clearInput.value = "";
    appendLobbyMessages(data?.message ? [data.message] : []);
  } catch (error) {
    showLobbySendError(error?.message || t("chat.sendFailed"));
  } finally {
    lobbySendInFlight = false;
  }
};

// The refusal rides the send-error slot idiom: ONE textContent-only line at
// the form's head, reused per failure, wiped by the panel's re-open.
const showLobbySendError = (message) => {
  if (!lobbyEl) return;
  const existing = lobbyEl.querySelector(".chat-widget-lobby-error");
  if (existing) {
    existing.textContent = message;
    return;
  }
  lobbyEl.append(el("p", "chat-widget-lobby-error", message));
};

// Staff cleanup, the old deleteChatMessage's shape: the row and the carried
// log both drop the message (the log is filtered to a new array).
const deleteLobbyMessage = async (button) => {
  await api("/api/chat/" + button.dataset.chatMessageId, { method: "DELETE" });
  const removedId = Number(button.dataset.chatMessageId);
  lobbyLog = lobbyLog.filter((row) => Number(row.id) !== removedId);
  button.closest("[data-chat-message-id]")?.remove();
};

// The New-chat affordance: a compact strip above the thread rows (a username
// input + one submit button). It lives OUTSIDE the rows container —
// paintThreadList's replaceChildren would otherwise wipe a half-typed
// username on every 5s poll repaint — so it mounts once per open and only
// paints its refusal line into the list.
const buildNewChatForm = () => {
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
  const newChatButton = newChatFormEl?.querySelector(".chat-widget-new-send");
  newChatInFlight = true;
  if (newChatButton) newChatButton.disabled = true;
  try {
    const data = await api("/api/dm/threads", { method: "POST", body: { username } });
    if (data?.id == null) throw new Error(t("chat.chatFailed"));
    if (newChatFormEl) newChatFormEl.querySelector(".chat-widget-new-input").value = "";
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
const showNewChatError = (message) => {
  if (!threadListEl) return;
  const existing = threadListEl.querySelector(".chat-widget-new-error");
  if (existing) {
    existing.textContent = message;
    return;
  }
  threadListEl.append(el("p", "chat-widget-new-error", message));
};

// The export the profile surface rides: boots the widget if its single probe
// succeeded (idempotent — a signed-out visitor stays inert and the door is
// a no-op), opens the panel if it is closed, lands the conversation on the
// returned thread id, and gives the list its row before doing so.
export const openChatThread = async (threadId) => {
  if (!launcher) await boot();
  if (!launcher) return;
  if (!open) await openPanel();
  // The profile door lands on the DMs tab (a conversation is a DM surface).
  showTab("dms");
  try {
    applyConversations(await loadThreads());
    paintBadge();
  } catch { /* openThread still reads the conversation itself */ }
  const known = threads.find((row) => row.id === threadId);
  await openThread(known || { id: threadId, kind: "dm" });
};

await boot();

export { boot as initChatWidget };
