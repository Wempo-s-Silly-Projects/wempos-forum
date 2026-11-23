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

// Every host a Content-Security-Policy names, as exact hostnames. Tests
// compare these with === instead of matching URL-ish substrings, so a host
// check can never be satisfied by a lookalike (evil-challenges.cloudflare.com).
export function cspHosts(csp) {
  return new Set(csp.split(/[;\s]+/)
    .filter((source) => /^https?:\/\//.test(source))
    .map((source) => new URL(source).hostname));
}
