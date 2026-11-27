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

const STATE_KEY = "system/maintenance-state.json";
const FAILURE_THRESHOLD = 3;
const RECOVERY_THRESHOLD = 3;
const CACHE_TTL_MS = 5_000;

let cachedBucket = null;
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

function normaliseState(value) {
  if (!value || typeof value !== "object") return emptyState();
  return {
    active: value.active === true,
    failureStreak: Number.isInteger(value.failureStreak) && value.failureStreak > 0 ? value.failureStreak : 0,
    successStreak: Number.isInteger(value.successStreak) && value.successStreak > 0 ? value.successStreak : 0,
    lastCheckedAt: typeof value.lastCheckedAt === "string" ? value.lastCheckedAt : null,
    lastTransitionAt: typeof value.lastTransitionAt === "string" ? value.lastTransitionAt : null,
  };
}

async function readState(bucket) {
  const object = await bucket.get(STATE_KEY);
  return object ? normaliseState(await object.json()) : emptyState();
}

export async function isAutoMaintenanceActive(env) {
  const bucket = env?.MAINTENANCE_STATE;
  if (!bucket) return false;

  const now = Date.now();
  if (cachedBucket === bucket && cachedState && now < cachedUntil) {
    return cachedState.active;
  }

  try {
    const state = await readState(bucket);
    cachedBucket = bucket;
    cachedState = state;
    cachedUntil = now + CACHE_TTL_MS;
    return state.active;
  } catch {
    // If the state store itself is unavailable, do not take the whole forum
    // offline because of the monitor. The manual override remains available.
    return false;
  }
}

export async function recordMaintenanceHealth(env, healthy, now = Date.now()) {
  const bucket = env?.MAINTENANCE_STATE;
  if (!bucket) return null;

  const current = await readState(bucket);
  const next = {
    ...current,
    lastCheckedAt: new Date(now).toISOString(),
  };

  if (healthy) {
    next.failureStreak = 0;
    if (current.active) {
      next.successStreak = current.successStreak + 1;
      if (next.successStreak >= RECOVERY_THRESHOLD) {
        next.active = false;
        next.successStreak = 0;
        next.lastTransitionAt = next.lastCheckedAt;
      }
    } else {
      next.successStreak = 0;
    }
  } else {
    next.successStreak = 0;
    if (!current.active) {
      next.failureStreak = current.failureStreak + 1;
      if (next.failureStreak >= FAILURE_THRESHOLD) {
        next.active = true;
        next.failureStreak = 0;
        next.lastTransitionAt = next.lastCheckedAt;
      }
    } else {
      next.failureStreak = 0;
    }
  }

  await bucket.put(STATE_KEY, JSON.stringify(next), {
    httpMetadata: { contentType: "application/json" },
  });
  cachedBucket = bucket;
  cachedState = next;
  cachedUntil = now + CACHE_TTL_MS;
  return next;
}
