// v4.0.1: the TOTP two-factor UI — the account settings section (enable /
// disable, staged secret + confirm code) and the login's second step. 2FA
// ONLY: there is no recovery code path anywhere, by the feature spec.
// The client never stores the secret after the confirm round-trip; the
// staged secret is shown once, for authenticator-app entry.
import { api, setCsrfToken } from "../api.js";
import { createPanel, element, main, setMessage } from "../dom.js";
import { createForm, createInput, addText } from "../forms.js";
import { state } from "../state.js";

// The account settings section. Appended by renderAccountSettings into the
// settings `details` panel; the panel body swaps between the off and on
// branches, both rendered fresh from the session's totpEnabled flag.
export function renderTotpSettings(container, session) {
  const enabled = Boolean(session.user && session.user.totpEnabled);
  const panel = createPanel(
    "Two-factor sign-in",
    enabled
      ? "Signing in needs your password and a 6-digit code from your authenticator app. Turn it off here only if you still hold the secret."
      : "Add a second step to sign-in: an authenticator app (like Google Authenticator or Aegis) generates the 6-digit code. Keep the secret safe — there is no email recovery.",
  );
  panel.dataset.totpPanel = enabled ? "on" : "off";

  if (!enabled) {
    const start = element("button", "button", "Enable two-factor");
    start.type = "button";
    start.dataset.action = "start-totp-setup";
    panel.append(start);
    container.append(panel);
    return;
  }

  panel.append(createForm(document, "totp-disable", [
    createInput(document, {
      id: "totp-disable-code", name: "code", label: "6-digit code",
      inputMode: "numeric", pattern: "[0-9]*", maxLength: 6, required: true,
      autoComplete: "one-time-code",
    }),
  ], "Turn off two-factor"));
  container.append(panel);
}

// The staged-secret step: rendered in place when the setup request returns.
// The secret and the otpauth URI are shown as copyable read-only fields —
// no image QR (hand-entry or paste-URI both work in every authenticator),
// and the code field proves possession before anything is kept.
async function openSetupStep(panel) {
  const result = await api("/api/me/totp/setup", { method: "POST" });
  setMessage("Add the secret to your authenticator, then confirm with a code.");
  panel.replaceChildren();
  const note = element("p", "form-note");
  note.textContent =
    "Type this secret into your authenticator app (or paste the otpauth line). It shows once — reload throws it away until you confirm.";
  panel.append(note);
  const secretLabel = element("label", "form-label");
  secretLabel.append(document.createTextNode("Secret"));
  const secretInput = element("input", "form-input");
  secretInput.type = "text";
  secretInput.readOnly = true;
  secretInput.value = result.secret;
  secretLabel.append(secretInput);
  panel.append(secretLabel);
  const uriLabel = element("label", "form-label");
  uriLabel.append(document.createTextNode("otpauth URI"));
  const uriInput = element("input", "form-input");
  uriInput.type = "text";
  uriInput.readOnly = true;
  uriInput.value = result.otpauth;
  uriLabel.append(uriInput);
  panel.append(uriLabel);
  panel.append(createForm(document, "totp-confirm", [
    createInput(document, {
      id: "totp-confirm-code", name: "code", label: "6-digit code from your app",
      inputMode: "numeric", pattern: "[0-9]*", maxLength: 6, required: true,
      autoComplete: "one-time-code",
    }),
  ], "Turn on two-factor"));
}

async function submitTotpConfirm(form, text) {
  const result = await api("/api/me/totp/confirm", {
    method: "POST",
    body: { code: text("code") },
  });
  if (state.currentUser) state.currentUser.totpEnabled = result.totpEnabled;
  await state.renderRoute(state.activeRoute);
  setMessage("Two-factor sign-in is on. Keep your authenticator safe.");
}

async function submitTotpDisable(form, text) {
  const result = await api("/api/me/totp/disable", {
    method: "POST",
    body: { code: text("code") },
  });
  if (state.currentUser) state.currentUser.totpEnabled = result.totpEnabled;
  await state.renderRoute(state.activeRoute);
  setMessage("Two-factor sign-in is off.");
}

// The login's second step replaces the join panel: the server already
// verified the password and holds a single-use challenge. The challenge
// token rides this one form; POST /api/auth/totp mints the session.
export function renderTotpLoginStep(challenge) {
  const panel = createPanel(
    "Two-factor code",
    "Enter the 6-digit code from your authenticator app to finish signing in.",
  );
  const form = element("form");
  form.dataset.form = "totp-login";
  const challengeInput = document.createElement("input");
  challengeInput.type = "hidden";
  challengeInput.name = "challenge";
  challengeInput.value = challenge;
  form.append(challengeInput);
  form.append(createInput(document, {
    id: "totp-login-code", name: "code", label: "6-digit code",
    inputMode: "numeric", pattern: "[0-9]*", maxLength: 6, required: true,
    autoComplete: "one-time-code",
  }));
  const send = element("button", "button button-primary", "Verify code");
  send.type = "submit";
  form.append(send);
  panel.append(form);
  addText(document, panel, "p", "Request a new code by signing in again — each passcode question is single-use.", "form-note");
  main.replaceChildren(panel);
}

async function submitTotpLogin(form, text) {
  const result = await api("/api/auth/totp", {
    method: "POST",
    body: { challenge: text("challenge"), code: text("code") },
  });
  setCsrfToken(result.csrfToken);
  state.router.navigate("/");
  setMessage("You're signed in with your two-factor code.");
}

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch
// map; ACTIONS merges into handleButtonAction's dispatch map.
export const FORM_HANDLERS = {
  "totp-confirm": (form, text) => submitTotpConfirm(form, text),
  "totp-disable": (form, text) => submitTotpDisable(form, text),
  "totp-login": (form, text) => submitTotpLogin(form, text),
};

export const ACTIONS = {
  "start-totp-setup": async (button) => {
    const panel = button.closest("[data-totp-panel]");
    if (!panel) return;
    await openSetupStep(panel);
  },
};
