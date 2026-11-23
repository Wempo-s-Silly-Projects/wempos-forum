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

// Batch F: passkeys in the browser. The vendored @simplewebauthn/browser
// (MIT) runs the WebAuthn ceremonies; api/passkeys.mjs verifies them. Two
// surfaces: the account-settings section (list, add with a current-password
// re-proof, remove) and a "Sign in with a passkey" button on the guest door.
import { api, setCsrfToken } from "./api.js";
import { createPanel, element, setMessage } from "./dom.js";
import { createForm, createInput } from "./forms.js";
import { state } from "./state.js";
import { t } from "./i18n.js";

// The vendored library loads only when a ceremony starts (not at boot).
const loadWebAuthn = () => import("./vendor/simplewebauthn-browser/index.js");

function browserSupportsWebAuthn() {
  return typeof globalThis.PublicKeyCredential === "function";
}

function formatDate(seconds) {
  return new Date(seconds * 1000).toLocaleDateString();
}

function renderPasskeyList(list, passkeys) {
  list.replaceChildren();
  if (passkeys.length === 0) {
    list.append(element("li", "muted", t("security.passkeyNone")));
    return;
  }
  for (const passkey of passkeys) {
    const item = element("li", "passkey-item");
    item.append(element("span", "passkey-name", passkey.name));
    item.append(element("span", "muted", " " + t("security.passkeyAddedOn", { date: formatDate(passkey.createdAt) })));
    const remove = element("button", "button button-quiet", t("security.passkeyRemove"));
    remove.type = "button";
    remove.dataset.action = "passkey-remove";
    remove.dataset.passkeyId = String(passkey.id);
    item.append(remove);
    list.append(item);
  }
}

async function refreshList(panel) {
  const list = panel.querySelector(".passkey-list");
  if (!list) return;
  try {
    const result = await api("/api/me/passkeys");
    renderPasskeyList(list, result.passkeys || []);
  } catch (error) {
    setMessage(error.message, true);
  }
}

// The settings section: appended by feed.js right after two-factor.
export function renderPasskeySettings(container) {
  const panel = createPanel(t("security.passkeysTitle"), t("security.passkeysIntro"));
  panel.dataset.passkeyPanel = "ready";
  if (!browserSupportsWebAuthn()) {
    panel.append(element("p", "form-note", t("security.passkeyUnsupported")));
    container.append(panel);
    return;
  }
  panel.append(element("ul", "passkey-list"));
  panel.append(createForm(document, "passkey-add", [
    createInput(document, {
      id: "passkey-add-password", name: "currentPassword", label: t("twofa.currentPassword"),
      type: "password", maxLength: 128, required: true, autoComplete: "current-password",
    }),
    createInput(document, {
      id: "passkey-add-name", name: "name", label: t("security.passkeyName"), maxLength: 64,
    }),
  ], t("security.passkeyAdd")));
  container.append(panel);
  refreshList(panel);
}

async function submitPasskeyAdd(form, text) {
  const options = await api("/api/me/passkeys/options", {
    method: "POST",
    body: { currentPassword: text("currentPassword") },
  });
  const { startRegistration } = await loadWebAuthn();
  const response = await startRegistration({ optionsJSON: options });
  await api("/api/me/passkeys", { method: "POST", body: { response, name: text("name") } });
  form.reset();
  setMessage(t("security.passkeyAdded"));
  const panel = form.closest("[data-passkey-panel]");
  if (panel) await refreshList(panel);
}

// The guest door's passkey button: options → the device prompt → verify.
// The new session's csrf token is stored, then the current route re-renders
// signed in (same as the SSO redeem landing on a fresh boot).
export function passkeySignInButton() {
  if (!browserSupportsWebAuthn()) return null;
  const button = element("button", "button button-quiet passkey-sign-in", t("security.passkeySignIn"));
  button.type = "button";
  button.dataset.action = "passkey-sign-in";
  return button;
}

async function signInWithPasskey(button) {
  button.disabled = true;
  try {
    const options = await api("/api/auth/passkey/options", { method: "POST", body: {} });
    const { startAuthentication } = await loadWebAuthn();
    const response = await startAuthentication({ optionsJSON: options });
    const result = await api("/api/auth/passkey", { method: "POST", body: { response } });
    if (typeof result.csrfToken === "string") setCsrfToken(result.csrfToken);
    state.currentUser = result.user;
    globalThis.location.reload();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

export const FORM_HANDLERS = {
  "passkey-add": (form, text) => submitPasskeyAdd(form, text),
};

export const ACTIONS = {
  "passkey-sign-in": (button) => signInWithPasskey(button),
  "passkey-remove": async (button) => {
    await api("/api/me/passkeys/" + button.dataset.passkeyId, { method: "DELETE" });
    setMessage(t("security.passkeyRemoved"));
    const panel = button.closest("[data-passkey-panel]");
    if (panel) await refreshList(panel);
  },
};
