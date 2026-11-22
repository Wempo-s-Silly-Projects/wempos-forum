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

const LEADING_BOM = /^\uFEFF/;
const LINE_BREAKS = /\r\n?/g;

// normalizeBodyText(value) -> member-written text with one leading U+FEFF
// dropped and CRLF / lone CR folded to LF. Runs BEFORE trimming and length
// caps so a pasted Windows body is counted the way it is stored. Non-strings
// pass through untouched so the caller's own type check still answers.
export function normalizeBodyText(value) {
  if (typeof value !== "string") return value;
  return value.replace(LEADING_BOM, "").replace(LINE_BREAKS, "\n");
}
