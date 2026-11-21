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

// AGPL-3.0 §13 (v5.21.0): the footer's "Source code" link. index.html ships
// the anchor with the repository URL as its href (so it works without JS);
// at boot this points it at the worker-stamped <meta name="source-url"> —
// the repository tree at the deployed commit, or the operator's SOURCE_URL.
// The meta is re-validated here: only an https:// URL without credentials
// becomes the href, anything else keeps the repository fallback. The label
// is the translated data-i18n text; this module only sets the href.

export const DEFAULT_SOURCE_URL = "https://github.com/Wempo-s-Silly-Projects/wempos-forum";

export function safeSourceUrl(raw, fallback = DEFAULT_SOURCE_URL) {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}

export function readSourceUrl(doc) {
  const meta = doc?.querySelector?.('meta[name="source-url"]');
  return safeSourceUrl(meta?.getAttribute?.("content"));
}

export function paintSourceLink(doc) {
  const link = doc?.querySelector?.("a[data-source-link]");
  if (!link) return;
  link.setAttribute("href", readSourceUrl(doc));
}
