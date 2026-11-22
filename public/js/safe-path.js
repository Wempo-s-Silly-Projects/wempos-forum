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

// One shared gate for every "go here next" target: only a same-site path
// passes. It starts with exactly one "/", the second character is not "/"
// (protocol-relative), and no backslash, control, whitespace or line
// separator appears anywhere (browsers strip tabs/newlines and treat "\" as
// "/", either of which would revive "//"). Anything else answers null.
const BACKSLASH = 0x5c;
const LAST_C0_OR_SPACE = 0x20;
const C1_FIRST = 0x7f;
const C1_LAST = 0x9f;
const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;

function isUnsafeCode(code) {
  return code <= LAST_C0_OR_SPACE || (code >= C1_FIRST && code <= C1_LAST) ||
    code === BACKSLASH || code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR;
}

export function safeInternalPath(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value[0] !== "/" || value[1] === "/") return null;
  for (let i = 0; i < value.length; i++) {
    if (isUnsafeCode(value.charCodeAt(i))) return null;
  }
  return value;
}
