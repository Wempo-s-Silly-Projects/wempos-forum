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

// Wave 5.9 F3: Reply on a wall post. The button puts "@name " at the start of
// the wall box and focuses it with the cursor at the end; nothing is sent
// until the member posts. Not shown to guests or on the viewer's own posts
// (wall.js decides).
import { t } from "./i18n.js";

// Never doubles the same mention; respects the box's cap.
export const mentionPrefill = (value, username, max = Infinity) => {
  const mention = "@" + username + " ";
  const typed = String(value ?? "").trimStart();
  const next = typed.startsWith(mention) ? typed : mention + typed;
  return next.slice(0, max);
};

export const createWallReplyButton = (document, username, findBox, max) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet wall-reply";
  button.textContent = t("wall.reply");
  button.setAttribute("aria-label", t("wall.replyAria", { name: username }));
  button.addEventListener("click", () => {
    const box = findBox();
    if (!box) return;
    box.value = mentionPrefill(box.value, username, max);
    // The wall box's character counter listens for input.
    if (typeof box.dispatchEvent === "function") box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    if (typeof box.setSelectionRange === "function") box.setSelectionRange(box.value.length, box.value.length);
  });
  return button;
};
