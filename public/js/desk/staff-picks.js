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

// v5.35: the desk's staff-pick log (api/staff-picks.mjs GET
// /api/admin/staff-picks). Builder only (createElement/textContent); every
// pick and unpick, newest first, with who did it and a link to the thread.
import { addText } from "../forms.js";
import { currentLocale, t } from "../i18n.js";

function createStaffPickLog(log, document) {
  const container = document.createElement("div");
  container.className = "staff-pick-log";
  if (!log.length) {
    addText(document, container, "p", t("admin.noStaffPicks"), "empty-state");
    return container;
  }
  for (const entry of log) {
    const card = document.createElement("div");
    card.className = "report-queue-item staff-pick-entry";
    const user = entry.actor || "?";
    addText(document, card, "p",
      entry.action === "unpick" ? t("admin.staffPickLogUnpick", { user }) : t("admin.staffPickLogPick", { user }),
      "report-queue-head");
    const link = document.createElement("a");
    link.className = "staff-pick-entry-link";
    link.href = "/posts/" + Number(entry.postId);
    link.setAttribute("data-app-link", "");
    link.textContent = "#" + Number(entry.postId);
    card.append(link);
    addText(document, card, "p", new Date(entry.createdAt).toLocaleString(currentLocale()), "hidden-post-when");
    container.append(card);
  }
  return container;
}

export { createStaffPickLog };
