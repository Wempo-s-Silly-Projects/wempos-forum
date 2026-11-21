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

// v4.0 plan 4 Task 7: the notifications concern — the /notifications route
// (guest gate + renderNotificationsPage for members) and its actions (mark
// one read on open, mark all read). Bodies moved verbatim out of app.js.
import { api } from "../api.js";
import { addHeading, element, main, setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import { renderNotificationsPage, updateBell } from "../notifications.js";
// The §4b door-swap: the guest gate's sign-in prompt is the Accounts handoff.
import { wempoAccountsSignInUrl } from "../sso.js";
import { t } from "../i18n.js";

async function renderNotificationsRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, t("notificationsPage.title"), 1);
    addText(document, main, "p", t("notificationsPage.signInPrompt"), "muted");
    const signIn = element("a", "button button-secondary", t("common.signIn"));
    signIn.href = wempoAccountsSignInUrl(location.origin);
    main.append(signIn);
    return;
  }
  const data = await api("/api/me/notifications");
  if (version !== state.renderVersion) return;
  renderNotificationsPage(main, data.notifications);
}

async function openNotification(button) {
  // Mark-first is idempotent server-side; navigation then re-renders the bell
  // with a fresh unread count from GET /api/session. Label-only rows (appeal
  // outcomes, chat pings — no post target) just mark read.
  await api("/api/me/notifications/" + button.dataset.notificationId + "/read", {
    method: "POST",
  });
  if (button.dataset.postId) {
    state.router.navigate("/posts/" + button.dataset.postId);
  } else {
    await state.renderRoute({ name: "notifications" });
  }
}

// v4.21: a grouped thread row — mark that thread's reply notifications read
// in one call (own rows only, server-side), then open the thread.
async function openNotificationThread(button) {
  const postId = Number(button.dataset.postId);
  if (!Number.isSafeInteger(postId) || postId < 1) return;
  await api("/api/me/notifications/read-thread/" + postId, { method: "POST" });
  state.router.navigate("/posts/" + postId);
}

async function markAllNotificationsRead() {
  await api("/api/me/notifications/read-all", { method: "POST" });
  // The rerender refetches the list (and the session's unread count); the
  // local update keeps the header honest even if the route render is slowed.
  updateBell(0);
  await state.renderRoute({ name: "notifications" });
  setMessage(t("notificationsPage.allRead"));
}

export const ACTIONS = {
  "open-notification": (button) => openNotification(button),
  "open-notification-thread": (button) => openNotificationThread(button),
  "mark-notifications-read": () => markAllNotificationsRead(),
};

export { renderNotificationsRoute };
