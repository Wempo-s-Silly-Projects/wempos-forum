
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

const VALID_DECISIONS = new Set(["approve", "deny"]);

async function submitAppealDecision(form) {
  const appealId = form.dataset.appealId;
  const decision = form.dataset.decision;

  if (
    typeof appealId !== "string" ||
    !/^[1-9]\d*$/.test(appealId) ||
    !VALID_DECISIONS.has(decision)
  ) {
    throw new Error("Invalid appeal decision or appeal ID.");
  }

  await api(
    "/api/admin/appeals/" +
      encodeURIComponent(appealId) +
      "/" +
      decision,
    {
      method: "POST",
    },
  );

  await state.renderRoute(state.activeRoute);

  setMessage(
    decision === "approve"
      ? "Appeal approved."
      : "Appeal denied.",
  );
}

async function submitBanAppealForm(form, text) {
  // The ban screen has no session, so there is no CSRF token — the same-origin
  // header is the guard, and the username + password (the identity proof)
  // travel in the body.
  if (form.dataset.submitting === "true") {
    return;
  }

  const username = text("username").trim();
  const password = text("password");
  const body = text("body").trim();

  if (!username || !password || !body) {
    throw new Error("Enter your username, password, and appeal message.");
  }

  form.dataset.submitting = "true";

  try {
    await api("/api/appeals", {
      method: "POST",
      body: {
        username,
        password,
        body,
      },
    });

    setMessage("Appeal filed — an admin will review it.");

    form.replaceChildren();

    addText(
      document,
      form,
      "p",
      "Appeal received. You can close this page now.",
      "empty-state",
    );
  } catch (error) {
    delete form.dataset.submitting;
    throw error;
  }
}

export const FORM_HANDLERS = {
  "admin-appeal": (form) =>
    submitAppealDecision(form),

  "ban-appeal": (form, text) =>
    submitBanAppealForm(form, text),
};
