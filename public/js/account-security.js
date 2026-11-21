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

// Wave 5.14: the account settings' security counts. F1 "Backup codes left"
// fills a note into the two-factor Backup codes panel; F2 "Signed-in devices"
// shows how many OTHER forum sessions this account holds and offers "Sign out
// everywhere else". Both read GET /api/me/security (counts only — never a
// code, secret or token), fetched once when the settings page renders. The
// note is a <div>, so the backup panel's form/codes swaps (which keep only
// h2/p) drop a count that a new set would make stale. Text via textContent.
import { api } from "./api.js";
import { t } from "./i18n.js";

const LOW_BACKUP_CODES = 3;

export function backupCodesLeftText(count) {
  return t("account.backupLeft", { count });
}

function backupLevel(count) {
  if (count <= 0) return "none";
  return count <= LOW_BACKUP_CODES ? "low" : "ok";
}

export function fillBackupCodesLeft(panel, count, document = globalThis.document) {
  if (!panel) return;
  for (const stale of [...panel.querySelectorAll(".backup-codes-left")]) stale.remove();
  const level = backupLevel(count);
  const note = document.createElement("div");
  note.className = "backup-codes-left form-note";
  note.dataset.level = level;
  if (level === "none") note.textContent = t("account.backupNone");
  else if (level === "low") note.textContent = `${backupCodesLeftText(count)} ${t("account.backupLow")}`;
  else note.textContent = backupCodesLeftText(count);
  const heading = panel.querySelector("p") ?? panel.querySelector("h2");
  if (heading?.insertAdjacentElement) heading.insertAdjacentElement("afterend", note);
  else panel.append(note);
}

export function createSessionsPanel(document = globalThis.document) {
  const panel = document.createElement("section");
  panel.className = "panel sessions-panel";
  const heading = document.createElement("h2");
  heading.textContent = t("account.sessionsTitle");
  const intro = document.createElement("p");
  intro.className = "muted";
  intro.textContent = t("account.sessionsNote");
  const count = document.createElement("div");
  count.className = "sessions-count";
  count.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-secondary";
  button.dataset.action = "sessions-sign-out-others";
  button.textContent = t("account.sessionsSignOut");
  button.hidden = true;
  panel.append(heading, intro, count, button);
  return panel;
}

export function fillSessionsPanel(panel, otherSessions) {
  const count = panel?.querySelector(".sessions-count");
  const button = panel?.querySelector("button");
  if (!count || !button) return;
  const others = Math.max(0, Number(otherSessions) || 0);
  count.textContent = others > 0
    ? t("account.sessionsCount", { count: others })
    : t("account.sessionsNone");
  button.hidden = others === 0;
}

// Mounted by the settings renderer right after the two-factor section. A
// failed read leaves the panels without counts; nothing else breaks.
export function renderAccountSecurity(account, document = globalThis.document) {
  const panel = createSessionsPanel(document);
  account.append(panel);
  api("/api/me/security")
    .then((data) => {
      fillSessionsPanel(panel, data.otherSessions);
      if (data.totpEnabled) {
        fillBackupCodesLeft(account.querySelector("[data-backup-panel]"), data.backupCodesLeft, document);
      }
    })
    .catch(() => {});
}

async function signOutOthers(button) {
  const panel = button.closest(".sessions-panel");
  button.disabled = true;
  try {
    const result = await api("/api/me/sessions/sign-out-others", { method: "POST", body: {} });
    fillSessionsPanel(panel, 0);
    const count = panel?.querySelector(".sessions-count");
    if (count) count.textContent = t("account.sessionsDone", { count: Number(result.signedOut) || 0 });
  } finally {
    button.disabled = false;
  }
}

export const ACTIONS = {
  "sessions-sign-out-others": (button) => signOutOthers(button),
};
