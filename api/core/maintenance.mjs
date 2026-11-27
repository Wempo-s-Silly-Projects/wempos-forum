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
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

const FAILURE_THRESHOLD = 3;
const RECOVERY_THRESHOLD = 3;
const CACHE_TTL_MS = 5_000;
const READ_STATE_SQL = `
  SELECT active, failure_streak, success_streak, last_checked_at, last_transition_at
  FROM automatic_maintenance_state
  WHERE id = 1
  LIMIT 1
`;

let cachedDatabase = null;
let cachedState = null;
let cachedUntil = 0;

function emptyState() {
  return {
    active: false,
    failureStreak: 0,
    successStreak: 0,
    lastCheckedAt: null,
    lastTransitionAt: null,
  };
}

function normaliseState(row) {
  if (!row) return emptyState();
  return {
    active: Number(row.active) === 1,
    failureStreak: Number.isInteger(Number(row.failure_streak)) && Number(row.failure_streak) > 0
      ? Number(row.failure_streak)
      : 0,
    successStreak: Number.isInteger(Number(row.success_streak)) && Number(row.success_streak) > 0
      ? Number(row.success_streak)
      : 0,
    lastCheckedAt: typeof row.last_checked_at === "string" ? row.last_checked_at : null,
    lastTransitionAt: typeof row.last_transition_at === "string" ? row.last_transition_at : null,
  };
}

async function readState(database) {
  const row = await database.prepare(READ_STATE_SQL).first();
  return normaliseState(row);
}

export async function isAutoMaintenanceActive(env) {
  const database = env?.FORUM_DB;
  if (!database) return false;

  const now = Date.now();
  if (cachedDatabase === database && cachedState && now < cachedUntil) {
    return cachedState.active;
  }

  try {
    const state = await readState(database);
    cachedDatabase = database;
    cachedState = state;
    cachedUntil = now + CACHE_TTL_MS;
    return state.active;
  } catch {
    // The monitor's own D1 state must not take the forum offline. The manual
    // override remains available if the monitor table cannot be read.
    return false;
  }
}

export async function recordMaintenanceHealth(env, healthy, now = Date.now()) {
  const database = env?.FORUM_DB;
  if (!database) return null;

  const checkedAt = new Date(now).toISOString();
  const failed = healthy ? 0 : 1;
  const succeeded = healthy ? 1 : 0;

  // A single D1 UPSERT is an atomic read/modify/write. Concurrent scheduled
  // invocations are serialised by SQLite, so every observation contributes
  // exactly once and stale reads cannot overwrite a later transition.
  await database.prepare(`
    INSERT INTO automatic_maintenance_state (
      id, active, failure_streak, success_streak, last_checked_at, last_transition_at
    )
    VALUES (1, 0, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      last_transition_at = CASE
        WHEN automatic_maintenance_state.active = 0
          AND excluded.failure_streak = 1
          AND automatic_maintenance_state.failure_streak + 1 >= ?
          THEN excluded.last_checked_at
        WHEN automatic_maintenance_state.active = 1
          AND excluded.success_streak = 1
          AND automatic_maintenance_state.success_streak + 1 >= ?
          THEN excluded.last_checked_at
        ELSE automatic_maintenance_state.last_transition_at
      END,
      active = CASE
        WHEN automatic_maintenance_state.active = 0
          AND excluded.failure_streak = 1
          AND automatic_maintenance_state.failure_streak + 1 >= ? THEN 1
        WHEN automatic_maintenance_state.active = 1
          AND excluded.success_streak = 1
          AND automatic_maintenance_state.success_streak + 1 >= ? THEN 0
        ELSE automatic_maintenance_state.active
      END,
      failure_streak = CASE
        WHEN automatic_maintenance_state.active = 0 AND excluded.failure_streak = 1
          AND automatic_maintenance_state.failure_streak + 1 < ?
          THEN automatic_maintenance_state.failure_streak + 1
        ELSE 0
      END,
      success_streak = CASE
        WHEN automatic_maintenance_state.active = 1 AND excluded.success_streak = 1
          AND automatic_maintenance_state.success_streak + 1 < ?
          THEN automatic_maintenance_state.success_streak + 1
        ELSE 0
      END,
      last_checked_at = excluded.last_checked_at
  `).bind(
    failed,
    succeeded,
    checkedAt,
    FAILURE_THRESHOLD,
    RECOVERY_THRESHOLD,
    FAILURE_THRESHOLD,
    RECOVERY_THRESHOLD,
    FAILURE_THRESHOLD,
    RECOVERY_THRESHOLD,
  ).run();

  const state = await readState(database);
  cachedDatabase = database;
  cachedState = state;
  cachedUntil = now + CACHE_TTL_MS;
  return state;
}
