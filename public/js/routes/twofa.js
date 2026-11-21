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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// v4.0.1 + the §4b door-swap: the TOTP two-factor UI — the account settings
// section (enable/disable, staged secret + confirm code) and the single-use
// backup codes (v4.8.1). The login's second step is GONE: the password login
// panel it belonged to was removed with the door-swap (sign-in rides Wempo
// Accounts at boot). There is no email fallback; recovering from a lost
// authenticator is exactly what the backup codes are for. The client never
// stores the secret after the confirm round-trip; the staged secret is shown
// once, for authenticator-app entry — and a backup set is likewise shown
// exactly once, at generation.
import { api } from "../api.js";
import { createPanel, element, setMessage } from "../dom.js";
import { createCheckbox, createForm, createInput, addText } from "../forms.js";
import { state } from "../state.js";
import { t } from "../i18n.js";

// The account settings section. Appended by renderAccountSettings into the
// settings `details` panel; the panel body swaps between the off and on
// branches, both rendered fresh from the session's totpEnabled flag.
export function renderTotpSettings(container, session) {
  const enabled = Boolean(session.user && session.user.totpEnabled);
  const panel = createPanel(
    t("twofa.title"),
    enabled ? t("twofa.introOn") : t("twofa.introOff"),
  );
  panel.dataset.totpPanel = enabled ? "on" : "off";

  if (!enabled) {
    // Starting setup re-proofs the member with their CURRENT password (the
    // server rejects anything else) — a hijacked or abandoned tab cannot arm
    // a 2FA takeover on a standing session.
    panel.append(createForm(document, "totp-setup", [
      createInput(document, {
        id: "totp-setup-password", name: "currentPassword", label: t("twofa.currentPassword"),
        type: "password", maxLength: 128, required: true, autoComplete: "current-password",
        description: t("twofa.currentPasswordHelp"),
      }),
      // v5.20.0: opt-in SHA-256, unchecked by default — SHA-1 works with
      // every authenticator app. The confirm step proves a code under the
      // chosen algorithm, so a wrong app choice fails here, never at sign-in.
      createCheckbox(document, {
        id: "totp-setup-sha256", name: "sha256", label: t("twofa.useSha256"),
        description: t("twofa.useSha256Help"),
      }),
    ], t("twofa.enable")));
    container.append(panel);
    return;
  }

  panel.append(createForm(document, "totp-disable", [
    createInput(document, {
      id: "totp-disable-code", name: "code", label: t("twofa.codeOrBackup"),
      maxLength: 8, required: true,
      description: t("twofa.disableCodeHelp"),
    }),
  ], t("twofa.disable")));
  container.append(panel);

  // Backup codes (v4.8.1): the settings section rides only the ON branch —
  // codes exist exactly while the authenticator does, and turning 2FA off
  // wipes them server-side. Stage one is a button; the password/code form
  // (the regenerate's own confirmation) swaps in on click.
  const backupPanel = createPanel(
    t("twofa.backupTitle"),
    t("twofa.backupIntro"),
  );
  backupPanel.dataset.backupPanel = "ready";
  const ask = element("button", "button button-primary", t("twofa.generateAsk"));
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
    t("twofa.generateWarn"),
    "form-note",
  );
  panel.append(createForm(document, "totp-backups-generate", [
    createInput(document, {
      id: "totp-backups-password", name: "currentPassword", label: t("twofa.currentPassword"),
      type: "password", maxLength: 128, required: true, autoComplete: "current-password",
    }),
    createInput(document, {
      id: "totp-backups-code", name: "code", label: t("twofa.codeOrBackup"),
      maxLength: 8, required: true,
      description: t("twofa.generateCodeHelp"),
    }),
  ], t("twofa.generate")));
}

// The one look at a new set: a read-only block the member copies or writes
// down. This is built from the response's codes exactly once — the panel
// never persists them, and a reload or re-render throws them away.
function renderBackupCodes(panel, codes) {
  for (const node of [...panel.children]) {
    if (node.tagName !== "H2" && node.tagName !== "P") node.remove();
  }
  addText(document, panel, "p", t("twofa.backupShownOnce"), "form-note");
  const block = element("pre", "backup-codes", codes.join("\n"));
  panel.append(block);
  const done = element("button", "button button-quiet", t("common.done"));
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
  const result = await api("/api/me/totp/setup", {
    method: "POST",
    body: {
      currentPassword: text("currentPassword"),
      algorithm: text("sha256") === "on" ? "SHA256" : "SHA1",
    },
  });
  const panel = form.closest("[data-totp-panel]");
  if (panel) await openSetupStep(panel, result);
}

async function openSetupStep(panel, result) {
  setMessage(t("twofa.setupMessage"));
  // Swap only the body — the panel's h2 heading and lede stay put.
  for (const node of [...panel.children]) {
    if (node.tagName !== "H2" && node.tagName !== "P") node.remove();
  }
  const note = element("p", "form-note");
  note.textContent = t("twofa.setupNote");
  panel.append(note);
  const secretLabel = element("label", "form-label");
  secretLabel.append(document.createTextNode(t("twofa.secret")));
  const secretInput = element("input", "form-input");
  secretInput.type = "text";
  secretInput.readOnly = true;
  secretInput.value = result.secret;
  secretLabel.append(secretInput);
  panel.append(secretLabel);
  const uriLabel = element("label", "form-label");
  uriLabel.append(document.createTextNode(t("twofa.otpauthUri")));
  const uriInput = element("input", "form-input");
  uriInput.type = "text";
  uriInput.readOnly = true;
  uriInput.value = result.otpauth;
  uriLabel.append(uriInput);
  panel.append(uriLabel);
  panel.append(createForm(document, "totp-confirm", [
    createInput(document, {
      id: "totp-confirm-code", name: "code", label: t("twofa.confirmCode"),
      inputMode: "numeric", pattern: "[0-9]*", maxLength: 6, required: true,
      autoComplete: "one-time-code",
    }),
  ], t("twofa.confirmButton")));
}

async function submitTotpConfirm(form, text) {
  const result = await api("/api/me/totp/confirm", {
    method: "POST",
    body: { code: text("code") },
  });
  if (state.currentUser) state.currentUser.totpEnabled = result.totpEnabled;
  await state.renderRoute(state.activeRoute);
  setMessage(t("twofa.nowOn"));
}

async function submitTotpDisable(form, text) {
  const result = await api("/api/me/totp/disable", {
    method: "POST",
    body: { code: text("code").trim() },
  });
  if (state.currentUser) state.currentUser.totpEnabled = result.totpEnabled;
  await state.renderRoute(state.activeRoute);
  setMessage(t("twofa.nowOff"));
}

async function submitBackupGenerate(form, text) {
  const result = await api("/api/me/totp/backups/generate", {
    method: "POST",
    body: { currentPassword: text("currentPassword"), code: text("code").trim() },
  });
  const panel = form.closest("[data-backup-panel]");
  if (panel) renderBackupCodes(panel, result.codes);
}

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch
// map; ACTIONS merges into handleButtonAction's dispatch map.
export const FORM_HANDLERS = {
  "totp-setup": (form, text) => submitTotpSetup(form, text),
  "totp-confirm": (form, text) => submitTotpConfirm(form, text),
  "totp-disable": (form, text) => submitTotpDisable(form, text),
  "totp-backups-generate": (form, text) => submitBackupGenerate(form, text),
};

export const ACTIONS = {
  // Backup panel stage one → the confirm + generate form (stage two).
  "backup-generate-ask": (button) => {
    const panel = button.closest("[data-backup-panel]");
    if (panel) openBackupCodeForm(panel);
  },
};
