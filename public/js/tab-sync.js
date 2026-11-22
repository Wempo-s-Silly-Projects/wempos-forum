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

// Batch K: bridges the in-page bus to the browser's native BroadcastChannel,
// so sign-out, the theme and unread counts follow across this browser's
// open tabs. Local only: BroadcastChannel never leaves the device. Heard
// messages are re-emitted under the remote* names (never re-broadcast), and
// an unread count already known is not posted again, so tabs cannot echo.
import { EVENTS } from "./event-bus.js";

export const TAB_SYNC_CHANNEL = "wempos-forum-sync";
const UNREAD_SOURCES = new Set(["notifications", "dms"]);
const THEMES = new Set(["light", "dark"]);

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

function relay(bus, lastUnread, data) {
  if (!data || typeof data !== "object") return;
  if (data.type === "signout") bus.emit(EVENTS.remoteSignout);
  else if (data.type === "theme" && THEMES.has(data.theme)) bus.emit(EVENTS.remoteTheme, data.theme);
  else if (data.type === "unread" && UNREAD_SOURCES.has(data.source) && isCount(data.count)) {
    lastUnread.set(data.source, data.count);
    bus.emit(EVENTS.remoteUnread, data.source, data.count);
  }
}

// Returns { close } or null when BroadcastChannel is missing or refused.
export function createTabSync({ bus, Channel = globalThis.BroadcastChannel } = {}) {
  if (typeof Channel !== "function") return null;
  let channel;
  try {
    channel = new Channel(TAB_SYNC_CHANNEL);
  } catch {
    return null;
  }
  const lastUnread = new Map();
  const post = (message) => {
    try {
      channel.postMessage(message);
    } catch {
      // A closed channel: nothing to sync.
    }
  };
  const unsubscribe = [
    bus.on(EVENTS.signout, () => post({ type: "signout" })),
    bus.on(EVENTS.theme, (theme) => {
      if (THEMES.has(theme)) post({ type: "theme", theme });
    }),
    bus.on(EVENTS.unread, (source, count) => {
      if (!UNREAD_SOURCES.has(source) || !isCount(count) || lastUnread.get(source) === count) return;
      lastUnread.set(source, count);
      post({ type: "unread", source, count });
    }),
  ];
  channel.onmessage = (event) => relay(bus, lastUnread, event?.data);
  return {
    close() {
      unsubscribe.forEach((off) => off());
      channel.onmessage = null;
      channel.close();
    },
  };
}
