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

// v4.4 core leaf: member blocks — the both-direction predicate and the SQL
// fragments list surfaces use to hide blocked members' rows. Pure SQL over
// env.FORUM_DB, like visibility.mjs.
//
// Enforcement shape (owner's ask: "you can't see the person's posts when you
// block that person, and they can't interact with your posts / or see your
// profile"): a single row from EITHER direction hides content between the
// pair everywhere. Reactions, replies, and detail reads already gate through
// canViewPost, which consults blockPairExists — list SQL uses the fragment
// helpers below instead, since feeds filter rows in the SELECT, not per row.
// Staff never lose desk visibility: every read-path check bypasses for
// owner/admin viewers (stored-vocabulary roles — publicRole is NOT fed here).
//
// Phase-3 Kitskey migration: this vocabulary now LIVES in api/vendor/db.mjs
// (experience/db's makeBlockGate — byte-identical to the framework source,
// pinned by tests/vendor-parity.test.mjs). The gate is parameterized by the
// app: the table name rides config ("blocks", the framework's default —
// spelled here deliberately so the forum twin shows its parameters), the
// staff-read bypass rides staffRoles (the framework's "owner"/"admin"
// default matches the original's two-role check exactly), and the D1 binding
// is env.FORUM_DB — this repo's own name, already what makeBlockGate uses.
// Every behavior is the original's: pinned by tests/blocks-module.test.mjs.
import { makeBlockGate } from "../vendor/db.mjs";

const gate = makeBlockGate({ table: "blocks" });

export const blockPairExists = gate.blockPairExists;
export const blockFilterSql = gate.blockFilterSql;
export const blockedIdList = gate.blockedIdList;
export const viewerBlockFilterSql = gate.viewerBlockFilterSql;
