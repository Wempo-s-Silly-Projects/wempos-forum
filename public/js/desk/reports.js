
// v4.0 plan 5 (spec step 6), task 1: the moderation desk's report queue
// (ban/promote forms ride the cards) section — builders moved out of
// ../admin.js (now dissolved).
import { createForm, createInput, addText } from "../forms.js";
import { createBanForm } from "./bans.js";

const POST_PREVIEW_LIMIT = 500;

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}

function isValidReport(report) {
  return Boolean(
    report &&
    typeof report === "object" &&
    validId(report.id) &&
    report.reporter &&
    typeof report.reporter === "object" &&
    typeof report.reporter.username === "string" &&
    report.reporter.username.length > 0 &&
    typeof report.reason === "string" &&
    report.post &&
    typeof report.post === "object" &&
    validId(report.post.id) &&
    report.post.author &&
    typeof report.post.author === "object" &&
    validId(report.post.author.id) &&
    typeof report.post.author.username === "string" &&
    report.post.author.username.length > 0 &&
    typeof report.post.body === "string",
  );
}

function appendLoadError(list, document) {
  addText(
    document,
    list,
    "p",
    "The report queue could not be loaded.",
    "empty-state",
  );
}

function createPostPreview(body) {
  if (body.length <= POST_PREVIEW_LIMIT) {
    return body;
  }

  return body.slice(0, POST_PREVIEW_LIMIT).trimEnd() + "…";
}

const createReportQueue = (reports, document, currentUser = null) => {
  const list = document.createElement("div");
  list.className = "report-list";

  if (!Array.isArray(reports)) {
    appendLoadError(list, document);
    return list;
  }

  if (!reports.length) {
    addText(document, list, "p", "The report queue is clear.", "empty-state");
    return list;
  }

  const validReports = reports.filter(isValidReport);

  if (!validReports.length) {
    appendLoadError(list, document);
    return list;
  }

  for (const report of validReports) {
    const reportId = String(Number(report.id));
    const postId = String(Number(report.post.id));
    const authorId = String(Number(report.post.author.id));
    const authorUsername = report.post.author.username;

    const card = document.createElement("article");
    card.className = "report-card";
    card.dataset.reportId = reportId;

    addText(document, card, "h2", `Report #${reportId}`);

    addText(
      document,
      card,
      "p",
      `Reported by ${report.reporter.username}: ${report.reason}`,
    );

    const postLink = document.createElement("a");
    postLink.href = `/posts/${postId}`;
    postLink.setAttribute("data-app-link", "");
    postLink.textContent =
      `Post by ${authorUsername}: ${createPostPreview(report.post.body)}`;

    card.append(postLink);

    const actions = document.createElement("div");
    actions.className = "form-actions";

    for (const [action, label] of [
      ["dismiss", "Dismiss"],
      ["hide_post", "Hide post"],
    ]) {
      const form = document.createElement("form");
      form.dataset.form = "admin-resolve";
      form.dataset.reportId = reportId;
      form.dataset.action = action;

      const button = document.createElement("button");
      button.type = "submit";
      button.className =
        action === "hide_post"
          ? "button button-danger"
          : "button button-secondary";
      button.textContent = label;

      form.append(button);
      actions.append(form);
    }

    const banForm = createBanForm(
      document,
      authorId,
      authorUsername,
    );

    actions.append(banForm);

    // Role changes are strictly owner-only (v3.1: the report queue itself is
    // open to admins); target start roles are not known from the payload, so
    // both forms are offered and the server reports a stale-role 409 if the
    // target is already in that role.
    if (currentUser?.role === "owner") {
      const promoteForm = createForm(document, "admin-promote", [
        createInput(document, {
          id: `promote-reason-${reportId}`,
          name: "reason",
          label: `Reason to promote ${authorUsername} (optional)`,
          maxLength: 500,
        }),
      ], "Promote to mod");

      promoteForm.dataset.userId = authorId;

      const demoteForm = createForm(document, "admin-demote", [
        createInput(document, {
          id: `demote-reason-${reportId}`,
          name: "reason",
          label: `Reason to demote ${authorUsername} (optional)`,
          maxLength: 500,
        }),
      ], "Demote to member");

      demoteForm.dataset.userId = authorId;

      actions.append(promoteForm, demoteForm);
    }

    card.append(actions);
    list.append(card);
  }

  return list;
};

export { createReportQueue };
