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

// Animated badge art (Batch M #2 and #4), behind "Animated badges and
// highlights": the member's next-badge line gets a small Lottie star (the
// lottie_light SVG build, no eval) that plays once, and that badge card tilts
// gently under a fine pointer (vanilla-tilt). Reduced motion shows the
// star's first frame and never tilts; touch screens never tilt.
import { isFunOn, prefersReducedMotion } from "./settings.js";

const FINE_POINTER = "(pointer: fine)"; // i18n-ignore
const TILT = Object.freeze({ max: 8, speed: 400, scale: 1.03, glare: false, gyroscope: false });

// A hand-made 1 s Lottie: a gold five-point star that pops in and turns.
const STAR_POINTS = [[0, -40], [11, -14], [38, -12], [17, 5], [24, 32], [0, 17], [-24, 32], [-17, 5], [-38, -12], [-11, -14]];
export const BADGE_STAR_ANIMATION = Object.freeze({
  v: "5.7.0", fr: 30, ip: 0, op: 30, w: 100, h: 100, nm: "badge-star", ddd: 0, assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 4, nm: "star", sr: 1, ip: 0, op: 30, st: 0, bm: 0,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 1, k: [{ t: 0, s: [-30], i: { x: [0.3], y: [1] }, o: { x: [0.7], y: [0] } }, { t: 24, s: [0] }] },
      p: { a: 0, k: [50, 50, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 1, k: [
        { t: 0, s: [0, 0, 100], i: { x: [0.3], y: [1.6] }, o: { x: [0.7], y: [0] } },
        { t: 18, s: [100, 100, 100] },
      ] },
    },
    shapes: [{
      ty: "gr", nm: "shape",
      it: [
        { ty: "sh", ks: { a: 0, k: { c: true, v: STAR_POINTS, i: STAR_POINTS.map(() => [0, 0]), o: STAR_POINTS.map(() => [0, 0]) } } },
        { ty: "fl", c: { a: 0, k: [0.96, 0.73, 0.18, 1] }, o: { a: 0, k: 100 }, r: 1 },
        { ty: "st", c: { a: 0, k: [0.7, 0.45, 0.05, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 3 }, lc: 2, lj: 2 },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      ],
    }],
  }],
});

async function playStar(container, env, still) {
  const lottie = await env.load("lottie");
  const animation = lottie.loadAnimation({
    container, renderer: "svg", loop: false, autoplay: !still, animationData: BADGE_STAR_ANIMATION,
  });
  if (still) animation.goToAndStop(0, true);
}

async function tilt(card, env) {
  const VanillaTilt = await env.load("vanillaTilt");
  VanillaTilt.init(card, TILT);
}

export async function decorateBadges(root, env) {
  if (!isFunOn("motion", env.storage)) return;
  const still = prefersReducedMotion(env.win);
  const fine = env.win?.matchMedia?.(FINE_POINTER)?.matches === true;
  for (const line of root?.querySelectorAll?.(".profile-next-badge") ?? []) {
    if (line.dataset.funDecorated) continue;
    line.dataset.funDecorated = "true";
    const art = env.doc.createElement("span");
    art.className = "fun-badge-art";
    art.setAttribute("aria-hidden", "true");
    line.prepend(art);
    line.classList.add("fun-badge-card");
    try {
      await playStar(art, env, still);
      if (!still && fine) await tilt(line, env);
    } catch {
      art.remove();
    }
  }
}
