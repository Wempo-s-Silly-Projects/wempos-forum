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

// Follow a member (v5.39.0 F2): the profile's Follow/Following toggle (signed-
// in members only, never on your own profile) and the private "Following"
// list in account settings. The server's answer — never the click — sets the
// button state. Names reach the DOM through textContent; profile links are
// built with the URL API. Nothing is stored on the device.
import { api } from "./api.js";
import { state } from "./state.js";
import { t } from "./i18n.js";

const LINK_BASE = "https://wempos-forum.invalid";
export const followPath = (username) => "/api/users/" + encodeURIComponent(String(username)) + "/follow";
const profilePath = (username) => new URL("/users/" + encodeURIComponent(String(username)), LINK_BASE).pathname;

export function setFollowState(button, following) {
  button.setAttribute("aria-pressed", following ? "true" : "false");
  button.textContent = following ? t("follow.following") : t("follow.follow");
}

export function createFollowButton(document, { username, following }) {
  const button = document.createElement("button");
  button.className = "button button-quiet follow-toggle";
  button.type = "button";
  button.dataset.action = "toggle-follow";
  button.dataset.username = String(username);
  setFollowState(button, Boolean(following));
  return button;
}

// Reads the caller's own state for the profile button; a failed read removes
// the button rather than guessing.
export async function loadFollowState(button) {
  button.disabled = true;
  try {
    const data = await api(followPath(button.dataset.username));
    setFollowState(button, Boolean(data?.following));
    button.disabled = false;
  } catch {
    button.remove();
  }
}

export function createFollowingList(document, rows) {
  const list = document.createElement("div");
  list.className = "following-list";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = t("follow.empty");
    list.append(empty);
    return list;
  }
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "following-row";
    const link = document.createElement("a");
    link.className = "following-name";
    link.href = profilePath(row.username);
    link.setAttribute("data-app-link", "");
    link.textContent = "@" + row.username;
    const unfollow = document.createElement("button");
    unfollow.className = "button button-secondary following-unfollow";
    unfollow.type = "button";
    unfollow.dataset.action = "unfollow-user";
    unfollow.dataset.username = String(row.username);
    unfollow.textContent = t("follow.unfollow");
    item.append(link, unfollow);
    list.append(item);
  }
  return list;
}

// The account-settings panel: the member's own follows, each with Unfollow.
export async function renderFollowingSettings(account, session) {
  const panel = document.createElement("section");
  panel.className = "panel following-panel";
  const heading = document.createElement("h2");
  heading.textContent = t("follow.title");
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = t("follow.description");
  panel.append(heading, description);
  account.append(panel);
  let data;
  try {
    data = await api("/api/me/following");
  } catch {
    const failed = document.createElement("p");
    failed.className = "empty-state";
    failed.textContent = t("follow.loadError");
    panel.append(failed);
    return;
  }
  // The fetch races renders; a stale answer must not paint into a new account.
  if (!session?.user || state.currentUser?.id !== session.user.id) return;
  panel.append(createFollowingList(document, Array.isArray(data?.following) ? data.following : []));
}

export function createFollowActions({ setMessage }) {
  return {
    "toggle-follow": async (button) => {
      const username = button.dataset.username;
      const following = button.getAttribute("aria-pressed") === "true";
      button.disabled = true;
      try {
        const data = await api(followPath(username), { method: following ? "DELETE" : "POST" });
        setFollowState(button, Boolean(data?.following));
        setMessage(data?.following ? t("follow.followed", { username }) : t("follow.unfollowed", { username }));
      } finally {
        button.disabled = false;
      }
    },
    "unfollow-user": async (button) => {
      const username = button.dataset.username;
      await api(followPath(username), { method: "DELETE" });
      await state.renderRoute(state.activeRoute);
      setMessage(t("follow.unfollowed", { username }));
    },
  };
}
