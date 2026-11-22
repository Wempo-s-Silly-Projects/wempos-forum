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

// Thread reading time (v5.47.0): "N min read" under a thread's title, client
// only. Counted from the root and the replies the page already rendered (the
// server shaped them for this viewer), so it costs no request and stores
// nothing. Each body is MASKED first — a spoiler counts as its mask token and
// is never unmasked. Shown only on roots of READING_TIME_MIN_WORDS or more.
import { maskSpoilers } from "./markdown.js";
import { tn } from "./i18n.js";

export const READING_WPM = 230;
export const READING_TIME_MIN_WORDS = 400;

const wordsIn = (body) => {
  if (typeof body !== "string") return 0;
  const text = maskSpoilers(body).trim();
  return text ? text.split(/\s+/).length : 0;
};

export function threadWordCount(root, replies) {
  const list = Array.isArray(replies) ? replies : [];
  let total = wordsIn(root?.body);
  for (const reply of list) total += wordsIn(reply?.body);
  return total;
}

export const readingMinutes = (words) => Math.max(1, Math.ceil(Number(words) / READING_WPM));

export function createReadingTime(document, root, replies) {
  if (!root || (root.parent !== null && root.parent !== undefined)) return null;
  const words = threadWordCount(root, replies);
  if (words < READING_TIME_MIN_WORDS) return null;
  const line = document.createElement("p");
  line.className = "thread-reading-time";
  line.textContent = tn("readingTime.minutes", readingMinutes(words));
  return line;
}
