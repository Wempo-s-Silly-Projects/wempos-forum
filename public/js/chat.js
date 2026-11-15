
// Live chat + DMs + online presence (v3.1, Desen's ask): a whole page at
// /chat — one public room plus 1:1 DMs, on a polling loop. GET
// /api/chat?after=<id> carries new room messages plus the online count; the
// DM thread polls the same shape at /api/dms/:id. POST /api/presence is the
// signed-in heartbeat (every minute), and invisible mode rides each
// heartbeat so toggling it takes effect on the next ping (sent immediately
// on toggle). The page lives in <main> like every route, so navigation owns
// its lifecycle; module state — room/DM cursors and the open thread —
// survives route renders. Stale responses are ignored after route, thread,
// or session changes. Every message body renders through textContent only.

import { api } from "./api.js";
import { addHeading, main, setMessage } from "./dom.js";
import { addText } from "./forms.js";
import { createIcon } from "./icons.js";
// The bell badge (DMs/mentions ride the real notification system, v4.2).
import { updateBell } from "./notifications.js";
import { state } from "./state.js";

const HEARTBEAT_INTERVAL_MS = 60_000;
const CHAT_POLL_MS = 15_000;

let chatUser = null;
let panel = null;
let lastId = 0;
let dmLastId = 0;
let pollTimer = null;
let heartbeatTimer = null;
let activeTab = "room";
let dmThread = null; // { id, otherUser: { id?, username } }
let pendingDmThread = null;
let lastDmUnread = null;
let lastBellUnread = null;

// Request/view generations prevent old asynchronous responses from painting
// into a newer route, conversation, or list view.
let roomPollVersion = 0;
let dmPollVersion = 0;
let dmListRequestVersion = 0;
let dmViewVersion = 0;

function isInvisiblePref() {
  try {
    return window.localStorage.getItem("forum-invisible") === "true";
  } catch {
    return false;
  }
}

function saveInvisiblePref(value) {
  try {
    window.localStorage.setItem("forum-invisible", String(value));
  } catch {}
}

function isPingMuted() {
  try {
    return window.localStorage.getItem("forum-chat-muted") === "true";
  } catch {
    return false;
  }
}

function savePingMuted(value) {
  try {
    window.localStorage.setItem("forum-chat-muted", String(value));
  } catch {}
}

// Background polling should quietly retry on the next interval rather than
// create unhandled promise rejections during temporary network failures.
function pollRoomSafely() {
  pollRoom().catch(() => {});
}

function pollDmThreadSafely() {
  pollDmThread().catch(() => {});
}

function refreshDmListSafely() {
  refreshDmList().catch(() => {});
}

// The header link: chat icon + live online count.
export const createChatButton = (document) => {
  const link = document.createElement("a");
  link.className = "icon-button chat-button";
  link.href = "/chat";
  link.setAttribute("data-app-link", "");
  link.setAttribute("aria-label", "Chat");
  link.append(createIcon(document, "chat"));

  const count = document.createElement("span");
  count.className = "chat-count";
  count.dataset.chatCount = "";
  count.textContent = "0";
  link.append(count);

  // Unread-DM dot (v4.2).
  const dot = document.createElement("span");
  dot.className = "chat-unread-dot";
  dot.dataset.chatUnread = "";
  dot.hidden = true;
  link.append(dot);

  return link;
};

// The unread badge + ping alert: dot on every chat button, flash animation,
// and a short Web Audio blip (no asset, no Notification permission).
function setDmUnread(unread) {
  const increased = lastDmUnread !== null && unread > lastDmUnread;
  lastDmUnread = unread;

  for (const dot of document.querySelectorAll("[data-chat-unread]")) {
    dot.hidden = unread === 0;
    dot.setAttribute("aria-hidden", "true");

    if (increased && unread > 0) {
      dot.classList.remove("chat-unread-pulse");
      void dot.offsetWidth;
      dot.classList.add("chat-unread-pulse");
    }
  }

  if (increased && unread > 0 && !isPingMuted()) playPing();
}

let audioContext = null;

function playPing() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioContext = audioContext || new AudioContextClass();

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioContext.currentTime);
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.08,
      audioContext.currentTime + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + 0.28,
    );

    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.3);
  } catch {
    // No audio context (policy, autoplay): the visual pulse still fired.
  }
}

// One message row, shared by the room and DM threads. kind picks the delete
// control: room messages delete staff-only; DM messages delete for the
// author or staff (the server gates the same way).
function renderChatMessage(document, list, message, user, kind) {
  const row = document.createElement("div");
  row.className = "chat-message";

  const staff = Boolean(
    user && (user.role === "owner" || user.role === "admin"),
  );
  const own = Boolean(
    user && Number(user.id) === Number(message.author.id),
  );

  if (own) row.classList.add("chat-mine");

  if (kind === "dm") {
    row.dataset.dmMessageId = String(message.id);
  } else {
    row.dataset.chatMessageId = String(message.id);
  }

  const head = document.createElement("p");
  head.className = "chat-message-head";

  const name = document.createElement("span");
  name.className = "chat-message-author";
  name.textContent = message.author.username;
  head.append(name);

  if (
    message.author.role === "owner" ||
    message.author.role === "admin"
  ) {
    const badge = document.createElement("span");
    badge.className = "role-badge role-badge-" + message.author.role;
    badge.textContent = message.author.role === "owner" ? "Owner" : "Admin";
    head.append(badge);
  }

  const when = document.createElement("time");
  when.dateTime = message.createdAt;
  when.textContent = new Date(message.createdAt).toLocaleTimeString();
  head.append(when);

  row.append(head);

  const body = document.createElement("p");
  body.className = "chat-message-body";
  body.textContent = message.body;
  row.append(body);

  if (kind === "dm" ? (staff || own) : staff) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chat-message-delete";
    remove.dataset.action = kind === "dm" ? "dm-delete" : "chat-delete";
    remove.dataset.chatMessageId = String(message.id);
    remove.setAttribute("aria-label", "Delete this message");
    remove.textContent = "×";
    row.append(remove);
  }

  list.append(row);
}

// Incoming room messages: append, deduped by row presence.
function appendRoomMessages(messages, targetPanel = panel) {
  if (!targetPanel?.isConnected || targetPanel !== panel) return;

  const list = targetPanel.querySelector("[data-chat-messages]");
  if (!list) return;

  for (const message of messages) {
    if (
      list.querySelector(
        `[data-chat-message-id="${message.id}"]`,
      )
    ) {
      lastId = Math.max(lastId, Number(message.id));
      continue;
    }

    renderChatMessage(
      targetPanel.ownerDocument,
      list,
      message,
      chatUser,
      "room",
    );

    lastId = Math.max(lastId, Number(message.id));
  }

  list.scrollTop = list.scrollHeight;
}

async function sendHeartbeat() {
  if (!chatUser) return;

  try {
    await api("/api/presence", {
      method: "POST",
      body: { invisible: isInvisiblePref() },
    });
  } catch {
    // A missed heartbeat just expires presence early — never a user-facing
    // error.
  }
}

async function pollRoom() {
  const requestedVersion = ++roomPollVersion;
  const requestedPanel = panel;
  const requestedCursor = lastId;

  // lastId 0 = fresh load: the absent param asks the server for the newest
  // page (after=0 would return the OLDEST page instead).
  const data = await api(
    requestedCursor > 0
      ? "/api/chat?after=" + requestedCursor
      : "/api/chat",
  );

  // A newer poll superseded this one. Its result is no longer authoritative.
  if (requestedVersion !== roomPollVersion) return;

  for (const badge of document.querySelectorAll("[data-chat-count]")) {
    badge.textContent = String(Number(data.online || 0));
  }

  // Only update page-specific UI if this is still the page that initiated
  // the request. Header counts and notification counts remain global.
  const samePanel =
    requestedPanel === panel &&
    requestedPanel?.isConnected;

  if (samePanel) {
    const online = requestedPanel.querySelector("[data-chat-online]");
    if (online) {
      online.textContent = String(Number(data.online || 0)) + " online now";
    }

    // Who's online (v4.4): the roster of named members riding the same poll.
    const roster = requestedPanel.querySelector("[data-chat-roster]");

    if (roster) {
      roster.replaceChildren();

      const members = Array.isArray(data.onlineMembers)
        ? data.onlineMembers
        : [];

      if (!members.length) {
        roster.append(
          document.createTextNode(
            Number(data.online || 0) > 0
              ? "Everyone else is lurking."
              : "Nobody is online right now.",
          ),
        );
      } else {
        roster.append(document.createTextNode("Online now: "));

        members.forEach((member, index) => {
          if (index) roster.append(document.createTextNode(", "));

          const link = document.createElement("a");
          link.href = "/users/" + encodeURIComponent(member.username);
          link.className = "chat-online-name";
          link.textContent = member.username;
          roster.append(link);
        });

        if (Number(data.online) > members.length) {
          roster.append(
            document.createTextNode(
              " (+" + (Number(data.online) - members.length) + " unseen)",
            ),
          );
        }
      }
    }
  }

  // v4.2 badge feed: the bell count and DM unread dot ride the same poll.
  const bellUnread = Number(data.bellUnread || 0);

  if (bellUnread !== lastBellUnread) {
    lastBellUnread = bellUnread;
    updateBell(bellUnread);
  }

  setDmUnread(Number(data.dmUnread || 0));

  if (
    samePanel &&
    activeTab === "room"
  ) {
    appendRoomMessages(data.messages, requestedPanel);
  } else if (Number(data.lastId) > lastId) {
    // Off the chat page (or on the DMs tab): advance the cursor so the next
    // visit can restart from the newest page if the room is empty.
    lastId = Number(data.lastId);
  }
}

async function refreshDmList() {
  if (!chatUser || !panel?.isConnected) return;

  const requestedPanel = panel;
  const requestedViewVersion = dmViewVersion;
  const requestedListVersion = ++dmListRequestVersion;

  const data = await api("/api/dms");

  if (
    !requestedPanel.isConnected ||
    panel !== requestedPanel ||
    requestedViewVersion !== dmViewVersion ||
    requestedListVersion !== dmListRequestVersion ||
    dmThread
  ) {
    return;
  }

  const host = requestedPanel.querySelector("[data-chat-dms]");
  if (!host) return;

  const list = document.createElement("div");
  list.className = "dm-thread-list";

  const threads = Array.isArray(data.threads) ? data.threads : [];

  if (!threads.length) {
    const empty = document.createElement("p");
    empty.className = "chat-guest-note";
    empty.textContent =
      "No conversations yet. Open a profile and press Message.";
    list.append(empty);
  }

  for (const thread of threads) {
    const row = document.createElement("button");
    row.type = "button";
    row.className =
      "dm-thread-row" +
      (Number(thread.unread || 0) > 0 ? " dm-thread-unread" : "");
    row.dataset.action = "dm-open-thread";
    row.dataset.threadId = String(thread.id);
    row.dataset.otherUsername = thread.otherUser.username;

    const name = document.createElement("span");
    name.className = "dm-thread-name";
    name.textContent = thread.otherUser.username;

    const preview = document.createElement("span");
    preview.className = "dm-thread-preview";
    preview.textContent = thread.lastBody
      ? thread.lastBody
      : (thread.lastAt ? "" : "No messages yet");

    row.append(name, preview);

    // Per-conversation unread count (v4.2).
    const unread = Number(thread.unread || 0);

    if (unread > 0) {
      const badge = document.createElement("span");
      badge.className = "dm-thread-badge";
      badge.textContent = String(unread);
      row.append(badge);
    }

    list.append(row);
  }

  host.replaceChildren(list);
}

async function pollDmThread() {
  if (!dmThread || !panel?.isConnected) return;

  const requestedPanel = panel;
  const requestedThreadId = dmThread.id;
  const requestedViewVersion = dmViewVersion;
  const requestedPollVersion = ++dmPollVersion;
  const requestedCursor = dmLastId;

  const base = "/api/dms/" + requestedThreadId;

  const data = await api(
    requestedCursor > 0
      ? base + "?after=" + requestedCursor
      : base,
  );

  if (
    !requestedPanel.isConnected ||
    panel !== requestedPanel ||
    !dmThread ||
    dmThread.id !== requestedThreadId ||
    requestedViewVersion !== dmViewVersion ||
    requestedPollVersion !== dmPollVersion
  ) {
    return;
  }

  const list = requestedPanel.querySelector("[data-dm-messages]");
  if (!list) return;

  const messages = Array.isArray(data.messages) ? data.messages : [];

  for (const message of messages) {
    if (
      list.querySelector(
        `[data-dm-message-id="${message.id}"]`,
      )
    ) {
      dmLastId = Math.max(dmLastId, Number(message.id));
      continue;
    }

    renderChatMessage(
      requestedPanel.ownerDocument,
      list,
      message,
      chatUser,
      "dm",
    );

    dmLastId = Math.max(dmLastId, Number(message.id));
  }

  list.scrollTop = list.scrollHeight;
}

export function setChatTab(tab) {
  if (tab !== "room" && tab !== "dms") return;
  if (tab === "dms" && !chatUser) return;

  activeTab = tab;

  if (!panel?.isConnected) return;

  const room = panel.querySelector("[data-chat-room]");
  const dms = panel.querySelector("[data-chat-dms]");

  if (room) room.hidden = tab !== "room";
  if (dms) dms.hidden = tab !== "dms";

  for (const button of panel.querySelectorAll("[data-chat-tab]")) {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.chatTab === tab),
    );
  }

  if (tab === "dms") {
    if (dmThread) {
      pollDmThreadSafely();
    } else {
      refreshDmListSafely();
    }
  } else {
    // If the room is empty, restart from the newest page. The away-cursor
    // may have advanced while the room was not rendered.
    const list = room?.querySelector("[data-chat-messages]");

    if (list && list.children.length === 0) {
      lastId = 0;
    }

    pollRoomSafely();
  }
}

// Open a thread from the conversation list.
export function openDmThread(threadId, otherUsername) {
  renderDmThread({
    id: Number(threadId),
    otherUser: { username: otherUsername },
  });

  if (activeTab === "dms") {
    pollDmThreadSafely();
  } else {
    setChatTab("dms");
  }
}

export function backToDmList() {
  dmViewVersion++;
  dmPollVersion++;
  dmThread = null;
  refreshDmListSafely();
}

// The DM thread view: back control, the other member's name, message stream,
// and send form. Replaces the conversation list in place.
function renderDmThread(thread) {
  if (!panel?.isConnected) return;

  const host = panel.querySelector("[data-chat-dms]");
  if (!host) return;

  dmViewVersion++;
  dmPollVersion++;
  dmListRequestVersion++;

  dmThread = thread;
  dmLastId = 0;

  const document = panel.ownerDocument;
  const view = document.createElement("div");
  view.className = "dm-thread-view";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "button button-quiet";
  back.dataset.action = "dm-back";
  back.textContent = "← Back";
  view.append(back);

  const title = document.createElement("h3");
  title.textContent = thread.otherUser.username;
  view.append(title);

  const list = document.createElement("div");
  list.className = "chat-messages";
  list.dataset.dmMessages = "";
  view.append(list);

  const form = document.createElement("form");
  form.dataset.form = "dm-send";
  form.dataset.threadId = String(thread.id);

  const input = document.createElement("input");
  input.type = "text";
  input.name = "body";
  input.maxLength = 1000;
  input.required = true;
  input.placeholder = "Message " + thread.otherUser.username;
  input.setAttribute(
    "aria-label",
    "Message " + thread.otherUser.username,
  );
  form.append(input);

  const send = document.createElement("button");
  send.type = "submit";
  send.className = "button button-primary";
  send.textContent = "Send";
  form.append(send);

  view.append(form);
  host.replaceChildren(view);
}

// The /chat route's body: the room + DMs tab pair.
export function renderChatPage(host, user) {
  chatUser = user;

  const document = host.ownerDocument;
  const page = document.createElement("div");
  page.className = "chat-page";
  panel = page;

  const head = document.createElement("div");
  head.className = "chat-head";

  const online = document.createElement("span");
  online.className = "chat-online";
  online.dataset.chatOnline = "";
  online.textContent = "";
  head.append(online);

  // Who's online (v4.4): named roster under the count.
  const roster = document.createElement("div");
  roster.className = "chat-roster";
  roster.dataset.chatRoster = "";
  head.append(roster);

  // Room/DMs tab pair.
  const tabs = document.createElement("div");
  tabs.className = "chat-tabs feed-tabs";

  for (const [tab, label] of [["room", "Room"], ["dms", "DMs"]]) {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = "feed-tab";
    tabButton.dataset.action = "chat-tab";
    tabButton.dataset.chatTab = tab;
    tabButton.textContent = label;
    tabButton.setAttribute("aria-selected", "false");
    tabs.append(tabButton);
  }

  head.append(tabs);

  // Invisible mode: members can lurk without appearing online.
  const lurk = document.createElement("label");
  lurk.className = "chat-lurk";

  const invisibleBox = document.createElement("input");
  invisibleBox.type = "checkbox";
  invisibleBox.dataset.actionPref = "invisible";
  invisibleBox.checked = isInvisiblePref();
  invisibleBox.addEventListener("change", () => {
    saveInvisiblePref(invisibleBox.checked);
    sendHeartbeat();
  });

  lurk.append(
    invisibleBox,
    document.createTextNode(" Invisible — don't count me online"),
  );

  lurk.hidden = !user;
  head.append(lurk);

  // Ping alert mute: client-stored; the visual unread indicator still works.
  const mute = document.createElement("label");
  mute.className = "chat-lurk";

  const muteBox = document.createElement("input");
  muteBox.type = "checkbox";
  muteBox.checked = isPingMuted();
  muteBox.addEventListener("change", () => {
    savePingMuted(muteBox.checked);
  });

  mute.append(
    muteBox,
    document.createTextNode(" Mute the ping sound"),
  );
  head.append(mute);

  // The public room.
  const room = document.createElement("div");
  room.dataset.chatRoom = "";

  const list = document.createElement("div");
  list.className = "chat-messages";
  list.dataset.chatMessages = "";
  room.append(list);

  const form = document.createElement("form");
  form.dataset.form = "chat-send";

  if (!user) {
    form.hidden = true;

    const guest = document.createElement("p");
    guest.className = "chat-guest-note";
    guest.dataset.chatGuestNote = "";
    guest.textContent = "Sign in to join the chat.";
    room.append(guest);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.name = "body";
  input.maxLength = 500;
  input.required = true;
  input.placeholder = "Message the chat";
  input.setAttribute("aria-label", "Message the chat");
  form.append(input);

  const send = document.createElement("button");
  send.type = "submit";
  send.className = "button button-primary";
  send.textContent = "Send";
  form.append(send);

  room.append(form);

  // The DMs tab: members only.
  const dms = document.createElement("div");
  dms.dataset.chatDms = "";
  dms.hidden = true;

  page.append(head, room, dms);
  host.append(page);

  const dmTab = tabs.querySelector('[data-chat-tab="dms"]');
  if (dmTab) dmTab.hidden = !user;

  // A profile's Message button may have stashed a thread while off-route.
  // Render it before activating the DMs tab; setChatTab owns the initial poll.
  if (user && pendingDmThread) {
    const thread = pendingDmThread;
    pendingDmThread = null;
    renderDmThread(thread);
    setChatTab("dms");
  } else {
    setChatTab("room");
  }
}

// Start (or reopen) a DM with a named member — the profile Message handler.
export async function openDmWith(username) {
  if (!chatUser) return;

  const data = await api("/api/dms", {
    method: "POST",
    body: { username },
  });

  pendingDmThread = data.thread;
}

// Session lifecycle: called by app.js whenever the session resolves.
export function updateChatSession(user) {
  const previousUserId = chatUser?.id ?? null;
  const nextUserId = user?.id ?? null;

  if (previousUserId !== nextUserId) {
    dmThread = null;
    pendingDmThread = null;
    dmLastId = 0;
    lastDmUnread = null;
    lastBellUnread = null;

    dmViewVersion++;
    dmPollVersion++;
    dmListRequestVersion++;
  }

  chatUser = user;

  if (user) sendHeartbeat();

  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = user
    ? setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
    : null;
}

// Boot: start the poll loop — the online count badge in the header stays
// fresh even off the chat page.
export function initChat() {
  if (pollTimer) return;

  pollRoomSafely();

  pollTimer = setInterval(() => {
    pollRoomSafely();

    if (panel?.isConnected && activeTab === "dms") {
      if (dmThread) {
        pollDmThreadSafely();
      } else {
        refreshDmListSafely();
      }
    }
  }, CHAT_POLL_MS);
}

// Room send: POST then append locally (the poll dedupe skips the echo).
export async function submitChatMessage(form) {
  const input = form.querySelector("input[name='body']");
  const body = String(input?.value ?? "").trim();

  if (!body) return;

  const data = await api("/api/chat", {
    method: "POST",
    body: { body },
  });

  if (panel?.isConnected && activeTab === "room") {
    appendRoomMessages([data.message]);
  } else {
    lastId = Math.max(lastId, Number(data.message.id));
  }

  if (input) input.value = "";
}

// DM send: capture the destination so a response cannot be rendered into
// another conversation if the user switches threads while the request runs.
export async function submitDmMessage(form) {
  const input = form.querySelector("input[name='body']");
  const body = String(input?.value ?? "").trim();
  const requestedThreadId = Number(form.dataset.threadId);

  if (
    !body ||
    !dmThread ||
    !Number.isSafeInteger(requestedThreadId) ||
    requestedThreadId <= 0 ||
    dmThread.id !== requestedThreadId
  ) {
    return;
  }

  const requestedPanel = panel;
  const requestedViewVersion = dmViewVersion;

  const data = await api(
    "/api/dms/" + requestedThreadId,
    {
      method: "POST",
      body: { body },
    },
  );

  if (
    requestedPanel?.isConnected &&
    panel === requestedPanel &&
    dmThread?.id === requestedThreadId &&
    dmViewVersion === requestedViewVersion
  ) {
    const list = requestedPanel.querySelector("[data-dm-messages]");

    if (list) {
      if (
        !list.querySelector(
          `[data-dm-message-id="${data.message.id}"]`,
        )
      ) {
        renderChatMessage(
          requestedPanel.ownerDocument,
          list,
          data.message,
          chatUser,
          "dm",
        );
      }

      dmLastId = Math.max(dmLastId, Number(data.message.id));
      list.scrollTop = list.scrollHeight;
    }
  }

  // Clear the original form's input after the server accepted the message,
  // even if the user has since navigated to a different conversation.
  if (input) input.value = "";
}

export async function deleteChatMessage(button) {
  const messageId = button.dataset.chatMessageId;

  await api("/api/chat/" + messageId, {
    method: "DELETE",
  });

  button.closest("[data-chat-message-id]")?.remove();
}

export async function deleteDmMessage(button) {
  const messageId = button.dataset.chatMessageId;

  await api("/api/dm-messages/" + messageId, {
    method: "DELETE",
  });

  button.closest("[data-dm-message-id]")?.remove();
}

// The /chat route wrapper (v3.1).
export async function renderChatRoute(context) {
  addHeading(main, "Live chat", 1);

  addText(
    document,
    main,
    "p",
    "One public room plus your DMs. You count as online while you're signed in — tick Invisible in the header to lurk without appearing.",
    "page-lede",
  );

  renderChatPage(main, context.session.user);
}

// The registration seam (task 9): chat/DM sends submit through FORM_HANDLERS;
// page tab/nav/delete actions merge into handleButtonAction's dispatch map.
export const FORM_HANDLERS = {
  "chat-send": async (form) => {
    await submitChatMessage(form);
    setMessage();
  },

  "dm-send": async (form) => {
    await submitDmMessage(form);
    setMessage();
  },
};

export const ACTIONS = {
  "chat-tab": (button) => setChatTab(button.dataset.chatTab),

  "dm-open-thread": (button) =>
    openDmThread(
      button.dataset.threadId,
      button.dataset.otherUsername,
    ),

  "dm-back": () => backToDmList(),

  // The profile Message button find-or-creates the thread, then lands on
  // /chat where the pending thread opens.
  "dm-open": async (button) => {
    await openDmWith(button.dataset.username);
    state.router.navigate("/chat");
  },

  "chat-delete": (button) => deleteChatMessage(button),
  "dm-delete": (button) => deleteDmMessage(button),
};
