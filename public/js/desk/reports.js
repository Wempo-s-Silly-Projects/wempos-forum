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

// v4.0 plan 5 (spec step 6), task 1: the moderation desk's report queue (ban/promote forms ride the cards) section
// builders — bodies moved verbatim out of ../admin.js (now dissolved) and
// re-expressed on the vendored kit (5.0 wave 6).
import { el } from "../vendor/frontload/dom.mjs";
import { addText, createForm, createInput } from "../vendor/designer/kit.mjs";
import { createBanForm } from "./bans.js";

const createReportQueue = (document, reports, currentUser = null) => {
  const list = el("div", { class: "report-list" });
  if (!reports.length) {
    addText(list, "The report queue is clear.", "empty-state");
    return list;
  }
  for (const report of reports) {
    const card = el("article", {
      class: "report-card",
      dataset: { reportId: String(report.id) },
    });
    card.append(el("h2", { text: `Report #${report.id}` }));
    addText(card, `Reported by ${report.reporter.username}: ${report.reason}`);
    const postLink = el("a", {
      href: `/posts/${report.post.id}`,
      text: `Post by ${report.post.author.username}: ${report.post.body}`,
    });
    card.append(postLink);
    const actions = el("div", { class: "form-actions" });
    for (const [action, label] of [["dismiss", "Dismiss"], ["hide_post", "Hide post"]]) {
      const form = el("form", {
        dataset: { form: "admin-resolve", reportId: String(report.id), action },
      });
      form.append(el("button", {
        type: "submit",
        class: action === "hide_post" ? "button button-danger" : "button button-secondary",
        text: label,
      }));
      actions.append(form);
    }
    const banForm = createBanForm(document, report.post.author.id, report.post.author.username);
    actions.append(banForm);
    // Role changes are strictly owner-only (v3.1: the report queue itself is
    // open to admins); target start roles are not known from the payload, so
    // both forms are offered and the server reports a stale-role 409 if the
    // target is already in that role.
    if (currentUser && currentUser.role === "owner") {
      const promoteForm = createForm(document, "admin-promote", [
        createInput(document, {
          id: `promote-reason-${report.id}`,
          name: "reason",
          label: `Reason to promote ${report.post.author.username} (optional)`,
          maxLength: 500,
        }),
      ], "Promote to mod");
      promoteForm.dataset.userId = String(report.post.author.id);
      const demoteForm = createForm(document, "admin-demote", [
        createInput(document, {
          id: `demote-reason-${report.id}`,
          name: "reason",
          label: `Reason to demote ${report.post.author.username} (optional)`,
          maxLength: 500,
        }),
      ], "Demote to member");
      demoteForm.dataset.userId = String(report.post.author.id);
      actions.append(promoteForm, demoteForm);
    }
    card.append(actions);
    list.append(card);
  }
  return list;
}


export { createReportQueue };
