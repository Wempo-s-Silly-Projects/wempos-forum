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

// Stat counters (Batch J): a number marked data-count-up="<n>" (the
// leaderboard scores) ticks up from zero once, with the vendored CountUp.js
// (MIT), formatted for the reader's locale. The final number is already in
// the markup, so under prefers-reduced-motion (or if CountUp fails to load)
// the reader just sees it, static.
import { prefersReducedMotion } from "./focus-utils.js";
import { currentLocale } from "./i18n.js";

const COUNT_ATTRIBUTE = "data-count-up";
const DONE_ATTRIBUTE = "data-counted";
const COUNT_SECONDS = 1.2;

export function countUpStats(root, { CountUp, win = globalThis, locale = currentLocale() } = {}) {
  if (typeof CountUp !== "function" || prefersReducedMotion(win)) return;
  const format = (value) => Math.round(value).toLocaleString(locale);
  root?.querySelectorAll?.("[" + COUNT_ATTRIBUTE + "]")?.forEach((node) => {
    if (node.hasAttribute(DONE_ATTRIBUTE)) return;
    const end = Number(node.getAttribute(COUNT_ATTRIBUTE));
    if (!Number.isFinite(end)) return;
    node.setAttribute(DONE_ATTRIBUTE, "");
    new CountUp(node, end, { duration: COUNT_SECONDS, formattingFn: format }).start();
  });
}
