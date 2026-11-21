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

// Blocks (v4.4): the account-settings section — the member's block pairs
// (both directions, named) with the Unblock control for the rows they own.
// The profile surface carries the Block button (routes/profile.js); once a
// pair exists the profile itself is unavailable, so this list is the only
// Unblock door for rows this member didn't create (those are closed by the
// other member alone).
import { api } from "../api.js";
import { confirmDialog, createPanel, element, openConfirmDialog, setMessage } from "../dom.js";
import { state } from "../state.js";
import { t } from "../i18n.js";

export async function renderBlockedSettings(account, session) {
  const panel = createPanel(t("blocks.title"),
    t("blocks.description"));
  const list = element("div", "blocked-list");
  panel.append(list);
  account.append(panel);
  let data;
  try {
    data = await api("/api/me/blocks");
  } catch {
    list.append(element("p", "empty-state", t("blocks.loadError")));
    return;
  }
  if (!versionCurrent(session)) return;
  list.replaceChildren();
  if (!data.blocks.length) {
    list.append(element("p", "empty-state", t("blocks.empty")));
    return;
  }
  for (const row of data.blocks) {
    const item = element("div", "blocked-row");
    item.append(element("span", "blocked-name", "@" + row.username));
    if (row.ownDirection) {
      const button = element("button", "button button-secondary", t("common.unblock"));
      button.type = "button";
      button.dataset.action = "unblock-user";
      button.dataset.userId = String(row.id);
      button.dataset.username = row.username;
      item.append(button);
    } else {
      item.append(element("span", "muted", t("blocks.blockedByThem")));
    }
    list.append(item);
  }
}

// The fetch races renders; a stale answer must not clobber the current one.
function versionCurrent(session) {
  return Boolean(session && state.currentUser &&
    session.user.id === state.currentUser.id);
}

async function unblock(button) {
  const userId = Number(button.dataset.userId);
  const username = button.dataset.username || t("blocks.thisMember");
  openConfirmDialog(
    t("blocks.unblockTitle", { username }),
    t("blocks.unblockMessage"),
    "unblock",
    async () => {
      await api(`/api/users/${userId}/block`, { method: "DELETE" });
      confirmDialog.close();
      setMessage(t("blocks.unblocked", { username }));
      await state.renderRoute(state.activeRoute);
    },
  );
}

export const ACTIONS = {
  "unblock-user": (button) => unblock(button),
};
