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

// Milestone confetti (Batch M #1): when a member's own profile shows a
// higher milestone badge than this device last saw them holding, one
// canvas-confetti burst plays, once. Only the member sees it (the next-badge
// line exists only on their own profile), the first sighting just remembers
// the badge (turning the toggle on is not an unlock), and reduced motion
// remembers without a burst. The vendored library uses our own canvas with
// its worker off (CSP 'self': no blob: workers).
import { BADGE_TIERS } from "../badge-progress.js";
import { isFunOn, prefersReducedMotion, rememberBadge } from "./settings.js";

// Mirrors constants.mjs (pinned equal by tests/batch-m-fun.test.mjs).
export const FUN_CONFETTI_PARTICLES = 120;
export const FUN_CONFETTI_CLEANUP_MS = 4000;
const BADGE_ORDER = BADGE_TIERS.map((tier) => tier.key);

const rank = (key) => BADGE_ORDER.indexOf(key);

async function burst(env) {
  const library = await env.load("confetti");
  const canvas = env.doc.createElement("canvas");
  canvas.className = "fun-confetti-canvas";
  canvas.setAttribute("aria-hidden", "true");
  env.doc.body.append(canvas);
  const fire = library.create(canvas, { resize: true, useWorker: false });
  fire({ particleCount: FUN_CONFETTI_PARTICLES, spread: 70, origin: { y: 0.6 }, disableForReducedMotion: true });
  (env.schedule ?? setTimeout)(() => {
    fire.reset?.();
    canvas.remove();
  }, FUN_CONFETTI_CLEANUP_MS);
}

// "off" | "none" | "seeded" | "same" | "still" | "burst" (tests read it).
export async function celebrateMilestone(root, env) {
  if (!isFunOn("confetti", env.storage)) return "off";
  const line = root?.querySelector?.(".profile-next-badge");
  const key = line?.dataset?.funBadge;
  if (!key || rank(key) < 0 || !env.userId) return "none";
  const previous = rememberBadge(env.storage, env.userId, key);
  if (!previous || rank(previous) < 0) return "seeded";
  if (rank(key) <= rank(previous)) return "same";
  if (prefersReducedMotion(env.win)) return "still";
  try {
    await burst(env);
    return "burst";
  } catch {
    return "still";
  }
}
