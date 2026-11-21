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

// v4.0 plan 4 Task 9: the report-dialog concern — the shared report dialog
// (posts and profiles both funnel here), its submit, and the dispatch
// entries (report / close-report / report-profile). Bodies moved verbatim
// out of app.js. The dialog + form singletons live in ../dom.js.
import { api } from "../api.js";
import { reportDialog, reportForm, setMessage } from "../dom.js";
import { t } from "../i18n.js";

// The dialog opener: a card's Report button passes the button (the post id
// rides its dataset); the profile button passes a {type, id} pair.
function openReportDialog(target) {
  const isButton = target instanceof HTMLButtonElement;
  const targetType = isButton ? "post" : target.type;
  const targetId = isButton ? target.dataset.postId : target.id;
  if (!["post", "profile"].includes(targetType) || !targetId) {
    throw new Error(t("reports.targetGone"));
  }
  reportForm.dataset.targetType = targetType;
  reportForm.dataset.targetId = String(targetId);
  document.querySelector("#report-title").textContent =
    targetType === "profile" ? t("reports.titleProfile") : t("reports.titlePost");
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
  document.querySelector("#report-title").textContent = t("reports.titlePost");
  setMessage(t("reports.sent"));
}

// The registration seam: the report form submits through FORM_HANDLERS; the
// dialog's open/close buttons merge into handleButtonAction's dispatch map.
export const FORM_HANDLERS = {
  report: (form, text) => submitReportForm(text),
};

export const ACTIONS = {
  report: (button) => openReportDialog(button),
  "close-report": () => reportDialog.close(),
  "report-profile": (button) => openReportDialog({ type: "profile", id: button.dataset.profileId }),
};
