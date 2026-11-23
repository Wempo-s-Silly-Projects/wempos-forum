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

// Chat widget loader (v5.84 load order). index.html loads this instead of
// chat-widget.js, so the widget's ~14 modules no longer compete with the
// page itself. The widget is imported once the page is idle (with a short
// deadline, so the launcher and its unread badge still appear promptly), or
// earlier when something opens a conversation (the profile "Chat" button).
// Once imported, chat-widget.js boots exactly as before: its single probe,
// the badge, the 30s unread poll and the bus events are unchanged.
import { siteModuleOn } from "./site-modules.js";

// The longest the widget waits for an idle moment.
export const CHAT_WIDGET_IDLE_TIMEOUT_MS = 2000;
// Without requestIdleCallback: one tick after the page's own scripts.
export const CHAT_WIDGET_FALLBACK_DELAY_MS = 200;

let loading = null;

// Imports the widget once; a failed import is forgotten so a later call
// (the next idle slot or a profile Chat press) retries.
export function loadChatWidget(importWidget = () => import("./chat-widget.js")) {
  if (!loading) {
    loading = importWidget();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

// requestIdleCallback when the browser has it, else a short timeout. Nothing
// is scheduled while the owner has the "chat" module off (docs/modules.md).
export function scheduleChatWidget(win = globalThis, load = () => loadChatWidget()) {
  if (!siteModuleOn("chat", win.document)) return;
  const run = () => { load().catch(() => null); };
  if (typeof win.requestIdleCallback === "function") {
    win.requestIdleCallback(run, { timeout: CHAT_WIDGET_IDLE_TIMEOUT_MS });
  } else if (typeof win.setTimeout === "function") {
    win.setTimeout(run, CHAT_WIDGET_FALLBACK_DELAY_MS);
  }
}

if (typeof document !== "undefined") scheduleChatWidget();
