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

// Wave 5.9 F1: the "New messages" line in an open DM or group chat. A fresh
// open reads the conversation payload's own unread count and remembers which
// message was the first one the reader had not seen; the 5s silent repaint
// never moves it. Nothing is stored and nothing is sent.
import { tn } from "./i18n.js";

export const NO_NEW_MARKER = Object.freeze({ key: null, id: null, count: 0 });

// messages: newest-first (the API's order). The unread ones are the newest
// `unread` messages written by someone else; the line goes above the oldest
// of them. More unread than the loaded page clamps to the oldest loaded.
export const firstUnreadId = (messages, unread) => {
  const count = Number(unread);
  if (!Number.isInteger(count) || count <= 0 || !Array.isArray(messages)) return null;
  const theirs = messages.filter((message) => message && !message.mine);
  if (!theirs.length) return null;
  return theirs[Math.min(count, theirs.length) - 1].id ?? null;
};

export const newMarkerFor = (key, data) => {
  const id = firstUnreadId(data?.messages, data?.unread);
  return id === null ? NO_NEW_MARKER : { key, id, count: Number(data.unread) };
};

export const buildNewDivider = (document, count) => {
  const divider = document.createElement("div");
  divider.className = "chat-widget-new-divider";
  divider.setAttribute("role", "separator");
  divider.textContent = tn("dm.newMessages", count);
  return divider;
};
