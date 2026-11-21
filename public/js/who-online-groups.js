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

// Wave 2026-11-21-36 F3 — Who's Online grouped by role. The roster GET
// /api/presence returns (already without invisible, stale or banned members —
// invisible mode is decided entirely on the server) is split into Staff
// (owner + admin) and Members, each under a heading with its count. Staff
// come first; the name cap still covers the whole card. Nothing stored,
// nothing requested here.
import { t } from "./i18n.js";

export const STAFF_ROLES = Object.freeze(["owner", "admin"]);

const named = (member) => typeof member?.username === "string" && member.username !== "";

export function groupRoster(online) {
  const list = Array.isArray(online) ? online.filter(named) : [];
  const staff = list.filter((member) => STAFF_ROLES.includes(member.role));
  const members = list.filter((member) => !STAFF_ROLES.includes(member.role));
  return [
    { key: "staff", label: t("online.staff", { count: staff.length }), members: staff },
    { key: "members", label: t("online.members", { count: members.length }), members },
  ].filter((group) => group.members.length > 0);
}

// Fills listEl with each group's heading and up to nameMax names in total
// (staff first); one "+N more" line covers whatever the cap left out.
export function paintRosterGroups(document, listEl, online, nameMax, profileHref) {
  listEl.replaceChildren();
  let room = nameMax;
  let hidden = 0;
  for (const group of groupRoster(online)) {
    const section = document.createElement("div");
    section.className = "who-online-group";
    section.dataset.group = group.key;
    const heading = document.createElement("p");
    heading.className = "who-online-group-heading";
    heading.textContent = group.label;
    section.append(heading);
    for (const member of group.members) {
      if (room <= 0) { hidden += 1; continue; }
      room -= 1;
      const link = document.createElement("a");
      link.className = "who-online-name";
      link.textContent = member.username;
      link.href = profileHref(member.username);
      link.setAttribute("data-app-link", "");
      section.append(link);
    }
    listEl.append(section);
  }
  if (hidden > 0) {
    const more = document.createElement("span");
    more.className = "who-online-more";
    more.textContent = t("online.more", { count: hidden });
    listEl.append(more);
  }
}
