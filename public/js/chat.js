// Live chat + DMs + online presence (v3.1, Desen's ask): a whole page at
// /chat — one public room plus 1:1 DMs, on a polling loop. GET
// /api/chat?after=<id> carries new room messages plus the online count; the
// DM thread polls the same shape at /api/dms/:id. POST /api/presence is the
// signed-in heartbeat (every minute), and invisible mode rides each
// heartbeat so toggling it takes effect on the next ping (sent immediately on
// toggle). The page lives in <main> like every route (so navigation owns its
// lifecycle); module state — the room/DM cursors and the open thread —
// survives route renders, and the polls no-op once the page detaches. Every
// body renders through textContent only.

import { api } from "./api.js";
import { createIcon } from "./icons.js";

const HEARTBEAT_INTERVAL_MS = 60_000;
const CHAT_POLL_MS = 15_000;

let chatUser = null;
let panel = null; // the /chat page's root element; null/detached off-route
let lastId = 0;
let dmLastId = 0;
let pollTimer = null;
let heartbeatTimer = null;
let activeTab = "room";
let dmThread = null; // { id, otherUser: { id, username } }
let pendingDmThread = null; // opened from a profile while off-route

function isInvisiblePref() {
  try { return window.localStorage.getItem("forum-invisible") === "true"; }
  catch { return false; }
}

function saveInvisiblePref(value) {
  try { window.localStorage.setItem("forum-invisible", String(value)); } catch {}
}

// The header link: chat icon + the live online count (visible to guests
// too — the counter is the point). app.js re-renders the header per route,
// so the count badge is looked up fresh on every poll.
export const createChatButton = (document) => {
  const link = document.createElement("a");
  // The chat toggle (owner's call): a QUIET control — no button chrome, just
  // the glyph with the online count riding beside it. The boxed icon-button
  // look squeezed the glyph flat once the count joined it, and a hallway
  // door doesn't need to weigh as much as the nav buttons.
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
  return link;
};

// One message row, shared by the room and DM threads. kind picks the delete
// control: room messages delete staff-only; DM messages delete for the
// author or staff (the server gates the same way).
function renderChatMessage(document, list, message, user, kind) {
  const row = document.createElement("div");
  row.className = "chat-message";
  // Room and DM ids come from different tables — distinct dataset keys keep
  // the two delete handlers from ever crossing streams.
  if (kind === "dm") row.dataset.dmMessageId = String(message.id);
  else row.dataset.chatMessageId = String(message.id);
  const head = document.createElement("p");
  head.className = "chat-message-head";
  const name = document.createElement("span");
  name.className = "chat-message-author";
  name.textContent = message.author.username;
  head.append(name);
  if (message.author.role === "owner" || message.author.role === "admin") {
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
  const staff = Boolean(user && (user.role === "owner" || user.role === "admin"));
  const own = Boolean(user && Number(user.id) === Number(message.author.id));
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

// Incoming room messages: append (deduped by row presence — the initial load
// returns the newest page, so the cursor and the DOM can briefly disagree).
function appendRoomMessages(messages) {
  if (!panel?.isConnected) return;
  const list = panel.querySelector("[data-chat-messages]");
  if (!list) return;
  for (const message of messages) {
    if (list.querySelector(`[data-chat-message-id="${message.id}"]`)) continue;
    renderChatMessage(panel.ownerDocument, list, message, chatUser, "room");
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
  // lastId 0 = fresh load: the absent param asks the server for the newest
  // page (after=0 would return the OLDEST page instead).
  const data = await api(lastId > 0 ? "/api/chat?after=" + lastId : "/api/chat");
  for (const badge of document.querySelectorAll("[data-chat-count]")) {
    badge.textContent = String(Number(data.online || 0));
  }
  const online = panel?.querySelector("[data-chat-online]");
  if (online) online.textContent = data.online + " online now";
  if (panel?.isConnected && activeTab === "room") {
    appendRoomMessages(data.messages);
  } else if (Number(data.lastId) > lastId) {
    // Off the chat page (or on the DMs tab): still advance the cursor so the
    // next visit skips to the freshest page instead of replaying history.
    lastId = Number(data.lastId);
  }
}

async function refreshDmList() {
  if (!chatUser || !panel?.isConnected) return;
  const data = await api("/api/dms");
  const host = panel.querySelector("[data-chat-dms]");
  if (!host) return;
  const list = document.createElement("div");
  list.className = "dm-thread-list";
  if (!data.threads.length) {
    const empty = document.createElement("p");
    empty.className = "chat-guest-note";
    empty.textContent = "No conversations yet. Open a profile and press Message.";
    list.append(empty);
  }
  for (const thread of data.threads) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "dm-thread-row";
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
    list.append(row);
  }
  host.replaceChildren(list);
}

async function pollDmThread() {
  if (!dmThread || !panel?.isConnected) return;
  const base = "/api/dms/" + dmThread.id;
  const data = await api(dmLastId > 0 ? base + "?after=" + dmLastId : base);
  const list = panel.querySelector("[data-dm-messages]");
  if (!list) return;
  for (const message of data.messages) {
    if (list.querySelector(`[data-dm-message-id="${message.id}"]`)) continue;
    renderChatMessage(panel.ownerDocument, list, message, chatUser, "dm");
    dmLastId = Math.max(dmLastId, Number(message.id));
  }
  list.scrollTop = list.scrollHeight;
}

export function setChatTab(tab) {
  activeTab = tab;
  if (!panel?.isConnected) return;
  const room = panel.querySelector("[data-chat-room]");
  const dms = panel.querySelector("[data-chat-dms]");
  if (room) room.hidden = tab !== "room";
  if (dms) dms.hidden = tab !== "dms";
  for (const button of panel.querySelectorAll("[data-chat-tab]")) {
    button.setAttribute("aria-selected", String(button.dataset.chatTab === tab));
  }
  if (tab === "dms") {
    dmThread ? pollDmThread() : refreshDmList();
  } else {
    pollRoom();
  }
}

// Open a thread from the conversation list (the row carries the id and the
// other member's name — everything the thread view needs).
export function openDmThread(threadId, otherUsername) {
  renderDmThread({ id: Number(threadId), otherUser: { username: otherUsername } });
}

export function backToDmList() {
  dmThread = null;
  refreshDmList();
}

// The DM thread view: back control, the other member's name, the message
// stream, and the send form. Replaces the conversation list in place.
function renderDmThread(thread) {
  if (!panel?.isConnected) return;
  const host = panel.querySelector("[data-chat-dms]");
  if (!host) return;
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
  input.setAttribute("aria-label", "Message " + thread.otherUser.username);
  form.append(input);
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "button button-primary";
  send.textContent = "Send";
  form.append(send);
  view.append(form);
  host.replaceChildren(view);
  pollDmThread();
}

// The /chat route's body: the room + DMs tab pair. app.js owns the page's
// heading and hands the container over; the cursors and open thread live in
// module state, so navigating away and back resumes rather than reloading.
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

  // Room/DMs tab pair — the same tab idiom as the feed's category tabs.
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

  // Invisible mode (Desen's ask): lurk without appearing online. Client-stored
  // like the theme; every heartbeat carries it, and the toggle fires one
  // immediately.
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
  lurk.append(invisibleBox, document.createTextNode(" Invisible — don't count me online"));
  head.append(lurk);

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

  // The DMs tab: hosts the conversation list or one thread view. Members
  // only — guests never see the tab.
  const dms = document.createElement("div");
  dms.dataset.chatDms = "";
  dms.hidden = true;
  page.append(head, room, dms);
  host.append(page);

  const dmTab = tabs.querySelector('[data-chat-tab="dms"]');
  if (dmTab) dmTab.hidden = !user;

  // A profile's Message button stashed a thread while off-route: land
  // directly in it.
  if (user && pendingDmThread) {
    const thread = pendingDmThread;
    pendingDmThread = null;
    setChatTab("dms");
    renderDmThread(thread);
  } else {
    setChatTab("room");
  }
  pollRoom();
}

// Start (or reopen) a DM with a named member — the profile Message button's
// handler. Find-or-creates the thread server-side; app.js then navigates to
// /chat, where the pending thread opens.
export async function openDmWith(username) {
  if (!chatUser) return;
  const data = await api("/api/dms", { method: "POST", body: { username } });
  pendingDmThread = data.thread;
}

// Session lifecycle: called by app.js whenever the session resolves (boot,
// sign-in, sign-out). Starts/stops the heartbeat; nothing panel-bound (the
// page renders per-visit with its own session-aware bits).
export function updateChatSession(user) {
  chatUser = user;
  if (user) sendHeartbeat();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = user ? setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS) : null;
}

// Boot: start the poll loop — the online count badge in the header stays
// fresh even off the chat page.
export function initChat() {
  if (pollTimer) return;
  pollRoom();
  pollTimer = setInterval(() => {
    pollRoom();
    if (panel?.isConnected && activeTab === "dms") {
      dmThread ? pollDmThread() : refreshDmList();
    }
  }, CHAT_POLL_MS);
}

// Room send: POST then append locally (the poll dedupe skips the echo).
export async function submitChatMessage(form) {
  const input = form.querySelector("input[name='body']");
  const body = String(input?.value ?? "").trim();
  if (!body) return;
  const data = await api("/api/chat", { method: "POST", body: { body } });
  if (panel?.isConnected && activeTab === "room") {
    appendRoomMessages([data.message]);
  } else {
    lastId = Math.max(lastId, Number(data.message.id));
  }
  if (input) input.value = "";
}

// DM send: same shape against the thread route.
export async function submitDmMessage(form) {
  const input = form.querySelector("input[name='body']");
  const body = String(input?.value ?? "").trim();
  if (!body || !dmThread) return;
  const data = await api("/api/dms/" + dmThread.id, { method: "POST", body: { body } });
  const list = panel?.querySelector("[data-dm-messages]");
  if (list) {
    renderChatMessage(panel.ownerDocument, list, data.message, chatUser, "dm");
    dmLastId = Math.max(dmLastId, Number(data.message.id));
    list.scrollTop = list.scrollHeight;
  }
  if (input) input.value = "";
}

export async function deleteChatMessage(button) {
  await api("/api/chat/" + button.dataset.chatMessageId, { method: "DELETE" });
  document.querySelector(`[data-chat-message-id="${button.dataset.chatMessageId}"]`)?.remove();
}

export async function deleteDmMessage(button) {
  await api("/api/dm-messages/" + button.dataset.chatMessageId, { method: "DELETE" });
  document.querySelector(`[data-dm-message-id="${button.dataset.chatMessageId}"]`)?.remove();
}
