// v4.0 plan 5 (spec step 6), task 1: the moderation desk's report queue (ban/promote forms ride the cards) section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { createForm, createInput, addText } from "../forms.js";
import { createBanForm } from "./bans.js";

const createReportQueue = (reports, document, currentUser = null) => {
  const list = document.createElement("div");
  list.className = "report-list";
  if (!reports.length) {
    addText(document, list, "p", "The report queue is clear.", "empty-state");
    return list;
  }
  for (const report of reports) {
    const card = document.createElement("article");
    card.className = "report-card";
    card.dataset.reportId = String(report.id);
    addText(document, card, "h2", `Report #${report.id}`);
    addText(document, card, "p", `Reported by ${report.reporter.username}: ${report.reason}`);
    const postLink = document.createElement("a");
    postLink.href = `/posts/${report.post.id}`;
    postLink.textContent = `Post by ${report.post.author.username}: ${report.post.body}`;
    card.append(postLink);
    const actions = document.createElement("div");
    actions.className = "form-actions";
    for (const [action, label] of [["dismiss", "Dismiss"], ["hide_post", "Hide post"]]) {
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
