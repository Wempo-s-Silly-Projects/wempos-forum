// Chat widget: the floating launcher in the bottom-right corner and the panel
// that expands above it. The widget is its own little client — it rides the
// shared api() wrapper (fetch only), it mounts itself on import, and it stays
// INERT for signed-out visitors: the single boot probe GET /api/dm/threads
// decides everything (a 401/404/503 leaves no DOM and no polling behind).
// Polling while the panel is open refreshes the thread list and the open
// conversation every 5s; while closed, an unread-counter refresh rides every
// 30s. Every timer sleeps while document.hidden — background tabs make no
// requests. Sends are single-flight: the in-flight flag and the disabled
// button both gate the action, so Enter and a double click can never queue
// two POSTs for one message (the 11-12 double-send defect, killed at the UI).
import { api } from "./api.js";

const PANEL_POLL_MS = 5_000;
const UNREAD_POLL_MS = 30_000;
const PANEL_WIDTH_MAX = 360;
const MESSAGE_PREVIEW_MAX = 60;

let launcher = null;
let badge = null;
let panel = null;
let threadListEl = null;
let conversationEl = null;

let threads = [];
let activeThread = null;
let conversation = null; // GET /api/dm/threads/:id result for activeThread
let open = false;
let sendInFlight = false;
let panelTimer = null;
let unreadTimer = null;
let composerEl = null;
let sendButton = null;

const relativeTime = (iso) => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
};

const el = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const loadThreads = async () => {
  const data = await api("/api/dm/threads");
  return Array.isArray(data?.threads) ? data.threads : [];
};

// The one boot decision: a successful thread read mounts the widget; every
// failure (signed-out 401, the endpoint still landing, a 503) leaves the
// module invisible — no launcher, no timers.
const boot = async () => {
  if (document.querySelector(".chat-widget-launcher")) return;
  try {
    threads = await loadThreads();
  } catch {
    return;
  }
  launcher = el("button", "chat-widget-launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Chat");
  launcher.setAttribute("aria-expanded", "false");
  const glyph = el("span", "chat-widget-glyph", "💬");
  glyph.setAttribute("aria-hidden", "true");
  badge = el("span", "chat-widget-badge");
  badge.hidden = true;
  launcher.append(glyph, badge);
  launcher.addEventListener("click", togglePanel);
  document.body.append(launcher);
  paintBadge();
  unreadTimer = setInterval(() => {
    if (document.hidden || open) return;
    refreshUnread().catch(() => { /* transient — the badge keeps its last value */ });
  }, UNREAD_POLL_MS);
};

const refreshUnread = async () => {
  threads = await loadThreads();
  paintBadge();
  if (open && !activeThread) paintThreadList();
};

const paintBadge = () => {
  if (!badge) return;
  const total = threads.reduce((sum, thread) => sum + (thread.unread || 0), 0);
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
  panel.setAttribute("aria-label", "Direct messages");
  threadListEl = el("div", "chat-widget-threads");
  conversationEl = el("div", "chat-widget-conversation");
  conversationEl.hidden = true;
  panel.append(threadListEl, conversationEl);
  document.body.append(panel);
  paintThreadList();
  panelTimer = setInterval(() => {
    if (document.hidden) return;
    const refresh = [refreshUnread().catch(() => { /* keep painted data */ })];
    if (activeThread) refresh.push(openThread(activeThread, { silent: true }));
    Promise.all(refresh).catch(() => { /* next tick retries */ });
  }, PANEL_POLL_MS);
  const data = await api("/api/dm/threads").catch(() => null);
  if (data) {
    threads = Array.isArray(data.threads) ? data.threads : threads;
    paintBadge();
    if (!activeThread) paintThreadList();
  }
};

const closePanel = () => {
  open = false;
  launcher.setAttribute("aria-expanded", "false");
  clearInterval(panelTimer);
  panelTimer = null;
  panel.remove();
  panel = null;
  threadListEl = null;
  conversationEl = null;
  composerEl = null;
  sendButton = null;
  activeThread = null;
  conversation = null;
};

const paintThreadList = () => {
  if (!threadListEl) return;
  threadListEl.replaceChildren();
  addTextHeading(threadListEl);
  if (threads.length === 0) {
    threadListEl.append(el("p", "chat-widget-empty", "No chats yet. Say hi from a profile or wait for a message:3"));
    return;
  }
  for (const thread of threads) {
    const row = el("button", "chat-widget-thread");
    row.type = "button";
    const name = el("span", "chat-widget-thread-name", thread.other?.username || "unknown");
    if (thread.unread > 0) name.classList.add("has-unread");
    const preview = el("span", "chat-widget-thread-preview", previewOf(thread));
    const time = el("span", "chat-widget-thread-time", thread.lastMessageAt ? relativeTime(thread.lastMessageAt) : "");
    time.title = thread.lastMessageAt || "";
    row.append(name, preview, time);
    row.addEventListener("click", () => openThread(thread).catch(() => { /* the row stays clickable */ }));
    threadListEl.append(row);
  }
};

const previewOf = (thread) => {
  const preview = typeof thread.lastMessagePreview === "string" ? thread.lastMessagePreview : "";
  if (thread.unread > 0) return preview;
  const clipped = preview.length > MESSAGE_PREVIEW_MAX
    ? `${preview.slice(0, MESSAGE_PREVIEW_MAX - 1)}…` : preview;
  return clipped || "No messages yet";
};

const addTextHeading = (parent) => {
  const heading = el("div", "chat-widget-head");
  heading.append(el("span", "chat-widget-title", "Chats"));
  const close = el("button", "chat-widget-close");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close chat panel");
  close.addEventListener("click", closePanel);
  heading.append(close);
  parent.append(heading);
};

const openThread = async (thread, { silent = false } = {}) => {
  if (!silent) {
    activeThread = thread;
    conversation = null;
  }
  if (!activeThread || activeThread.id !== thread.id) return;
  const data = await api(`/api/dm/threads/${encodeURIComponent(thread.id)}`);
  if (!open || activeThread?.id !== thread.id) return;
  conversation = data;
  if (data.unread > 0) {
    api(`/api/dm/threads/${encodeURIComponent(thread.id)}/read`, { method: "POST" })
      .then(() => {
        const painted = threads.find((row) => row.id === thread.id);
        if (painted) painted.unread = 0;
        paintBadge();
      })
      .catch(() => { /* the next poll re-acks */ });
  }
  paintConversation();
  const threadRow = threads.find((row) => row.id === thread.id);
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
  conversationEl.replaceChildren();
  const back = el("button", "chat-widget-back");
  back.type = "button";
  back.textContent = "← All chats";
  back.addEventListener("click", () => {
    activeThread = null;
    conversation = null;
    conversationEl.hidden = true;
    threadListEl.hidden = false;
    paintThreadList();
  });
  const title = el("span", "chat-widget-peer", conversation.other?.username || "unknown");
  conversationEl.append(back, title);
  const messages = [...(conversation.messages || [])].reverse();
  const scroll = el("div", "chat-widget-messages");
  for (const message of messages) {
    const bubble = el("div", message.mine ? "chat-widget-message mine" : "chat-widget-message");
    if (!message.mine) bubble.append(el("span", "chat-widget-message-who", message.authorUsername || ""));
    const body = el("p", "chat-widget-message-body", message.body);
    const time = el("span", "chat-widget-message-time", relativeTime(message.createdAt));
    time.title = message.createdAt || "";
    bubble.append(who, body, time);
    scroll.append(bubble);
  }
  const older = el("button", "chat-widget-older");
  older.type = "button";
  older.textContent = "Load older";
  older.hidden = messages.length === 0;
  const oldest = messages[0];
  older.addEventListener("click", async () => {
    if (!oldest) return;
    try {
      const data = await api(`/api/dm/threads/${encodeURIComponent(activeThread.id)}?after=${encodeURIComponent(oldest.id)}`);
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
  composerEl.placeholder = "Write a message…";
  composerEl.setAttribute("aria-label", `Message ${title.textContent}`);
  composerEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  sendButton = el("button", "button button-primary chat-widget-send");
  sendButton.type = "button";
  sendButton.textContent = "Send";
  sendButton.addEventListener("click", sendMessage);
  composer.append(composerEl, sendButton);
  conversationEl.append(composer);
  conversationEl.hidden = false;
  if (threadListEl) threadListEl.hidden = true;
};

const sendMessage = async () => {
  if (sendInFlight || !activeThread || !composerEl) return;
  const body = composerEl.value.trim();
  if (!body) return;
  sendInFlight = true;
  sendButton.disabled = true;
  try {
    const data = await api(`/api/dm/threads/${encodeURIComponent(activeThread.id)}`, {
      method: "POST",
      body: { body },
    });
    composerEl.value = "";
    if (data?.message?.id && !((conversation?.messages || []).some((row) => row.id === data.message.id))) {
      conversation = { ...conversation, messages: [...(conversation.messages || []), data.message] };
    }
    paintConversation();
    refreshUnread().catch(() => { /* badge catches up on its next tick */ });
  } catch (error) {
    showSendError(error?.message || "The message did not send. Try again.");
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
  const note = el("p", "chat-widget-send-error", message);
  composer.before(note);
};

await boot();

export { boot as initChatWidget };
