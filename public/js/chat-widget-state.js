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

// Chat widget shared state (wave 2026-11-21-5 split): the panel's live values
// that the widget's feature modules (lobby, thread list, composer) all read
// and write, as one mutable property bag — the public/js/state.js idiom, since
// a `let` cannot be re-exported — plus the tiny DOM helpers they share.


export const ui = {
  badge: null,
  threadListEl: null,
  conversationEl: null,
  threads: [],
  // v4.7 group DMs ride the same probe (GET /api/dm/threads → groups); a
  // conversation is { kind: "dm" | "group", id } and kind defaults to "dm".
  groups: [],
  activeThread: null,
  conversation: null, // GET /api/dm/threads/:id result for activeThread
  open: false,
  composerEl: null,
  sendButton: null,
  newChatFormEl: null,
  listSideEl: null,
  // The Lobby tab's state: the old chat module's cursors and guards, scoped to
  // the widget. Session identity rides ONE /api/session probe per panel open —
  // it decides the mine marker and the staff-only delete arm. The presence
  // beacon stays with who-online.js; this module never sends it.
  lobbyEl: null,
  lobbyOnlineEl: null,
  lobbyMessagesEl: null,
  lobbyAvailable: false,
  lobbyLog: [],
  lobbyLastId: 0,
  widgetUser: null,
  // The GIF picker: the approved library list is read once per panel open; the
  // DM picker survives the conversation's 5s full repaint (its nodes are
  // re-attached, not rebuilt).
  gifLibrary: null,
  dmGifPicker: null,
  // Message effects (opt-in): the switch's state, and the newest message id
  // painted per conversation so only fresh arrivals pop.
  effectsOn: false,
  lastPainted: { key: null, maxId: 0 },
};

export const kindOf = (conversation) => (conversation?.kind === "group" ? "group" : "dm");
export const conversationKey = (conversation) => `${kindOf(conversation)}:${conversation?.id ?? ""}`;
export const sameConversation = (a, b) => Boolean(a && b) && conversationKey(a) === conversationKey(b);

export const el = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// DM polish: the initial-circle avatar the DM rail and the conversation's
// theirs rows ride. Role seats are colored from the forum's role-badge tokens
// when the payload carries one.
export const buildAvatar = (other) => {
  const username = typeof other?.username === "string" ? other.username : "?";
  const circle = el("span", "chat-widget-avatar", username.charAt(0).toUpperCase() || "?");
  circle.setAttribute("aria-hidden", "true");
  if (other?.role === "owner" || other?.role === "admin") {
    circle.classList.add("role-badge-" + other.role);
  }
  return circle;
};
