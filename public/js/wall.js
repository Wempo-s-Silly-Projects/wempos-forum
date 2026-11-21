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

// Profile wall (v4.0, owner's ask): visitors leave short posts on a member's
// profile; the profile OWNER may pin/unpin wall posts and can do nothing else
// to them. The wall renders below the profile's posts and fetches its own
// payload (GET /api/users/:id/wall) so the profile route stays untouched.
// Everything lands through textContent/CSSOM — the CSP stays pure.
import { api } from "./api.js";
import { addSubmit, createPanel, element, main, setMessage } from "./dom.js";
import { createTextarea } from "./forms.js";
import { state } from "./state.js";
import { currentLocale, t } from "./i18n.js";

const WALL_MAX_CHARS = 280;

// Builds the wall panel and fills it from the API (the caller does not
// await — the profile render never blocks on the wall fetch).
export async function renderProfileWall(profile) {
  const panel = createPanel(t("wall.title"), t("wall.intro"));
  panel.classList.add("profile-wall");
  main.append(panel);
  const viewer = state.currentUser;
  const isOwner = Boolean(viewer && Number(viewer.id) === Number(profile.id));
  // Signed-in members get the wall composer; guests just read. The form's
  // dataset carries the wall owner so the submit handler posts to the right
  // wall even after rerenders.
  if (viewer) {
    const form = document.createElement("form");
    form.dataset.form = "wall-post";
    form.dataset.ownerId = String(profile.id);
    form.append(createTextarea(document, {
      id: `${profile.id}-wall-body`, name: "body", label: t("wall.postLabel"),
      rows: 3, maxLength: WALL_MAX_CHARS, required: true, counter: true,
    }));
    addSubmit(form, t("wall.postButton"));
    panel.append(form);
  }
  let data;
  try {
    data = await api("/api/users/" + encodeURIComponent(profile.id) + "/wall");
  } catch (error) {
    panel.append(element("p", "empty-state", t("wall.loadFailed")));
    return;
  }
  const list = element("div", "wall-list");
  if (!data.wall.length) {
    list.append(element("p", "empty-state", viewer ? t("wall.emptyViewer") : t("wall.emptyGuest")));
  }
  for (const post of data.wall) {
    const row = element("div", "wall-post");
    if (post.pinnedAt) row.classList.add("wall-post-pinned");
    const header = element("div", "wall-post-header");
    const author = element("a", "wall-post-author", post.author.username);
    author.href = "/users/" + encodeURIComponent(post.author.username);
    author.setAttribute("data-app-link", "");
    header.append(author);
    if (post.author.role === "owner" || post.author.role === "admin") {
      header.append(element("span", "role-badge role-badge-" + post.author.role,
        post.author.role === "owner" ? t("wall.roleOwner") : t("wall.roleAdmin")));
    }
    if (post.pinnedAt) header.append(element("span", "post-pinned", t("wall.pinned")));
    const when = element("time", "wall-post-time");
    when.dateTime = post.createdAt;
    when.textContent = new Date(post.createdAt).toLocaleString(currentLocale());
    header.append(when);
    row.append(header);
    const body = element("p", "wall-post-body", post.body);
    row.append(body);
    // Pin control: the wall OWNER's single affordance. The dataset rides the
    // payload's pinnedAt, so a re-render refetch decides the state.
    if (isOwner) {
      const pin = element("button", "button button-quiet",
        post.pinnedAt ? t("wall.unpin") : t("wall.pin"));
      pin.type = "button";
      pin.dataset.action = post.pinnedAt ? "wall-unpin" : "wall-pin";
      pin.dataset.wallPostId = String(post.id);
      pin.setAttribute("aria-label",
        post.pinnedAt ? t("wall.unpinAria") : t("wall.pinAria"));
      row.append(pin);
    }
    list.append(row);
  }
  panel.append(list);
}

// The registration seam: merged into submitForm/handleButtonAction's dispatch
// maps (the same shape the auth/feed route modules export).
export const FORM_HANDLERS = {
  "wall-post": async (form, text) => {
    await api("/api/users/" + encodeURIComponent(form.dataset.ownerId) + "/wall", {
      method: "POST",
      body: { body: text("body") },
    });
    await state.renderRoute(state.activeRoute);
    setMessage(t("wall.posted"));
  },
};

export const ACTIONS = {
  "wall-pin": async (button) => {
    await api("/api/wall/" + encodeURIComponent(button.dataset.wallPostId) + "/pin", { method: "POST" });
    await state.renderRoute(state.activeRoute);
    setMessage(t("wall.pinnedMsg"));
  },
  "wall-unpin": async (button) => {
    await api("/api/wall/" + encodeURIComponent(button.dataset.wallPostId) + "/pin", { method: "DELETE" });
    await state.renderRoute(state.activeRoute);
    setMessage(t("wall.unpinnedMsg"));
  },
};
