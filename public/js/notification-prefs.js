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

// Notification preferences (v5.40.0 F1): one checkbox per kind in account
// settings. Checked = notify me. The server stores the muted kinds and
// enforces them when notifications are created; this panel only reads and
// saves the list (nothing is kept on the device). Appeal decisions are not
// listed: they always arrive.
import { api } from "./api.js";
import { t } from "./i18n.js";

export const NOTIFICATION_PREFS_PATH = "/api/me/notification-prefs";
// Mirror of api/notifications.mjs NOTIFICATION_KINDS (pinned equal by test).
export const NOTIFICATION_PREF_KINDS = Object.freeze([
  "reply", "subscription", "mention", "chat_mention", "follow_thread", "invite_joined",
]);
const KIND_LABEL_KEYS = Object.freeze({
  reply: "notifPrefs.kindReply",
  subscription: "notifPrefs.kindSubscription",
  mention: "notifPrefs.kindMention",
  chat_mention: "notifPrefs.kindChatMention",
  follow_thread: "notifPrefs.kindFollowThread",
  invite_joined: "notifPrefs.kindInviteJoined",
});

const mutedFrom = (boxes) => boxes.filter((box) => !box.checked).map((box) => box.dataset.kind);

// The checkbox list. Kinds the client doesn't know (a newer server) are not
// painted; `onSave(muted)` gets the unchecked kinds in display order.
export function createNotificationPrefsList(doc, { kinds, muted }, onSave) {
  const list = doc.createElement("div");
  list.className = "notification-prefs-list";
  const mutedSet = new Set(Array.isArray(muted) ? muted : []);
  const shown = NOTIFICATION_PREF_KINDS.filter((kind) => Array.isArray(kinds) && kinds.includes(kind));
  const boxes = [];
  for (const kind of shown) {
    const label = doc.createElement("label");
    label.className = "notification-pref";
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.dataset.kind = kind;
    box.checked = !mutedSet.has(kind);
    boxes.push(box);
    box.addEventListener("change", () => onSave(mutedFrom(boxes), boxes));
    label.append(box, doc.createTextNode(" " + t(KIND_LABEL_KEYS[kind])));
    list.append(label);
  }
  return list;
}

const syncBoxes = (boxes, muted) => {
  const mutedSet = new Set(muted);
  for (const box of boxes) box.checked = !mutedSet.has(box.dataset.kind);
};

// The settings panel: loads the member's list, saves on every change, and on
// a failed save puts the boxes back to the last saved state.
export async function renderNotificationPrefs(account, { doc = document, apiFn = api } = {}) {
  const panel = doc.createElement("section");
  panel.className = "panel notification-prefs-panel";
  const heading = doc.createElement("h2");
  heading.textContent = t("notifPrefs.title");
  const help = doc.createElement("p");
  help.className = "muted";
  help.textContent = t("notifPrefs.help");
  const status = doc.createElement("p");
  status.className = "muted notification-prefs-status";
  status.setAttribute("role", "status");
  panel.append(heading, help);
  account.append(panel);
  let data;
  try {
    data = await apiFn(NOTIFICATION_PREFS_PATH, {});
  } catch {
    const failed = doc.createElement("p");
    failed.className = "empty-state";
    failed.textContent = t("notifPrefs.loadError");
    panel.append(failed);
    return;
  }
  let saved = Array.isArray(data?.muted) ? data.muted : [];
  const save = async (muted, boxes) => {
    try {
      const result = await apiFn(NOTIFICATION_PREFS_PATH, { method: "PUT", body: { muted } });
      saved = Array.isArray(result?.muted) ? result.muted : muted;
      syncBoxes(boxes, saved);
      status.textContent = t("notifPrefs.saved");
    } catch {
      syncBoxes(boxes, saved);
      status.textContent = t("notifPrefs.saveError");
    }
  };
  panel.append(createNotificationPrefsList(doc, { kinds: data?.kinds, muted: saved }, save), status);
}
