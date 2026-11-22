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

// Poll closing time (v5.38.0 F3, migration 0066). A poll may carry one
// deadline in poll_deadlines (post_id → closes_at). It is set as a duration
// from now (`closesIn`, 1 hour … 30 days) so client clocks never matter.
// Nothing runs at the deadline: every read and every vote compares closes_at
// with "now" bound at request time, and a passed deadline is treated exactly
// like a manually closed poll (api/polls.mjs).
import { HttpError } from "./core/http.mjs";

export const POLL_DEADLINE_MIN_SECONDS = 3600;
export const POLL_DEADLINE_MAX_SECONDS = 30 * 24 * 3600;

// Guard fragment for a statement that already names `polls`: true while the
// poll has no deadline or it is still ahead. Binds "now" once.
export const POLL_DEADLINE_AHEAD_SQL =
  "NOT EXISTS (SELECT 1 FROM poll_deadlines d WHERE d.post_id = polls.post_id AND d.closes_at <= ?)";

// undefined = not given; null = clear; else the validated seconds. 400 otherwise.
export function parseClosesIn(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < POLL_DEADLINE_MIN_SECONDS || value > POLL_DEADLINE_MAX_SECONDS) {
    throw new HttpError(400, "Pick a closing time between 1 hour and 30 days from now.");
  }
  return value;
}

// The poll's deadline in unix seconds, or null.
export async function readPollDeadline(db, postId) {
  const row = await db.prepare("SELECT closes_at FROM poll_deadlines WHERE post_id = ? LIMIT 1")
    .bind(Number(postId)).first();
  return row ? Number(row.closes_at) : null;
}

export const deadlinePassed = (closesAt, nowSec) => closesAt !== null && closesAt <= nowSec;

export function deadlineWriteStatement(db, postId, closesAt) {
  if (closesAt === null) return db.prepare("DELETE FROM poll_deadlines WHERE post_id = ?").bind(Number(postId));
  return db.prepare(
    "INSERT INTO poll_deadlines (post_id, closes_at) VALUES (?, ?) " +
    "ON CONFLICT(post_id) DO UPDATE SET closes_at = excluded.closes_at",
  ).bind(Number(postId), closesAt);
}
