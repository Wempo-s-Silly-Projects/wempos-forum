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
