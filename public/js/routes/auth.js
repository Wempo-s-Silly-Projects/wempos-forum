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

// v4.0 plan 4 Task 2 + the §4b door-swap: the auth concern is now only the
// first-owner setup screens and the home route's guest access gate. The
// password login/register forms are GONE — Wempo Accounts
// (accounts.wempos-forum.com) is the one sign-in surface: the header's
// Sign in link, the mobile bar's guest rung, and the home route's door panel
// all point there, and a `?wt` ticket redeems at boot (sso.js, called from
// app.js) before any route renders. No form here posts /api/login or
// /api/register anymore; /api/auth/* and /api/setup stay the workers'
// plumbing (untouched) and setup remains an out-of-band owner surface.
import { addText, createForm, createInput } from "../forms.js";
import { api, setCsrfToken } from "../api.js";
import { createPanel, element, main, setMessage } from "../dom.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { wempoAccountsSignInUrl } from "../sso.js";

// The home route's guest rung (§4b): the door panel — no local forms, just
// the Accounts handoff. Cross-origin jump: the SPA's internal navigation only
// rewrites same-origin paths, and it must NOT intercept this one.
function doorPanel() {
  const panel = createPanel(t("auth.doorTitle"), t("auth.doorBody"));
  const button = element("a", "button button-primary sso-entry-button", t("auth.doorButton"));
  button.href = wempoAccountsSignInUrl(location.origin);
  panel.append(button);
  main.append(panel);
}

function setupForm() {
  const panel = createPanel(t("auth.setupTitle"), t("auth.setupIntro"));
  panel.append(createForm(document, "setup", [
    createInput(document, {
      id: "setup-username", name: "username", label: t("auth.ownerUsername"),
      autoComplete: "username", required: true, minLength: 3, maxLength: 24,
    }),
    createInput(document, {
      id: "setup-password", name: "password", label: t("auth.password"),
      type: "password", autoComplete: "new-password", required: true, minLength: 12, maxLength: 128,
    }),
    createInput(document, {
      id: "setup-key", name: "setupKey", label: t("auth.setupSecret"), type: "password",
      autoComplete: "off", required: true, minLength: 32, maxLength: 4096,
      description: t("auth.setupSecretHelp"),
    }),
  ], t("auth.createOwner")));
  return panel;
}

function renderSetupLocked() {
  const panel = createPanel(
    t("auth.lockedTitle"),
    t("auth.lockedBody"),
  );
  main.append(panel);
}

function renderHomeAccess(session, setupRequired, setupConfigured) {
  if (setupRequired) {
    if (setupConfigured) main.append(setupForm());
    else renderSetupLocked();
    return;
  }
  if (!session.user) doorPanel();
}

function renderSetupRoute(context) {
  if (context.setupRequired) {
    if (context.setupConfigured) main.append(setupForm());
    else renderSetupLocked();
    return;
  }
  addText(document, main, "p", t("auth.setupDone"), "empty-state");
}

async function submitSetupForm(form, text) {
  const result = await api("/api/setup", {
    method: "POST",
    body: {
      username: text("username"),
      password: text("password"),
      setupKey: text("setupKey"),
    },
  });
  setCsrfToken(result.csrfToken);
  state.router.navigate("/");
  setMessage(t("auth.ownerCreated"));
}

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch map;
// renderSetupRoute takes the setup entry of renderRoute's renderer table and
// renderHomeAccess stays the home route's access gate (called from feed.js's
// renderHome until the feed task moves it).
export const FORM_HANDLERS = {
  setup: (form, text) => submitSetupForm(form, text),
};

export { renderHomeAccess, renderSetupRoute };
