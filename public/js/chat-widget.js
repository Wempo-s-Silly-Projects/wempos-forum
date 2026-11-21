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
// Split by feature (wave 2026-11-21-5): this module keeps the boot law, the
// panel shell, the tabs and the profile door; the Lobby tab, the thread list,
// the conversation + composer, the GIF helpers and the shared state live in
// the chat-widget-*.js modules beside it.
import { api } from "./api.js";
import { createIcon } from "./icons.js";
import { currentLocale, i18nReady, t } from "./i18n.js";
import { formatRelative } from "./reltime.js";
import { buildEffectsToggle, buildNewGroupForm, effectsEnabled } from "./dm-extras.js";
import { el, ui } from "./chat-widget-state.js";
import { buildLobby, paintLobbyLog, pollLobbySafely, seedLobby } from "./chat-widget-lobby.js";
import {
  applyConversations, buildListFilter, buildNewChatForm, loadThreads, paintBadge, paintThreadList, refreshUnread,
  showNewChatError,
} from "./chat-widget-threads.js";
import { openThread, paintConversation } from "./chat-widget-composer.js";

const PANEL_POLL_MS = 5_000;
const UNREAD_POLL_MS = 30_000;
const LOBBY_POLL_MS = 15_000;
const PANEL_WIDTH_MAX = 360;

let launcher = null;
let panel = null;
let panelTimer = null;
let unreadTimer = null;
let lobbyTimer = null;
let activeTab = "dms";

// Locale-aware stamp (wave 2026-11-21-3); the keyed short forms below stay
// only for runtimes without Intl.RelativeTimeFormat.
export const relativeTime = (iso) => {
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
  ui.badge = el("span", "chat-widget-badge");
  ui.badge.hidden = true;
  launcher.append(glyph, ui.badge);
  launcher.addEventListener("click", togglePanel);
  document.body.append(launcher);
  // The Lobby tab's own boot probe rides the old /chat read: a success seeds
  // the stream (newest 50, oldest-first) and the online count; a failure
  // keeps the tab hidden — the degrade law, one more door past the widget's
  // signed-in gate above.
  try {
    const lobbyData = await api("/api/chat");
    ui.lobbyAvailable = true;
    seedLobby(lobbyData);
  } catch {
    // The lobby lane is unshipped (or signed-out): the tab stays hidden.
    ui.lobbyAvailable = false;
  }
  paintBadge();
  unreadTimer = setInterval(() => {
    if (document.hidden || ui.open) return;
    refreshUnread().catch(() => { /* transient — the ui.badge keeps its last value */ });
  }, UNREAD_POLL_MS);
};

const togglePanel = () => {
  if (ui.open) closePanel();
  else openPanel();
};

const openPanel = async () => {
  if (ui.open) return;
  ui.open = true;
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
  lobbyTab.setAttribute("aria-pressed", "false");
  lobbyTab.hidden = true;
  lobbyTab.addEventListener("click", () => {
    showTab("lobby");
  });
  const dmsTab = el("button", "chat-widget-tab", t("chat.tabDms"));
  dmsTab.type = "button";
  dmsTab.dataset.widgetTab = "dms";
  dmsTab.setAttribute("aria-pressed", "false");
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
  ui.threadListEl = el("div", "chat-widget-threads");
  ui.conversationEl = el("div", "chat-widget-conversation");
  ui.conversationEl.hidden = true;
  // The New-chat affordance mounts once per open, OUTSIDE the rows container
  // paintThreadList replaces (see buildNewChatForm).
  ui.listSideEl = el("div", "chat-widget-list");
  ui.newChatFormEl = buildNewChatForm();
  const newGroupEl = buildNewGroupForm(
    (groupId) => openThread({ kind: "group", id: groupId }).then(() => refreshUnread()),
    showNewChatError,
  );
  ui.effectsOn = effectsEnabled();
  const effectsEl = buildEffectsToggle((on) => {
    ui.effectsOn = on;
    paintConversation();
  });
  ui.listSideEl.append(ui.newChatFormEl, newGroupEl, effectsEl, buildListFilter(), ui.threadListEl);
  ui.lobbyEl = buildLobby();
  panel.append(head, ui.listSideEl, ui.conversationEl, ui.lobbyEl);
  document.body.append(panel);
  // Keyboard reach (wave 7 a11y): focus lands in the panel on open, Escape
  // closes it (unless an inner picker already handled the key), and
  // closePanel hands focus back to the launcher.
  panel.setAttribute("tabindex", "-1");
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    closePanel();
  });
  panel.focus();
  // Session identity (mine rows, the staff delete arm) rides one probe per
  // open; a failure just drops the perks, never the stream.
  ui.widgetUser = await api("/api/session")
    .then((data) => (data?.user ? data.user : null))
    .catch(() => null);
  // The seeded Lobby history paints here, once identity is known (mine rows,
  // the staff delete arm); the poll below only appends past lobbyLastId.
  paintLobbyLog();
  paintThreadList();
  panelTimer = setInterval(() => {
    if (document.hidden) return;
    const refresh = [refreshUnread().catch(() => { /* keep painted data */ })];
    if (ui.activeThread) refresh.push(openThread(ui.activeThread, { silent: true }));
    Promise.all(refresh).catch(() => { /* next tick retries */ });
  }, PANEL_POLL_MS);
  if (ui.lobbyAvailable) {
    lobbyTab.hidden = false;
    lobbyTimer = setInterval(() => {
      if (document.hidden) return;
      pollLobbySafely();
    }, LOBBY_POLL_MS);
  }
  showTab(ui.lobbyAvailable ? "lobby" : "dms");
  const data = await loadThreads().catch(() => null);
  if (data) {
    applyConversations(data);
    paintBadge();
    if (!ui.activeThread) paintThreadList();
  }
};

const closePanel = () => {
  ui.open = false;
  launcher.setAttribute("aria-expanded", "false");
  clearInterval(panelTimer);
  panelTimer = null;
  clearInterval(lobbyTimer);
  lobbyTimer = null;
  const focusWasInside = panel.contains(document.activeElement);
  panel.remove();
  if (focusWasInside && launcher) launcher.focus();
  panel = null;
  ui.threadListEl = null;
  ui.conversationEl = null;
  ui.newChatFormEl = null;
  ui.listSideEl = null;
  ui.lobbyEl = null;
  ui.lobbyOnlineEl = null;
  ui.lobbyMessagesEl = null;
  ui.composerEl = null;
  ui.sendButton = null;
  ui.activeThread = null;
  ui.conversation = null;
  ui.gifLibrary = null;
  ui.dmGifPicker = null;
  ui.lastPainted = { key: null, maxId: 0 };
  ui.listFilter = "";
  ui.filterStatusEl = null;
};

// The tab switcher: the Lobby stream and the DMs pair are mutually exclusive
// surfaces inside the panel; the DM rail's own inner state (list vs the open
// conversation) survives the round trip.
const showTab = (nextTab) => {
  if (nextTab !== "lobby" && nextTab !== "dms") return;
  if (nextTab === "lobby" && !ui.lobbyAvailable) return;
  activeTab = nextTab;
  if (!panel) return;
  const showLobby = nextTab === "lobby";
  const lobbyTab = panel.querySelector('[data-widget-tab="lobby"]');
  const dmsTab = panel.querySelector('[data-widget-tab="dms"]');
  if (lobbyTab) lobbyTab.setAttribute("aria-pressed", String(showLobby));
  if (dmsTab) dmsTab.setAttribute("aria-pressed", String(!showLobby));
  if (ui.lobbyEl) ui.lobbyEl.hidden = !showLobby;
  if (ui.listSideEl) ui.listSideEl.hidden = showLobby || Boolean(ui.activeThread);
  if (ui.conversationEl) ui.conversationEl.hidden = showLobby || !ui.activeThread;
  if (showLobby) pollLobbySafely();
};

// The export the profile surface rides: boots the widget if its single probe
// succeeded (idempotent — a signed-out visitor stays inert and the door is
// a no-op), opens the panel if it is closed, lands the conversation on the
// returned thread id, and gives the list its row before doing so.
export const openChatThread = async (threadId) => {
  if (!launcher) await boot();
  if (!launcher) return;
  if (!ui.open) await openPanel();
  // The profile door lands on the DMs tab (a conversation is a DM surface).
  showTab("dms");
  try {
    applyConversations(await loadThreads());
    paintBadge();
  } catch { /* openThread still reads the ui.conversation itself */ }
  const known = ui.threads.find((row) => row.id === threadId);
  await openThread(known || { id: threadId, kind: "dm" });
};

await boot();

export { boot as initChatWidget };
