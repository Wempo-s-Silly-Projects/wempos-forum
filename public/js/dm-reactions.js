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

// DM message reactions (v5.44, api/dm-reactions.mjs): the like/dislike pair
// under a 1:1 DM bubble. A pure builder — the composer passes onToggle,
// which does the PUT/DELETE and the repaint. Pressing your own reaction asks
// to remove it (null); pressing the other asks to set it. Counts come from
// the thread read; zero stays quiet. Group DMs have no reactions.
import { t } from "./i18n.js";
import { createIcon } from "./icons.js";

const VALUES = [["like", "thumbUp", "render.like"], ["dislike", "thumbDown", "render.dislike"]];

export const dmReactionPath = (messageId) => {
  const id = Number(messageId);
  const ok = typeof messageId === "string" ? /^[1-9][0-9]{0,14}$/.test(messageId) : Number.isSafeInteger(id) && id > 0;
  if (!ok) throw new RangeError("bad id");
  return new URL(`/api/dm/messages/${id}/reaction`, "https://wempos-forum.invalid").pathname;
};

export function buildDmReactions(document, message, onToggle) {
  const reactions = message.reactions || {};
  const wrap = document.createElement("div");
  wrap.className = "dm-reactions";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", t("dm.reactionsLabel"));
  for (const [value, icon, labelKey] of VALUES) {
    const pressed = reactions.mine === value;
    const button = document.createElement("button");
    button.type = "button";
    button.className = pressed ? "dm-reaction dm-reaction-active" : "dm-reaction";
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
    button.setAttribute("aria-label", t(labelKey));
    button.append(createIcon(document, icon));
    const total = Number(reactions[value]) || 0;
    if (total > 0) {
      const count = document.createElement("span");
      count.className = "dm-reaction-count";
      count.textContent = String(total);
      button.append(count);
    }
    button.addEventListener("click", () => onToggle(Number(message.id), pressed ? null : value));
    wrap.append(button);
  }
  return wrap;
}
