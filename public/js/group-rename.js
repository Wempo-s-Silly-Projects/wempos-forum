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

// Group rename (wave 2026-11-21-26, v4.31): the creator's one-line form in
// the group strip. A pure builder — the caller's onSave does the request
// (PATCH /api/dm/groups/:id via the one api wrapper); this module never
// fetches. The name is trimmed, capped at the server's 60 characters, an
// unchanged name sends nothing, an empty one clears back to the member-list
// title, and the send is single-flight (flag + disabled button).
import { t } from "./i18n.js";

const GROUP_NAME_MAX_CHARS = 60;

export const buildGroupRename = (doc, group, { onSave }) => {
  const make = (tagName, className, text) => {
    const node = doc.createElement(tagName);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const current = typeof group?.name === "string" ? group.name.trim() : "";
  const form = make("form", "chat-widget-group-rename");
  const input = make("input", "chat-widget-group-rename-input");
  input.type = "text";
  input.autocomplete = "off";
  input.maxLength = GROUP_NAME_MAX_CHARS;
  input.value = current;
  input.placeholder = t("dm.groupNameLabel");
  input.setAttribute("aria-label", t("dm.groupNameLabel"));
  const send = make("button", "button chat-widget-group-rename-send", t("dm.renameGroup"));
  send.type = "submit";
  form.append(input, send);
  let inFlight = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = String(input.value ?? "").trim().slice(0, GROUP_NAME_MAX_CHARS);
    if (inFlight || name === current) return;
    inFlight = true;
    send.disabled = true;
    try {
      await onSave(name);
    } finally {
      inFlight = false;
      send.disabled = false;
    }
  });
  return form;
};
