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

// Typed home headline (Batch M #5), behind "Typed headline on the home
// page": TypeIt types the home hero's h1 (as text, never parsed as markup,
// no cursor), then Splitting.js splits it into letters for one CSS wave.
// Screen readers get the whole headline at once (aria-label on the h1, the
// typed copy is aria-hidden). Reduced motion keeps the plain heading and
// loads nothing. Home hero only.
import { isFunOn, prefersReducedMotion } from "./settings.js";

const TYPE_SPEED_MS = 45;

export async function typeHeroHeadline(root, env) {
  if (!isFunOn("heroType", env.storage) || prefersReducedMotion(env.win)) return;
  const heading = root?.querySelector?.(".personal-intro")?.querySelector("h1");
  if (!heading || heading.dataset.funTyped) return;
  heading.dataset.funTyped = "true";
  const text = heading.textContent;
  try {
    const [TypeIt, Splitting] = await Promise.all([env.load("typeIt"), env.load("splitting")]);
    const typed = env.doc.createElement("span");
    typed.className = "fun-hero-type";
    typed.setAttribute("aria-hidden", "true");
    heading.setAttribute("aria-label", text);
    heading.replaceChildren(typed);
    new TypeIt(typed, {
      strings: [text],
      html: false,
      cursor: false,
      speed: TYPE_SPEED_MS,
      afterComplete: () => {
        typed.textContent = text;
        Splitting({ target: typed, by: "chars" });
        typed.classList.add("fun-hero-wave");
      },
    }).go();
  } catch {
    heading.textContent = text;
    heading.removeAttribute("aria-label");
  }
}
