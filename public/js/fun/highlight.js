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

// Hand-drawn label highlight (Batch M #3), behind "Animated badges and
// highlights": the Staff Pick and Question of the Day labels get one
// rough-notation underline the first time they scroll into view. Reduced
// motion gets a plain static underline (CSS class) and loads nothing. The
// dash keyframes live in styles.css: rough-notation would otherwise inject
// an inline <style>, which the CSP (style-src 'self') refuses, so its
// injection flag is set before the first annotation.
import { isFunOn, prefersReducedMotion } from "./settings.js";

const LABELS = ".staff-pick-label, .qotd-label";
const STATIC_CLASS = "fun-static-underline";
const NOTE = Object.freeze({ type: "underline", color: "currentColor", strokeWidth: 2, iterations: 1, animationDuration: 800 });

async function annotate(label, env) {
  const RoughNotation = await env.load("roughNotation");
  if (env.win) env.win.__rno_kf_s = true;
  RoughNotation.annotate(label, NOTE).show();
}

// Annotates each label once it is on screen (at once without an observer).
function whenVisible(label, env, run) {
  const Observer = env.win?.IntersectionObserver;
  if (typeof Observer !== "function") return run();
  return new Promise((resolve) => {
    const observer = new Observer((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      resolve(run());
    });
    observer.observe(label);
  });
}

export async function highlightLabels(root, env) {
  if (!isFunOn("motion", env.storage)) return;
  const still = prefersReducedMotion(env.win);
  const pending = [];
  for (const label of root?.querySelectorAll?.(LABELS) ?? []) {
    if (label.dataset.funNoted) continue;
    label.dataset.funNoted = "true";
    if (still) {
      label.classList.add(STATIC_CLASS);
      continue;
    }
    pending.push(whenVisible(label, env, () => annotate(label, env).catch(() => label.classList.add(STATIC_CLASS))));
  }
  await Promise.all(pending);
}
