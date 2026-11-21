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

// v4.0 plan 5 (spec step 6), task 1: the moderation desk's appeals section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { addText } from "../forms.js";
import { currentLocale, t } from "../i18n.js";

// The appeals queue (v3.1): one card per appeal. Pending appeals carry the
// decision pair; decided ones show their outcome. Appeals are BAN appeals
// since the auto-mod removal (v4.2) — every card shows the ban reason so the
// desk can judge the appeal, not just read it.
function createAppealQueue(appeals, document) {
  const list = document.createElement("div");
  list.className = "appeal-list";
  if (!appeals.length) {
    addText(document, list, "p", t("desk.appeals.empty"), "empty-state");
    return list;
  }
  for (const appeal of appeals) {
    const card = document.createElement("article");
    card.className = "appeal-card";
    addText(document, card, "h3", t("desk.appeals.title", { id: appeal.id, username: appeal.username }));
    addText(document, card, "p",
      appeal.kind === "ban" ? t("desk.appeals.kindBan") : t("desk.appeals.kindLegacy"),
      "muted");
    addText(document, card, "p", t("desk.appeals.banReason", { reason: appeal.banReason || t("desk.appeals.noReason") }));
    addText(document, card, "p", '"' + appeal.body + '"', "appeal-body");
    addText(document, card, "p",
      appeal.status === "pending"
        ? t("desk.appeals.pending", { when: new Date(appeal.createdAt).toLocaleString(currentLocale()) })
        : appeal.status === "approved"
          ? t("desk.appeals.approved", { when: appeal.decidedAt ? new Date(appeal.decidedAt).toLocaleString(currentLocale()) : "" })
          : t("desk.appeals.denied", { when: appeal.decidedAt ? new Date(appeal.decidedAt).toLocaleString(currentLocale()) : "" }),
      "muted");
    if (appeal.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "form-actions";
      for (const [decision, label, className] of [
        ["approve", t("desk.appeals.approveButton"), "button button-primary"],
        ["deny", t("desk.appeals.denyButton"), "button button-danger"],
      ]) {
        const form = document.createElement("form");
        form.dataset.form = "admin-appeal";
        form.dataset.appealId = String(appeal.id);
        form.dataset.decision = decision;
        const button = document.createElement("button");
        button.type = "submit";
        button.className = className;
        button.textContent = label;
        form.append(button);
        actions.append(form);
      }
      card.append(actions);
    }
    list.append(card);
  }
  return list;
}


export { createAppealQueue };
