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

// Browser side of per-deployment modules (docs/modules.md). The worker stamps
// the ids of the browser-side modules the owner (or the server) switched off
// into <meta name="site-modules-off" content="chat,embeds">. No meta means
// nothing is off: today's behaviour. Nothing here fetches or stores.
export const SITE_MODULES_OFF_META = "site-modules-off";

export function offSiteModules(doc = globalThis.document) {
  try {
    const content = doc?.querySelector?.(`meta[name="${SITE_MODULES_OFF_META}"]`)?.getAttribute("content") ?? "";
    return new Set(String(content).split(",").map((id) => id.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export const siteModuleOn = (id, doc = globalThis.document) => !offSiteModules(doc).has(id);
