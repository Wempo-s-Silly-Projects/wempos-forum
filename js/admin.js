import { createForm, createInput, addText } from "./forms.js";

export const createReportQueue = (reports, document) => {
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
    const banForm = createForm(document, "admin-ban", [
      createInput(document, {
        id: `ban-reason-${report.id}`,
        name: "reason",
        label: `Reason to ban ${report.post.author.username}`,
        required: true,
        maxLength: 500,
      }),
    ], "Ban author");
    banForm.dataset.userId = String(report.post.author.id);
    actions.append(banForm);
    card.append(actions);
    list.append(card);
  }
  return list;
}

export function createActiveBanList(bans, document) {
  const list = document.createElement("div");
  list.className = "ban-list";
  if (!bans.length) {
    addText(document, list, "p", "There are no active bans.", "empty-state");
    return list;
  }
  for (const ban of bans) {
    const card = document.createElement("article");
    card.className = "ban-card";
    addText(document, card, "h3", ban.user.username);
    addText(document, card, "p", `Reason: ${ban.reason}`);
    if (ban.expiresAt) {
      addText(document, card, "p", `Expires: ${new Date(ban.expiresAt).toLocaleString()}`);
    }
    const form = createForm(document, "admin-unban", [
      createInput(document, {
        id: `unban-reason-${ban.id}`,
        name: "reason",
        label: `Reason to unban ${ban.user.username}`,
        required: true,
        maxLength: 500,
      }),
    ], "Unban user");
    form.dataset.userId = String(ban.user.id);
    card.append(form);
    list.append(card);
  }
  return list;
}
