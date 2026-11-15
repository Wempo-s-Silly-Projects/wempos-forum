
// v4.0 plan 4 Task 9: the report-dialog concern — the shared report dialog
// (posts and profiles both funnel here), its submit, and the dispatch
// entries (report / close-report / report-profile). Bodies moved from app.js.
// The dialog + form singletons live in ../dom.js.

import { api } from "../api.js";
import {
  reportDialog,
  reportForm,
  setMessage,
} from "../dom.js";

let submittingReport = false;

function validId(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return false;
  }

  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0;
}

function getReportTitle() {
  return document.querySelector("#report-title");
}

function getReportTextarea() {
  return reportForm.querySelector("textarea");
}

function validateTarget(targetType, targetId) {
  if (
    !["post", "profile"].includes(targetType) ||
    !validId(targetId)
  ) {
    throw new Error(
      "That report target is no longer available.",
    );
  }

  return {
    type: targetType,
    id: String(Number(targetId)),
  };
}

// The dialog opener: a card's Report button passes the button (the post ID
// rides its dataset); the profile button passes a {type, id} pair.
function openReportDialog(target) {
  const isButton = target instanceof HTMLButtonElement;

  const targetType = isButton
    ? "post"
    : target?.type;

  const targetId = isButton
    ? target.dataset.postId
    : target?.id;

  const validated = validateTarget(
    targetType,
    targetId,
  );

  const title = getReportTitle();
  const textarea = getReportTextarea();

  if (!title || !textarea) {
    throw new Error(
      "The report dialog is not available.",
    );
  }

  if (submittingReport) return;

  // Clear any abandoned draft from an earlier report.
  reportForm.reset();

  reportForm.dataset.targetType = validated.type;
  reportForm.dataset.targetId = validated.id;

  title.textContent =
    validated.type === "profile"
      ? "Report this profile"
      : "Report this post";

  reportDialog.showModal();
  textarea.focus();
}

async function submitReportForm(text) {
  if (submittingReport) return;

  const targetType = reportForm.dataset.targetType;
  const targetId = reportForm.dataset.targetId;

  const validated = validateTarget(
    targetType,
    targetId,
  );

  const title = getReportTitle();

  if (!title) {
    throw new Error(
      "The report dialog is not available.",
    );
  }

  const reason = text("reason");

  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error("Enter a reason for your report.");
  }

  const endpoint =
    validated.type === "profile"
      ? `/api/users/${encodeURIComponent(validated.id)}/reports`
      : `/api/posts/${encodeURIComponent(validated.id)}/reports`;

  submittingReport = true;

  try {
    await api(endpoint, {
      method: "POST",
      body: { reason },
    });

    reportDialog.close();
    reportForm.reset();

    delete reportForm.dataset.targetType;
    delete reportForm.dataset.targetId;

    title.textContent = "Report this post";

    setMessage("Your report was sent to the mods.");
  } finally {
    submittingReport = false;
  }
}

// The registration seam: the report form submits through FORM_HANDLERS;
// the dialog's open/close buttons merge into handleButtonAction's dispatch.
export const FORM_HANDLERS = {
  report: (form, text) =>
    submitReportForm(text),
};

export const ACTIONS = {
  report: (button) =>
    openReportDialog(button),

  "close-report": () => {
    if (submittingReport) return;

    reportDialog.close();
  },

  "report-profile": (button) =>
    openReportDialog({
      type: "profile",
      id: button.dataset.profileId,
    }),
};
