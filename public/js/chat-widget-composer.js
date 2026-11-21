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

// Chat widget conversation and composer (wave 2026-11-21-5 split): the open
// DM or group conversation, its scrollback, the composer (draft carried across
// the 5s repaint), and the single-flight text, GIF and image sends.
import { api } from "./api.js";
import { t } from "./i18n.js";
import { focusSelector, isImeComposing, restoreFocus } from "./focus-utils.js";
import { MAX_PINNED_CHATS, isPinned, readPins, togglePin, writePins } from "./chat-pins.js";
import { MAX_MUTED_CHATS, isMuted, readMutes, toggleMute, writeMutes } from "./chat-mutes.js";
import {
  buildGroupManage, buildImageButton, conversationBase, groupTitle, uploadDmImage,
} from "./dm-extras.js";
import { buildAvatar, conversationKey, el, kindOf, sameConversation, ui } from "./chat-widget-state.js";
import { buildGifPicker, gifToken, messageBodyNode } from "./chat-widget-gifs.js";
import { dropGroup, paintBadge, paintThreadList, refreshUnread } from "./chat-widget-threads.js";
import { relativeTime } from "./chat-widget.js";
import { buildNewDivider, newMarkerFor } from "./chat-new-divider.js";

let sendInFlight = false;

export const openThread = async (thread, { silent = false } = {}) => {
  if (!silent) {
    ui.activeThread = thread;
    ui.conversation = null;
  }
  if (!sameConversation(ui.activeThread, thread)) return;
  let data;
  try {
    data = await api(conversationBase(thread));
  } catch (error) {
    // v4.11: removed from a group (or it is gone) — the one 404 drops the
    // group from both cached pages and lands the reader back on the list.
    if (error?.status === 404 && kindOf(thread) === "group") leaveGoneGroup(thread);
    throw error;
  }
  if (!ui.open || !sameConversation(ui.activeThread, thread)) return;
  ui.conversation = { ...data, kind: kindOf(thread) };
  // Wave 5.9 F1: a fresh open remembers where the unread run starts; the 5s
  // silent repaint never moves the line.
  if (!silent) ui.newSince = newMarkerFor(conversationKey(thread), data);
  if (data.unread > 0) {
    api(`${conversationBase(thread)}/read`, { method: "POST" })
      .then(() => {
        const listed = [...ui.threads, ...ui.groups].find((row) => sameConversation(row, thread));
        if (ui.dmUnread !== null) ui.dmUnread = Math.max(0, ui.dmUnread - (listed?.unread || 0));
        const clear = (row) => (sameConversation(row, thread) ? { ...row, unread: 0 } : row);
        ui.threads = ui.threads.map(clear);
        ui.groups = ui.groups.map(clear);
        paintBadge();
      })
      .catch(() => { /* the next poll re-acks */ });
  }
  paintConversation();
  const threadRow = [...ui.threads, ...ui.groups].find((row) => sameConversation(row, thread));
  if (threadRow && !silent) paintThreadList();
};

const leaveGoneGroup = (thread) => {
  dropGroup(thread.id);
  if (sameConversation(ui.activeThread, thread)) {
    ui.activeThread = null;
    ui.conversation = null;
    ui.dmGifPicker = null;
    if (ui.conversationEl) ui.conversationEl.hidden = true;
    if (ui.listSideEl) ui.listSideEl.hidden = false;
  }
  paintThreadList();
  refreshUnread().catch(() => { /* the badge catches up on its next tick */ });
};

// The conversation paints oldest-first (the API returns newest-first, so the
// display flips a copy — the source array is never mutated). New messages
// from the 5s poll keep the scroll pinned to the bottom only when the reader
// already sat there.
// Pinned chats (v4.10): the header toggle. A full pin list disables an add
// with a note instead of silently dropping an older pin. The label stays
// "Pin chat"; aria-pressed alone carries the state (v4.13). The full-list
// note is visible text tied by aria-describedby, not a hover-only title.
const PIN_NOTE_ID = "chat-widget-pin-note";
const buildPinToggle = (current) => {
  const key = conversationKey(current);
  const accountId = ui.widgetUser?.id;
  // No account id yet: no pin toggle (pins are per account, never unscoped).
  if (!accountId) return [];
  const pins = readPins(undefined, accountId);
  const pinned = isPinned(pins, key);
  const toggle = el("button", "chat-widget-pin", t("dm.pinChat"));
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", String(pinned));
  toggle.addEventListener("click", () => {
    writePins(undefined, togglePin(readPins(undefined, accountId), key), accountId);
    paintConversation();
  });
  if (pinned || pins.length < MAX_PINNED_CHATS) return [toggle];
  toggle.disabled = true;
  const note = el("span", "chat-widget-pin-note", t("dm.pinFull", { count: MAX_PINNED_CHATS }));
  note.id = PIN_NOTE_ID;
  toggle.setAttribute("aria-describedby", PIN_NOTE_ID);
  return [toggle, note];
};

// Muted chats (v4.31): the header toggle beside Pin. Muting silences this
// chat's unread on the launcher badge only (local, per account); aria-pressed
// carries the state, a full list disables an add with a visible note.
const MUTE_NOTE_ID = "chat-widget-mute-note";
const buildMuteToggle = (current) => {
  const key = conversationKey(current);
  const accountId = ui.widgetUser?.id;
  if (!accountId) return [];
  const mutes = readMutes(undefined, accountId);
  const muted = isMuted(mutes, key);
  const toggle = el("button", "chat-widget-mute", t("dm.muteChat"));
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", String(muted));
  toggle.addEventListener("click", () => {
    writeMutes(undefined, toggleMute(readMutes(undefined, accountId), key), accountId);
    paintBadge();
    paintConversation();
  });
  if (muted || mutes.length < MAX_MUTED_CHATS) return [toggle];
  toggle.disabled = true;
  const note = el("span", "chat-widget-pin-note", t("dm.muteFull", { count: MAX_MUTED_CHATS }));
  note.id = MUTE_NOTE_ID;
  toggle.setAttribute("aria-describedby", MUTE_NOTE_ID);
  return [toggle, note];
};

export const paintConversation = () => {
  if (!ui.conversationEl || !ui.conversation) return;
  // The reader's scroll: a full re-render (the 5s poll replaces every node)
  // keeps the bottom pinned only when the reader already sat there.
  const previousScroll = ui.conversationEl.querySelector(".chat-widget-messages");
  const pinned = previousScroll
    ? previousScroll.scrollHeight - previousScroll.scrollTop - previousScroll.clientHeight < 60
    : true;
  // The 5s poll rebuilds the composer; carry a half-typed draft (and focus)
  // over — but only within the SAME thread, never into another conversation.
  const draft = ui.composerEl && ui.composerEl.value
    ? { threadId: ui.composerEl.dataset.threadId, value: ui.composerEl.value,
      focused: document.activeElement === ui.composerEl,
      start: ui.composerEl.selectionStart, end: ui.composerEl.selectionEnd }
    : null;
  // The group strip's open state and half-typed add-member name survive the
  // repaint too — same conversation only.
  const sameAsBefore = ui.composerEl?.dataset.threadId === conversationKey(ui.conversation);
  const manageWasOpen = sameAsBefore && Boolean(ui.conversationEl.querySelector(".chat-widget-group-manage")?.open);
  const addDraft = sameAsBefore ? ui.conversationEl.querySelector(".chat-widget-group-add-input")?.value || "" : "";
  // v4.31: a half-typed rename survives too (null = nothing to carry).
  const renameInput = sameAsBefore ? ui.conversationEl.querySelector(".chat-widget-group-rename-input") : null;
  const renameDraft = renameInput ? renameInput.value : null;
  // Keyboard focus (pin toggle, add-member input, remove buttons, an empty
  // composer) survives the repaint too — same conversation only.
  const keptFocus = sameAsBefore ? focusSelector(ui.conversationEl, document.activeElement) : null;
  ui.conversationEl.replaceChildren();
  const back = el("button", "chat-widget-back");
  back.type = "button";
  back.textContent = t("chat.allChats");
  back.addEventListener("click", () => {
    ui.dmGifPicker = null;
    ui.activeThread = null;
    ui.conversation = null;
    ui.conversationEl.hidden = true;
    ui.listSideEl.hidden = false;
    paintThreadList();
  });
  const isGroup = kindOf(ui.conversation) === "group";
  const title = el("span", "chat-widget-peer", isGroup
    ? groupTitle(ui.conversation, ui.widgetUser?.id) : ui.conversation.other?.username || "unknown");
  ui.conversationEl.append(back, title, ...buildPinToggle(ui.conversation), ...buildMuteToggle(ui.conversation));
  if (isGroup) {
    const leaveToList = () => {
      const leftKey = conversationKey(ui.conversation);
      ui.olderGroups = ui.olderGroups.filter((group) => conversationKey(group) !== leftKey);
      back.click();
      return refreshUnread();
    };
    const manage = buildGroupManage(ui.conversation, {
      viewerId: ui.widgetUser?.id,
      onChange: () => openThread(ui.activeThread, { silent: true }),
      onLeft: leaveToList,
      onError: showSendError,
    });
    manage.open = manageWasOpen;
    const addInput = manage.querySelector(".chat-widget-group-add-input");
    if (addInput) addInput.value = addDraft;
    const renameField = manage.querySelector(".chat-widget-group-rename-input");
    if (renameField && renameDraft !== null) renameField.value = renameDraft;
    ui.conversationEl.append(manage);
  }
  const messages = [...(ui.conversation.messages || [])].reverse();
  const scroll = el("div", "chat-widget-messages");
  // Pop only messages newer than the last paint of THIS conversation.
  const key = conversationKey(ui.conversation);
  const popAfter = ui.lastPainted.key === key ? ui.lastPainted.maxId : Infinity;
  const maxId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
  ui.lastPainted = { key, maxId: Math.max(maxId, ui.lastPainted.key === key ? ui.lastPainted.maxId : 0) };
  for (const message of messages) {
    if (ui.newSince.key === key && Number(message.id) === Number(ui.newSince.id)) {
      scroll.append(buildNewDivider(document, ui.newSince.count));
    }
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
      const data = await api(`${conversationBase(ui.activeThread)}?after=${encodeURIComponent(oldest.id)}`);
      const more = Array.isArray(data?.messages) ? data.messages : [];
      ui.conversation = { ...ui.conversation, messages: [...more, ...(ui.conversation.messages || [])] };
      paintConversation();
    } catch { /* the button stays for the next try */ }
  });
  scroll.prepend(older);
  ui.conversationEl.append(scroll);
  if (pinned) scroll.scrollTop = scroll.scrollHeight;
  const composer = el("div", "chat-widget-composer");
  ui.composerEl = el("textarea", "chat-widget-input");
  ui.composerEl.rows = 1;
  ui.composerEl.placeholder = t("chat.writeMessage");
  ui.composerEl.setAttribute("aria-label", t("chat.messageUser", { name: title.textContent }));
  ui.composerEl.dataset.threadId = conversationKey(ui.activeThread);
  if (draft && draft.threadId === ui.composerEl.dataset.threadId) {
    ui.composerEl.value = draft.value;
    if (draft.focused) {
      const restored = ui.composerEl;
      queueMicrotask(() => {
        restored.focus();
        restored.setSelectionRange(draft.start, draft.end);
      });
    }
  }
  ui.composerEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !isImeComposing(event)) {
      event.preventDefault();
      sendMessage();
    }
  });
  ui.sendButton = el("button", "button button-primary chat-widget-send");
  ui.sendButton.type = "button";
  ui.sendButton.textContent = t("common.send");
  ui.sendButton.addEventListener("click", sendMessage);
  if (!ui.dmGifPicker) ui.dmGifPicker = buildGifPicker((gifId) => sendDmBody(gifToken(gifId)));
  const imageButton = buildImageButton(sendDmImage);
  composer.append(ui.dmGifPicker.grid, ui.composerEl, imageButton, ui.dmGifPicker.toggle, ui.sendButton);
  ui.conversationEl.append(composer);
  ui.conversationEl.hidden = false;
  if (ui.listSideEl) ui.listSideEl.hidden = true;
  restoreFocus(ui.conversationEl, keptFocus);
};

const sendMessage = () => sendDmBody(ui.composerEl ? ui.composerEl.value.trim() : "", { clearComposer: true });

// One DM send (typed text or a GIF token); a GIF send leaves the typed draft.
const sendDmBody = async (body, { clearComposer = false } = {}) => {
  if (sendInFlight || !ui.activeThread || !ui.composerEl) return;
  if (!body) return;
  sendInFlight = true;
  ui.sendButton.disabled = true;
  try {
    const data = await api(conversationBase(ui.activeThread), {
      method: "POST",
      body: { body },
    });
    if (clearComposer && ui.composerEl) ui.composerEl.value = "";
    landSentMessage(data);
  } catch (error) {
    showSendError(error?.message || t("chat.sendFailed"));
  } finally {
    sendInFlight = false;
    if (ui.sendButton) ui.sendButton.disabled = false;
  }
};

// The send's success arm, shared by text and image sends: add the stored
// message once (newest-first array, so the poll's copy dedupes by id).
const landSentMessage = (data) => {
  if (data?.message?.id && !((ui.conversation?.messages || []).some((row) => row.id === data.message.id))) {
    ui.conversation = { ...ui.conversation, messages: [data.message, ...(ui.conversation.messages || [])] };
  }
  paintConversation();
  refreshUnread().catch(() => { /* ui.badge catches up on its next tick */ });
};

// One image send (v4.7): multipart through the same single-flight gate.
const sendDmImage = async (file) => {
  if (sendInFlight || !ui.activeThread || !file) return;
  sendInFlight = true;
  if (ui.sendButton) ui.sendButton.disabled = true;
  try {
    landSentMessage(await uploadDmImage(ui.activeThread, file));
  } catch (error) {
    showSendError(error?.message || t("chat.sendFailed"));
  } finally {
    sendInFlight = false;
    if (ui.sendButton) ui.sendButton.disabled = false;
  }
};

// The refusal paints a single line above the composer (textContent only);
// the next successful render wipes it.
export const showSendError = (message) => {
  const composer = ui.composerEl?.closest(".chat-widget-composer");
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
