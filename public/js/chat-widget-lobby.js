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

// Chat widget Lobby tab (wave 2026-11-21-5 split): the public room stream,
// its online line, the send form, and the staff-only delete.
import { api } from "./api.js";
import { currentLocale, t, tn } from "./i18n.js";
import { el, ui } from "./chat-widget-state.js";
import { buildGifPicker, gifToken, messageBodyNode } from "./chat-widget-gifs.js";
import { REPLY_BODY_MAX, withReplyMention } from "./lobby-reply.js";
import { createQuoteCardButton } from "./quote-card-action.js";
import { replaceFieldRange } from "./field-edit.js";
import { createEmojiButton } from "./emoji-picker.js";
import { attachMentionPicker } from "./mention-lazy.js";

const LOBBY_MESSAGE_MAX = REPLY_BODY_MAX;

let lobbyOnline = 0;
let lobbyVersion = 0;
let lobbySendInFlight = false;
let lobbyInputEl = null;

const isStaff = () => Boolean(ui.widgetUser && (ui.widgetUser.role === "owner" || ui.widgetUser.role === "admin"));

// ----------
// The Lobby tab: the old /chat page's public stream inside the widget. GET
// /api/chat?after=<id> carries new room messages plus the online count (the
// retired shape the backend lane restored); POST /api/chat sends; the
// staff-only × deletes through DELETE /api/chat/:id. The old class family
// (chat-message, role badges) and the old poll rhythm (15s) ride verbatim.
// ----------

// The background poll should quietly retry on the next interval rather than
// create unhandled promise rejections during temporary network failures.
export const pollLobbySafely = () => {
  pollLobby().catch(() => {});
};

// The Lobby tab's DOM: the online count line, the old stream list, the send
// form. Built once per panel open.
export const buildLobby = () => {
  const host = el("div", "chat-widget-lobby");
  host.hidden = true;
  ui.lobbyOnlineEl = el("p", "chat-online chat-widget-lobby-online");
  const list = el("div", "chat-messages");
  list.dataset.chatMessages = "";
  ui.lobbyMessagesEl = list;
  const form = el("form", "chat-widget-lobby-send");
  const input = el("input", "chat-widget-lobby-input");
  input.type = "text";
  input.name = "body";
  input.maxLength = LOBBY_MESSAGE_MAX;
  input.required = true;
  input.placeholder = t("chat.messageLobby");
  input.setAttribute("aria-label", t("chat.messageLobby"));
  lobbyInputEl = input;
  const send = el("button", "button button-primary chat-widget-lobby-send-button", t("common.send"));
  send.type = "submit";
  const gifPicker = buildGifPicker((gifId) => sendLobbyBody(gifToken(gifId), null));
  // Batch H: emoji picker (opens above the send box) and @mention suggestions.
  const emoji = createEmojiButton(input, document, { host: form });
  form.append(gifPicker.grid, input, emoji, gifPicker.toggle, send);
  attachMentionPicker(input, document);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendLobbyMessage(input);
  });
  host.append(ui.lobbyOnlineEl, ui.lobbyMessagesEl, form);
  return host;
};

// One stream row, the old renderChatMessage's room arm byte-kin: the author
// name, the role badge, the absolute timestamp, the filtered body — textContent
// only — and the staff-only delete control.
const lobbyMessageRow = (message) => {
  const row = el("div", "chat-message");
  row.dataset.chatMessageId = String(message.id);
  if (ui.widgetUser && Number(ui.widgetUser.id) === Number(message.author.id)) {
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
  if (!row.classList.contains("chat-mine")) row.append(buildReplyButton(message));
  const quoteCard = createQuoteCardButton(document, message, ui.widgetUser);
  if (quoteCard) row.append(quoteCard);
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

// The boot probe's seed (GET /api/chat at mount): the newest page, the cursor
// past it, and the online count — painted by paintLobbyLog on each open.
export const seedLobby = (data) => {
  ui.lobbyLog = Array.isArray(data?.messages) ? data.messages : [];
  ui.lobbyLastId = Number(data?.lastId || 0);
  lobbyOnline = Number(data?.online || 0);
};

// Reply (v4.11): prefill "@name " into the send box, keep the typed draft,
// and put the cursor at the end — the send's own @mention ping does the rest.
const buildReplyButton = (message) => {
  const reply = el("button", "chat-message-reply", t("chat.reply"));
  reply.type = "button";
  reply.setAttribute("aria-label", t("chat.replyTo", { name: message.author.username }));
  reply.addEventListener("click", () => {
    if (!lobbyInputEl) return;
    // Batch H: through field-edit.js, so Ctrl/Cmd+Z takes the prefill back.
    const next = withReplyMention(lobbyInputEl.value, message.author.username);
    replaceFieldRange(lobbyInputEl, 0, lobbyInputEl.value.length, next);
    lobbyInputEl.focus();
    lobbyInputEl.setSelectionRange(lobbyInputEl.value.length, lobbyInputEl.value.length);
  });
  return reply;
};

// Paint the whole stream (each panel open re-renders the carried log; the
// poll's after= cursor and id dedupe keep the next tick from repainting it).
export const paintLobbyLog = () => {
  if (!ui.lobbyMessagesEl) return;
  ui.lobbyMessagesEl.replaceChildren();
  for (const message of ui.lobbyLog) {
    ui.lobbyMessagesEl.append(lobbyMessageRow(message));
  }
  ui.lobbyMessagesEl.scrollTop = ui.lobbyMessagesEl.scrollHeight;
  if (ui.lobbyOnlineEl) ui.lobbyOnlineEl.textContent = lobbyOnlineText();
};

// Incoming lobby messages: append, deduped by id (the poll's echo-safe arm).
const appendLobbyMessages = (messages) => {
  if (!ui.lobbyMessagesEl || !Array.isArray(messages)) return;
  for (const message of messages) {
    if (!message || message.id == null) continue;
    if (ui.lobbyLog.some((row) => row.id === message.id)) continue;
    ui.lobbyLog = [...ui.lobbyLog, message];
    ui.lobbyMessagesEl.append(lobbyMessageRow(message));
    if (Number(message.id) > ui.lobbyLastId) ui.lobbyLastId = Number(message.id);
  }
  ui.lobbyMessagesEl.scrollTop = ui.lobbyMessagesEl.scrollHeight;
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
    ui.lobbyLastId > 0 ? "/api/chat?after=" + ui.lobbyLastId : "/api/chat",
  );
  if (!ui.open || requestedVersion !== lobbyVersion) return;
  ui.lobbyAvailable = true;
  lobbyOnline = Number(data?.online || 0);
  if (ui.lobbyOnlineEl) ui.lobbyOnlineEl.textContent = lobbyOnlineText();
  appendLobbyMessages(Array.isArray(data?.messages) ? data.messages : []);
  const nextLastId = Number(data?.lastId || 0);
  if (nextLastId > ui.lobbyLastId) ui.lobbyLastId = nextLastId;
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
    // A landed send retires the previous refusal's line (wave 5.6 F3).
    ui.lobbyEl?.querySelector(".chat-widget-lobby-error")?.remove();
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
  if (!ui.lobbyEl) return;
  const existing = ui.lobbyEl.querySelector(".chat-widget-lobby-error");
  if (existing) {
    existing.textContent = message;
    return;
  }
  ui.lobbyEl.append(el("p", "chat-widget-lobby-error", message));
};

// Staff cleanup, the old deleteChatMessage's shape: the row and the carried
// log both drop the message (the log is filtered to a new array).
const deleteLobbyMessage = async (button) => {
  await api("/api/chat/" + button.dataset.chatMessageId, { method: "DELETE" });
  const removedId = Number(button.dataset.chatMessageId);
  ui.lobbyLog = ui.lobbyLog.filter((row) => Number(row.id) !== removedId);
  button.closest("[data-chat-message-id]")?.remove();
};
