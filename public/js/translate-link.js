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

// The translate module's one entry point in the shell (docs/translating.md):
// a "Translate" link appended to the footer line, painted only while the
// module is on. Off, nothing is added and routes/translate.js never loads.
// No fetch, no storage; text via textContent.
import { t } from "./i18n.js";
import { siteModuleOn } from "./site-modules.js";

export const TRANSLATE_PATH = "/translate";

export function paintTranslateLink(doc = globalThis.document) {
  if (!siteModuleOn("translate", doc)) return;
  const line = doc?.querySelector?.(".site-footer p");
  if (!line || line.querySelector(`a[href="${TRANSLATE_PATH}"]`)) return;
  const link = doc.createElement("a");
  link.setAttribute("href", TRANSLATE_PATH);
  link.setAttribute("data-app-link", "");
  link.textContent = t("translate.nav");
  line.append(doc.createTextNode(" · "), link);
}
