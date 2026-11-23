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

// Role tiers (v3.1 rename): the PUBLIC vocabulary is member / admin / owner,
// but users.role stores the PRE-RENAME values — 'moderator' is the admin tier
// and 'admin' is the owner tier. D1 cannot alter a CHECK constraint short of
// rebuilding every table that references users, so the stored vocabulary is
// FROZEN (ROLE_*_DB below) and publicRole() is the single map every role
// value passes through on its way out of SQL. All JS comparisons use the
// public values; only SQL literals and role WRITES use the stored constants.
// WARNING: publicRole is NOT idempotent — publicRole('admin') === 'owner' —
// so only ever feed it raw DB values.
export const ROLE_OWNER_DB = "admin";
export const ROLE_ADMIN_DB = "moderator";
export const ROLE_MEMBER_DB = "member";
const PUBLIC_ROLE_BY_STORED = Object.freeze({
  member: "member",
  moderator: "admin",
  admin: "owner",
});

export function publicRole(value) {
  if (typeof value !== "string") return value;

  return Object.hasOwn(PUBLIC_ROLE_BY_STORED, value)
    ? PUBLIC_ROLE_BY_STORED[value]
    : value;
}
