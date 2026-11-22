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

// Private note about a member (v5.47.0): the "Your private note" box on
// someone else's profile, for signed-in viewers only. Only the viewer can
// ever read it (the server keys every query on the session). The note text
// lands through textarea.value / textContent only; nothing is stored on the
// device. Saving an empty note deletes it (the server refuses an empty PUT).
import { api } from "./api.js";
import { t } from "./i18n.js";

export const PRIVATE_NOTE_MAX_CHARS = 280;

export const privateNotePath = (username) => "/api/users/" + encodeURIComponent(String(username)) + "/note";

function child(document, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createPrivateNoteBox(document, { username, request = api }) {
  const box = child(document, "section", "panel private-note");
  const path = privateNotePath(username);
  const input = child(document, "textarea", "private-note-input");
  input.maxLength = PRIVATE_NOTE_MAX_CHARS;
  input.setAttribute("maxlength", String(PRIVATE_NOTE_MAX_CHARS));
  input.setAttribute("aria-label", t("privateNote.label"));
  input.rows = 3;
  input.disabled = true;
  const save = child(document, "button", "button button-secondary private-note-save", t("privateNote.save"));
  save.type = "button";
  const remove = child(document, "button", "button button-quiet private-note-delete", t("privateNote.delete"));
  remove.type = "button";
  const status = child(document, "p", "muted private-note-status");
  status.setAttribute("role", "status");
  const actions = child(document, "div", "private-note-actions");
  actions.append(save, remove);
  box.append(child(document, "h2", "private-note-title", t("privateNote.title")),
    child(document, "p", "muted private-note-hint", t("privateNote.hint")), input, actions, status);

  const run = async (method, body, doneKey) => {
    save.disabled = true;
    remove.disabled = true;
    try {
      const data = await request(path, body === undefined ? { method } : { method, body });
      input.value = typeof data?.note?.body === "string" ? data.note.body : "";
      status.textContent = t(doneKey);
    } catch {
      status.textContent = t("privateNote.saveError");
    } finally {
      save.disabled = false;
      remove.disabled = false;
    }
  };
  box.deletePrivateNote = () => run("DELETE", undefined, "privateNote.deleted");
  box.savePrivateNote = () => {
    const body = String(input.value ?? "").trim();
    return body ? run("PUT", { body }, "privateNote.saved") : box.deletePrivateNote();
  };
  box.loadPrivateNote = async () => {
    try {
      const data = await request(path);
      input.value = typeof data?.note?.body === "string" ? data.note.body : "";
      input.disabled = false;
    } catch {
      // A failed read removes the box rather than offering an editor that
      // could overwrite a note it never loaded.
      box.remove();
    }
  };
  save.addEventListener("click", () => box.savePrivateNote());
  remove.addEventListener("click", () => box.deletePrivateNote());
  return box;
}

export const loadPrivateNote = (box) => box.loadPrivateNote();
