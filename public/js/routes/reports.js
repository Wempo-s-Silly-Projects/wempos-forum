// v4.0 plan 4 Task 9: the report-dialog concern — the shared report dialog
// (posts and profiles both funnel here), its submit, and the dispatch
// entries (report / close-report / report-profile). Bodies moved verbatim
// out of app.js. The dialog + form singletons live in ../dom.js.
import { api } from "../api.js";
import { reportDialog, reportForm, setMessage } from "../dom.js";

// GIF picker functions (v2.5): open renders the approved library into the
// dialog grid; confirm folds the selection into the composer state; cancel
// closes. Selected thumbs carry aria-pressed so keyboard/AT state is real.
function openReportDialog(target) {
  const isButton = target instanceof HTMLButtonElement;
  const targetType = isButton ? "post" : target.type;
  const targetId = isButton ? target.dataset.postId : target.id;
  if (!["post", "profile"].includes(targetType) || !targetId) {
    throw new Error("That report target is no longer available.");
  }
  reportForm.dataset.targetType = targetType;
  reportForm.dataset.targetId = String(targetId);
  document.querySelector("#report-title").textContent =
    targetType === "profile" ? "Report this profile" : "Report this post";
  reportDialog.showModal();
  reportForm.querySelector("textarea").focus();
}

async function submitReportForm(text) {
  const targetType = reportForm.dataset.targetType || "post";
  const targetId = encodeURIComponent(reportForm.dataset.targetId || "");
  const endpoint = targetType === "profile"
    ? "/api/users/" + targetId + "/reports"
    : "/api/posts/" + targetId + "/reports";
  await api(endpoint, { method: "POST", body: { reason: text("reason") } });
  reportDialog.close();
  reportForm.reset();
  delete reportForm.dataset.targetType;
  delete reportForm.dataset.targetId;
  document.querySelector("#report-title").textContent = "Report this post";
  setMessage("Your report was sent to the mods.");
}

// The registration seam: the report form submits through FORM_HANDLERS; the
// dialog's open/close buttons merge into handleButtonAction's dispatch map.
export const FORM_HANDLERS = {
  report: (form, text) => submitReportForm(form, text),
};

export const ACTIONS = {
  report: (button) => openReportDialog(button),
  "close-report": () => reportDialog.close(),
  "report-profile": (button) => openReportDialog({ type: "profile", id: button.dataset.profileId }),
};
