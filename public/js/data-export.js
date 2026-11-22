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

// Download my data (v4.23): the account settings' "Your data" panel. The
// export is fetched only when the member presses the button (privacy law:
// network actions are explicit, never on render), through the one api()
// wrapper, then handed to the browser as a local file via a Blob URL — the
// data never goes anywhere but this member's own device.
import { t } from "./i18n.js";

export const EXPORT_PATH = "/api/me/export";
export const EXPORT_FILE_NAME = "wempos-forum-data.json";
// Some browsers read the Blob URL after the click returns; a short grace
// period before revoking keeps the download from racing the cleanup.
const REVOKE_DELAY_MS = 1000;

export function createDataExportPanel(doc) {
  const panel = doc.createElement("section");
  panel.className = "panel data-export-panel";
  const heading = doc.createElement("h2");
  heading.textContent = t("settings.dataTitle");
  const note = doc.createElement("p");
  note.className = "muted";
  note.textContent = t("settings.dataNote");
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "button button-secondary";
  button.dataset.action = "download-my-data";
  button.textContent = t("settings.dataDownload");
  // What the anonymous speed measurements collect (public/js/vitals.js).
  const vitals = doc.createElement("p");
  vitals.className = "muted";
  vitals.textContent = t("settings.vitalsNote");
  panel.append(heading, note, button, vitals);
  return panel;
}

export async function downloadMyData({
  api,
  doc = document,
  urls = URL,
  schedule = (fn) => setTimeout(fn, REVOKE_DELAY_MS),
}) {
  const data = await api(EXPORT_PATH);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const href = urls.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = href;
  link.download = EXPORT_FILE_NAME;
  link.hidden = true;
  doc.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    schedule(() => urls.revokeObjectURL(href));
  }
}
