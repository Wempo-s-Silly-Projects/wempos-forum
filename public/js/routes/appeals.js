// v4.0 plan 4 Task 7: the appeals concern — the /appeals route (the signed-in
// auto-mod appeal queue + history) and its submits (member appeal, the desk's
// approve/deny, and the session-less ban appeal from the ban screen). Bodies
// moved verbatim out of app.js; bare renderRoute calls inside moved bodies
// re-read the boot state (state.renderRoute).
import { api } from "../api.js";
import { addHeading, element, main, setMessage } from "../dom.js";
import { addText, createForm, createTextarea } from "../forms.js";
import { state } from "../state.js";

// Appeals (v3.1): the member surface for auto-mod decisions — the removals
// they can still appeal, plus their history. BAN appeals file from the ban
// screen instead (banned members have no session to get here with).
async function renderAppealsRoute(context, version) {
  addHeading(main, "Appeals", 1);
  if (!context.session.user) {
    addText(document, main, "p", "Sign in to appeal an auto-mod decision.", "muted");
    return;
  }
  const data = await api("/api/me/appeals");
  if (version !== state.renderVersion) return;
  addHeading(main, "Auto-mod decisions you can appeal", 2);
  if (!data.appealableActions.length) {
    addText(document, main, "p", "Nothing to appeal — auto-mod has not removed anything of yours.", "empty-state");
  }
  for (const action of data.appealableActions) {
    const item = element("div", "appeal-action-item");
    addText(document, item, "p",
      new Date(action.createdAt).toLocaleString() + " — " + action.reason, "muted");
    const form = createForm(document, "member-appeal", [
      createTextarea(document, {
        id: "appeal-body-" + action.id,
        name: "body",
        label: "Why was this removal wrong?",
        required: true,
        maxLength: 1000,
        rows: 3,
      }),
    ], "Appeal");
    form.dataset.actionId = String(action.id);
    item.append(form);
    main.append(item);
  }
  addHeading(main, "Your appeal history", 2);
  if (!data.appeals.length) {
    addText(document, main, "p", "You have not filed any appeals.", "empty-state");
    return;
  }
  for (const appeal of data.appeals) {
    const item = element("div", "appeal-history-item");
    addText(document, item, "p",
      (appeal.kind === "ban" ? "Ban appeal" : "Auto-mod appeal") + " — " + appeal.status +
      " — " + new Date(appeal.createdAt).toLocaleString(), "muted");
    if (appeal.reason) addText(document, item, "p", "About: " + appeal.reason, "muted");
    addText(document, item, "p", '"' + appeal.body + '"', "appeal-body");
    main.append(item);
  }
}

// Appeals (v3.1): the desk's approve/deny, the member's auto-mod appeal, and
// the session-less ban appeal from the ban screen.
async function submitAppealDecision(form) {
  await api("/api/admin/appeals/" + encodeURIComponent(form.dataset.appealId) + "/" + form.dataset.decision, { method: "POST" });
  await state.renderRoute(state.activeRoute);
  setMessage(form.dataset.decision === "approve" ? "Appeal approved." : "Appeal denied.");
}

async function submitMemberAppeal(form, text) {
  await api("/api/me/appeals", {
    method: "POST",
    body: { actionId: Number(form.dataset.actionId), body: text("body") },
  });
  await state.renderRoute(state.activeRoute);
  setMessage("Appeal filed — an admin will review it.");
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
  "member-appeal": (form, text) => submitMemberAppeal(form, text),
  "ban-appeal": (form, text) => submitBanAppealForm(form, text),
};

export { renderAppealsRoute };
