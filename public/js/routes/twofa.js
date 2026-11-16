// v4.0.1: the TOTP two-factor UI — the account settings section (enable /
// disable, staged secret + confirm code), the login's second step, and the
// single-use backup codes (v4.8.1). There is no email fallback; recover-
// ing from a lost authenticator is exactly what the backup codes are for.
// The client never stores the secret after the confirm round-trip; the
// staged secret is shown once, for authenticator-app entry — and a backup
// set is likewise shown exactly once, at generation.
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
    // Starting setup re-proofs the member with their CURRENT password (the
    // server rejects anything else) — a hijacked or abandoned tab cannot arm
    // a 2FA takeover on a standing session.
    panel.append(createForm(document, "totp-setup", [
      createInput(document, {
        id: "totp-setup-password", name: "currentPassword", label: "Current password",
        type: "password", maxLength: 128, required: true, autoComplete: "current-password",
        description: "Enter your current password — the secret is shown only after it verifies.",
      }),
    ], "Enable two-factor"));
    container.append(panel);
    return;
  }

  panel.append(createForm(document, "totp-disable", [
    createInput(document, {
      id: "totp-disable-code", name: "code", label: "6-digit code or backup code",
      maxLength: 8, required: true,
      description: "The authenticator's 6-digit code — or, if you lost your authenticator, an unburned backup code.",
    }),
  ], "Turn off two-factor"));
  container.append(panel);

  // Backup codes (v4.8.1): the settings section rides only the ON branch —
  // codes exist exactly while the authenticator does, and turning 2FA off
  // wipes them server-side. Stage one is a button; the password/code form
  // (the regenerate's own confirmation) swaps in on click.
  const backupPanel = createPanel(
    "Backup codes",
    "If you lose your authenticator, a backup code signs you in once. Each code works a single time.",
  );
  backupPanel.dataset.backupPanel = "ready";
  const ask = element("button", "button button-primary", "Generate new codes");
  ask.type = "button";
  ask.dataset.action = "backup-generate-ask";
  backupPanel.append(ask);
  container.append(backupPanel);
}

// Stage two of the backup panel: the generate form itself, introduced by the
// warn copy — regeneration REPLACES the old set, so the confirm happens
// before any password is typed.
function openBackupCodeForm(panel) {
  for (const node of [...panel.children]) {
    if (node.tagName !== "H2" && node.tagName !== "P") node.remove();
  }
  addText(
    document,
    panel,
    "p",
    "Generate 10 new codes? Your current backup codes stop working the moment the new set is created.",
    "form-note",
  );
  panel.append(createForm(document, "totp-backups-generate", [
    createInput(document, {
      id: "totp-backups-password", name: "currentPassword", label: "Current password",
      type: "password", maxLength: 128, required: true, autoComplete: "current-password",
    }),
    createInput(document, {
      id: "totp-backups-code", name: "code", label: "6-digit code or backup code",
      maxLength: 8, required: true,
      description: "The 6-digit code proves the authenticator; a backup code works instead if the app is lost.",
    }),
  ], "Generate codes"));
}

// The one look at a new set: a read-only block the member copies or writes
// down. This is built from the response's codes exactly once — the panel
// never persists them, and a reload or re-render throws them away.
function renderBackupCodes(panel, codes) {
  for (const node of [...panel.children]) {
    if (node.tagName !== "H2" && node.tagName !== "P") node.remove();
  }
  addText(document, panel, "p", "Each code signs you in once. These are shown only now — copy or write them down.", "form-note");
  const block = element("pre", "backup-codes", codes.join("\n"));
  panel.append(block);
  const done = element("button", "button button-quiet", "Done");
  done.type = "button";
  done.addEventListener("click", async () => {
    await state.renderRoute(state.activeRoute);
  });
  const actions = element("div", "backup-codes-actions");
  actions.append(done);
  panel.append(actions);
}

// The staged-secret step: rendered in place when the setup request returns.
// The secret and the otpauth URI are shown as copyable read-only fields —
// no image QR (hand-entry or paste-URI both work in every authenticator),
// and the code field proves possession before anything is kept. The setup
// POST carries the account's current password (server re-proofs it).
async function submitTotpSetup(form, text) {
  await api("/api/me/totp/setup", {
    method: "POST",
    body: { currentPassword: text("currentPassword") },
  });
  const panel = form.closest("[data-totp-panel]");
  if (panel) await openSetupStep(panel);
}

async function openSetupStep(panel) {
  setMessage("Add the secret to your authenticator, then confirm with a code.");
  // Swap only the body — the panel's h2 heading and lede stay put.
  for (const node of [...panel.children]) {
    if (node.tagName !== "H2" && node.tagName !== "P") node.remove();
  }
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
    body: { code: text("code").trim() },
  });
  if (state.currentUser) state.currentUser.totpEnabled = result.totpEnabled;
  await state.renderRoute(state.activeRoute);
  setMessage("Two-factor sign-in is off. Your backup codes were wiped.");
}

async function submitBackupGenerate(form, text) {
  const result = await api("/api/me/totp/backups/generate", {
    method: "POST",
    body: { currentPassword: text("currentPassword"), code: text("code").trim() },
  });
  const panel = form.closest("[data-backup-panel]");
  if (panel) renderBackupCodes(panel, result.codes);
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
    id: "totp-login-code", name: "code", label: "6-digit code or backup code",
    maxLength: 8, required: true,
    description: "Lost your authenticator? Enter a backup code.",
  }));
  const send = element("button", "button button-primary", "Verify code");
  send.type = "submit";
  form.append(send);
  panel.append(form);
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
  "totp-setup": (form, text) => submitTotpSetup(form, text),
  "totp-confirm": (form, text) => submitTotpConfirm(form, text),
  "totp-disable": (form, text) => submitTotpDisable(form, text),
  "totp-login": (form, text) => submitTotpLogin(form, text),
  "totp-backups-generate": (form, text) => submitBackupGenerate(form, text),
};

export const ACTIONS = {
  // Backup panel stage one → the confirm + generate form (stage two).
  "backup-generate-ask": (button) => {
    const panel = button.closest("[data-backup-panel]");
    if (panel) openBackupCodeForm(panel);
  },
};
