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

// Bookmark folders (v5.39.0 F1) on the /bookmarks page: a row of folder chips
// (/bookmarks?folder=<id>, linkable like the board chips), New folder, and
// inside a folder Rename / Delete. On the plain list each saved card gets an
// "Add to folder" select; inside a folder each card gets "Remove from folder".
// The server's folder list is the only state: nothing is stored on the device.
// Folder names reach the DOM through textContent; hrefs come from the URL API.
import { api } from "./api.js";
import { state } from "./state.js";
import { t } from "./i18n.js";

const LINK_BASE = "https://wempos-forum.invalid";
const NAME_MAX = 40;
const CONTROL_CHARS = /\p{Cc}/u;
export const FOLDERS_PATH = "/api/me/bookmark-folders";

// Advisory mirror of the server's rule (trimmed, 1-40 characters, no control
// characters); the server enforces it.
export function normalizeFolderName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  const length = [...name].length;
  return length >= 1 && length <= NAME_MAX && !CONTROL_CHARS.test(name) ? name : null;
}

export function folderItemsPath(folderId, before) {
  const path = FOLDERS_PATH + "/" + Number(folderId) + "/items";
  return before ? path + "?before=" + encodeURIComponent(before) : path;
}

const folderHref = (folderId) => {
  const url = new URL("/bookmarks", LINK_BASE);
  if (folderId) url.searchParams.set("folder", String(Number(folderId)));
  return url.pathname + url.search;
};

function chip(document, label, href, current) {
  const link = document.createElement("a");
  link.className = "feed-view";
  link.textContent = label;
  link.href = href;
  link.setAttribute("data-app-link", "");
  if (current) link.setAttribute("aria-current", "page");
  return link;
}

export function createFolderFilter(document, folders, activeId) {
  const nav = document.createElement("nav");
  nav.className = "feed-views saved-folders";
  nav.setAttribute("aria-label", t("folders.filterLabel"));
  const active = Number(activeId) || null;
  nav.append(chip(document, t("folders.allSaved"), folderHref(null), !active));
  for (const folder of folders) {
    nav.append(chip(document, String(folder.name), folderHref(folder.id), Number(folder.id) === active));
  }
  const create = document.createElement("button");
  create.className = "button button-quiet folder-create";
  create.type = "button";
  create.dataset.action = "folder-create";
  create.textContent = t("folders.new");
  nav.append(create);
  return nav;
}

function actionButton(document, className, action, label, folder) {
  const button = document.createElement("button");
  button.className = ["button", "button-quiet", className].join(" ");
  button.type = "button";
  button.dataset.action = action;
  button.dataset.folderId = String(folder.id);
  button.dataset.folderName = String(folder.name);
  button.textContent = label;
  return button;
}

export function createFolderManage(document, folder) {
  const box = document.createElement("div");
  box.className = "form-actions folder-manage";
  box.append(
    actionButton(document, "folder-rename", "folder-rename", t("folders.rename"), folder),
    actionButton(document, "folder-delete", "folder-delete", t("folders.delete"), folder),
  );
  return box;
}

function addSelect(document, postId, folders, onAdd) {
  const select = document.createElement("select");
  select.className = "folder-add";
  select.setAttribute("aria-label", t("folders.addTo"));
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("folders.addTo");
  select.append(placeholder);
  for (const folder of folders) {
    const option = document.createElement("option");
    option.value = String(folder.id);
    option.textContent = String(folder.name);
    select.append(option);
  }
  select.addEventListener("change", (event) => {
    const folderId = Number(event.target.value);
    if (folderId > 0) onAdd(postId, folderId);
  });
  return select;
}

// Adds the per-card folder control to every saved card not yet decorated
// (load-more pages call it again on the same container).
export function decorateSavedCards(container, document, { folders, activeFolderId, onAdd }) {
  const active = Number(activeFolderId) || null;
  if (!active && !folders.length) return;
  for (const card of [...container.querySelectorAll("article.post-card")]) {
    if (card.dataset.folderControl === "1") continue;
    card.dataset.folderControl = "1";
    const postId = Number(card.dataset.postId);
    if (active) {
      const remove = document.createElement("button");
      remove.className = "button button-quiet folder-remove";
      remove.type = "button";
      remove.dataset.action = "folder-remove-item";
      remove.dataset.folderId = String(active);
      remove.dataset.postId = String(postId);
      remove.textContent = t("folders.removeFrom");
      card.append(remove);
    } else {
      card.append(addSelect(document, postId, folders, onAdd));
    }
  }
}

// The select's handler: add, then say where it went and reset the select.
export function folderAdder({ folders, setMessage }) {
  return async (postId, folderId) => {
    await api(FOLDERS_PATH + "/" + Number(folderId) + "/items/" + Number(postId), { method: "PUT" });
    const folder = folders.find((row) => Number(row.id) === Number(folderId));
    setMessage(t("folders.added", { name: folder ? String(folder.name) : "" }));
  };
}

export function createFolderActions({ setMessage, prompt, confirm }) {
  const rerender = () => state.renderRoute(state.activeRoute);
  return {
    "folder-create": async () => {
      const name = normalizeFolderName(prompt(t("folders.namePrompt"), ""));
      if (!name) return;
      const data = await api(FOLDERS_PATH, { method: "POST", body: { name } });
      setMessage(t("folders.created"));
      state.router.navigate(folderHref(data?.folder?.id));
    },
    "folder-rename": async (button) => {
      const name = normalizeFolderName(prompt(t("folders.namePrompt"), button.dataset.folderName || ""));
      if (!name) return;
      await api(FOLDERS_PATH + "/" + Number(button.dataset.folderId), { method: "PATCH", body: { name } });
      await rerender();
      setMessage(t("folders.renamed"));
    },
    "folder-delete": async (button) => {
      if (!confirm(t("folders.deleteConfirm", { name: button.dataset.folderName || "" }))) return;
      await api(FOLDERS_PATH + "/" + Number(button.dataset.folderId), { method: "DELETE" });
      setMessage(t("folders.deleted"));
      state.router.navigate(folderHref(null));
    },
    "folder-remove-item": async (button) => {
      await api(FOLDERS_PATH + "/" + Number(button.dataset.folderId) + "/items/" + Number(button.dataset.postId),
        { method: "DELETE" });
      await rerender();
      setMessage(t("folders.removed"));
    },
  };
}
