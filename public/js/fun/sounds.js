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

// Notification sounds (Batch M #6), behind "Notification sounds": when the
// unread count rises, one short chime synthesised by ZzFX (no audio files,
// nothing fetched but the same-origin module, once). Off by default, silent
// during quiet hours (the one gate in quiet-hours.js), at most one chime per
// FUN_SOUND_MIN_GAP_MS. A browser that blocks audio before a gesture simply
// stays silent.
import { notificationAlertsAllowed } from "../quiet-hours.js";
import { ZZFX_MODULE } from "./loader.js";
import { isFunOn } from "./settings.js";

// Mirrors constants.mjs (pinned equal by tests/batch-m-fun.test.mjs).
export const FUN_SOUND_MIN_GAP_MS = 4000;
// A soft two-note "ding" (ZzFX parameter list: volume, randomness, frequency...).
export const CHIME = Object.freeze([0.4, 0, 880, 0.01, 0.05, 0.2, 0, 1.5, 0, 0, 220, 0.06]);

let lastChimeAt = -Infinity;

export async function chimeForUnread(previous, next, env) {
  if (!(Number(next) > Number(previous))) return false;
  if (!isFunOn("sounds", env.storage)) return false;
  if (!notificationAlertsAllowed(env.storage)) return false;
  const now = env.now?.() ?? Date.now();
  if (now - lastChimeAt < FUN_SOUND_MIN_GAP_MS) return false;
  lastChimeAt = now;
  try {
    const { zzfx } = await env.importModule(ZZFX_MODULE);
    zzfx(...CHIME);
    return true;
  } catch {
    return false;
  }
}
