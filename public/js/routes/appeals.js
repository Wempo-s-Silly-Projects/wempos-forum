// v4.0 plan 4 Task 7: the appeals concern — the desk's approve/deny submits
// and the session-less ban appeal from the ban screen (the /appeals route
// itself went away with the auto-mod removal in v4.2; ban appeals file from
// the ban screen, where there is no session). Bodies moved verbatim out of
// app.js; bare renderRoute calls inside moved bodies re-read the boot state
// (state.renderRoute).
import { api } from "../api.js";
import { setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";

async function submitAppealDecision(form) {
  await api("/api/admin/appeals/" + encodeURIComponent(form.dataset.appealId) + "/" + form.dataset.decision, { method: "POST" });
  await state.renderRoute(state.activeRoute);
  setMessage(form.dataset.decision === "approve" ? "Appeal approved." : "Appeal denied.");
}

async function submitBanAppealForm(form, text) {
  // The ban screen has no session, so there is no CSRF token — the same-origin
  // header is the guard, and the username + password (the identity proof)
  // travel in the body.
  await api("/api/appeals", {
    method: "POST",
    body: { username: text("username"), password: text("password"), body: text("body") },
  });
  setMessage("Appeal filed — an admin will review it.");
  form.replaceChildren();
  addText(document, form, "p", "Appeal received. You can close this page now.", "empty-state");
}

export const FORM_HANDLERS = {
  "admin-appeal": (form) => submitAppealDecision(form),
  "ban-appeal": (form, text) => submitBanAppealForm(form, text),
};

