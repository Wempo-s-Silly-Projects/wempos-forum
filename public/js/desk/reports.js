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

// v4.0 plan 5 (spec step 6), task 1: the moderation desk's report queue (ban/promote forms ride the cards) section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { createForm, createInput, addText } from "../forms.js";
import { createBanForm } from "./bans.js";
import { createHideRecentForm, createMemberPeekToggle } from "./member-tools.js";
import { createClaimControl } from "./staff-tools.js";
import { t } from "../i18n.js";

const createReportQueue = (reports, document, currentUser = null) => {
  const list = document.createElement("div");
  list.className = "report-list";
  if (!reports.length) {
    addText(document, list, "p", t("desk.reports.empty"), "empty-state");
    return list;
  }
  // Wave 5.13 F3: open reports per post, so a pile-up reads at a glance.
  const openPerPost = new Map();
  for (const report of reports) {
    openPerPost.set(report.post.id, (openPerPost.get(report.post.id) || 0) + 1);
  }
  for (const report of reports) {
    const card = document.createElement("article");
    card.className = "report-card";
    card.dataset.reportId = String(report.id);
    addText(document, card, "h2", t("desk.reports.title", { id: report.id }));
    addText(document, card, "p", t("desk.reports.reportedBy", { username: report.reporter.username, reason: report.reason }));
    // v5.43: who is handling it (Claim / Release).
    card.append(createClaimControl(document, report));
    const openCount = openPerPost.get(report.post.id);
    if (openCount > 1) {
      const repeat = addText(document, card, "p", t("desk.reports.repeat", { count: openCount }), "report-repeat");
      repeat.dataset.count = String(openCount);
    }
    const postLink = document.createElement("a");
    postLink.href = `/posts/${report.post.id}`;
    postLink.textContent = t("desk.reports.postBy", { username: report.post.author.username, body: report.post.body });
    card.append(postLink);
    const actions = document.createElement("div");
    actions.className = "form-actions";
    for (const [action, label] of [["dismiss", t("desk.reports.dismiss")], ["hide_post", t("desk.reports.hidePost")]]) {
      const form = document.createElement("form");
      form.dataset.form = "admin-resolve";
      form.dataset.reportId = String(report.id);
      form.dataset.action = action;
      const button = document.createElement("button");
      button.type = "submit";
      button.className = action === "hide_post" ? "button button-danger" : "button button-secondary";
      button.textContent = label;
      form.append(button);
      actions.append(form);
    }
    const banForm = createBanForm(document, report.post.author.id, report.post.author.username);
    actions.append(banForm);
    // Wave 2026-11-21-9: hide the author's spam run in one confirmed action.
    actions.append(createHideRecentForm(document, report.post.author.id, report.post.author.username, report.id));
    // Role changes are strictly owner-only (v3.1: the report queue itself is
    // open to admins); target start roles are not known from the payload, so
    // both forms are offered and the server reports a stale-role 409 if the
    // target is already in that role.
    if (currentUser && currentUser.role === "owner") {
      const promoteForm = createForm(document, "admin-promote", [
        createInput(document, {
          id: `promote-reason-${report.id}`,
          name: "reason",
          label: t("desk.reports.promoteReason", { username: report.post.author.username }),
          maxLength: 500,
        }),
      ], t("desk.reports.promoteButton"));
      promoteForm.dataset.userId = String(report.post.author.id);
      const demoteForm = createForm(document, "admin-demote", [
        createInput(document, {
          id: `demote-reason-${report.id}`,
          name: "reason",
          label: t("desk.reports.demoteReason", { username: report.post.author.username }),
          maxLength: 500,
        }),
      ], t("desk.reports.demoteButton"));
      demoteForm.dataset.userId = String(report.post.author.id);
      actions.append(promoteForm, demoteForm);
    }
    card.append(createMemberPeekToggle(document, report.post.author.id, report.id), actions);
    list.append(card);
  }
  return list;
}


export { createReportQueue };
