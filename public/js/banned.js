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

// Banned-account screen (spec §13): shown after a login attempt that verified
// against a banned account. renderBannedScreen appends into `main`; the caller
// (app.js login flow) is responsible for clearing main first, matching how the
// other route renderers own their own containers.
// Ban appeals (v3.1): the screen carries an appeal form. Banned members have
// no session by definition, so the appeal posts to the session-less
// POST /api/appeals with the username AND PASSWORD they tried to sign in
// with — the password proof keeps anyone from filing (or locking out) an
// appeal in a banned member's name.
import { addText, createForm, createInput, createTextarea } from "./forms.js";
import { currentLocale, t } from "./i18n.js";
import { formatDuration } from "./reltime.js";

// Pure, DOM-free. expiresAt is an epoch-seconds number from the login 403
// payload (null for permanent bans). Returns "3d 2h 14m"-style text in the
// active locale (wave 2026-11-21-3: Intl via reltime.js) with the leading
// zero units dropped, a trailing minutes unit always present, zero minutes
// once the ban has already expired, and null when there is no time to show.
export const formatBanCountdown = (expiresAt, now = null) => {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  const current = typeof now === "number" && Number.isFinite(now)
    ? now
    : Math.floor(Date.now() / 1000);
  return formatDuration(expiresAt - current, currentLocale());
};

export function renderBannedScreen(main, { reason, expiresAt, username = "", password = "" }) {
  const document = main.ownerDocument;
  const panel = document.createElement("section");
  panel.className = "panel banned-screen";
  const heading = document.createElement("h1");
  heading.className = "page-heading";
  heading.textContent = t("banned.heading");
  panel.append(heading);
  addText(document, panel, "p",
    typeof reason === "string" && reason ? reason : t("banned.noReason"),
    "banned-reason");
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    const countdown = addText(document, panel, "p", "", "banned-countdown");
    const tick = () => {
      // Stop ticking once the screen is gone (route change cleared main).
      if (!countdown.isConnected) {
        clearInterval(timer);
        return;
      }
      countdown.textContent = t("banned.reactivates", { time: formatBanCountdown(expiresAt) });
    };
    const timer = setInterval(tick, 1000);
    tick();
  } else {
    addText(document, panel, "p", t("banned.noReactivation"), "banned-countdown");
  }
  // Ban appeals (v3.1): no session exists here, so the form posts the
  // username and password it carries plus the appeal text; the server verifies
  // the password (the login already proved it, so this costs the real member
  // nothing) and matches the username to its ACTIVE ban, rejecting
  // duplicates. Both inputs stay editable (the member may have mistyped the
  // username while signing in).
  const appealForm = createForm(document, "ban-appeal", [
    createInput(document, {
      id: "ban-appeal-username",
      name: "username",
      label: t("banned.username"),
      required: true,
      minLength: 3,
      maxLength: 24,
      value: username,
    }),
    createInput(document, {
      id: "ban-appeal-password",
      name: "password",
      label: t("banned.password"),
      type: "password",
      autoComplete: "current-password",
      required: true,
      maxLength: 128,
      value: password,
    }),
    createTextarea(document, {
      id: "ban-appeal-body",
      name: "body",
      label: t("banned.appealBody"),
      required: true,
      maxLength: 1000,
      rows: 4,
    }),
  ], t("banned.appealButton"));
  panel.append(appealForm);
  main.append(panel);
  return panel;
}
