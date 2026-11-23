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

// AGPL-3.0 §13 (v5.21.0): the footer's "Source code" link must offer network
// users the Corresponding Source of the version actually running. The worker
// stamps it into the shell as <meta name="source-url">: the operator's
// SOURCE_URL when it is a valid https:// URL (a self-hoster who modifies the
// forum points it at THEIR source), else this repository's tree at the
// deployed COMMIT_SHA. Neither available → "" (no meta), and the client falls
// back to the repository URL. Nothing but https:// ever becomes the href.

export const DEFAULT_SOURCE_REPO = "https://github.com/Wempo-s-Silly-Projects/wempos-forum";
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}/i;

// A trimmed, absolute https:// URL without embedded credentials, normalized
// by the URL parser (so markup characters come back percent-encoded); "" for
// anything else.
export function httpsUrlOrEmpty(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function sourceUrl(env) {
  const configured = httpsUrlOrEmpty(env?.SOURCE_URL);
  if (configured) return configured;

  const commit = typeof env?.COMMIT_SHA === "string"
    ? env.COMMIT_SHA.trim()
    : "";

  const match = COMMIT_SHA_PATTERN.exec(commit);

  return match && match[0].length === commit.length
    ? `${DEFAULT_SOURCE_REPO}/tree/${commit}`
    : "";
}
