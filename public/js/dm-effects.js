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

// Message effects (v4.7, opt-in, client-only): when a member turns the
// switch on, a DM made of only 1-3 emoji renders jumbo and a fresh one pops
// in once. Nothing leaves the device — the preference lives in localStorage
// (every touch try/catch: private windows and blocked storage read as off).
// Pure helpers only; chat-widget.js does the DOM wiring.
export const EFFECTS_STORAGE_KEY = "wempo-dm-effects";
const EMOJI_MAX = 3;
const EMOJI_BODY_MAX_CHARS = 64;
// eslint-disable-next-line no-misleading-character-class -- ZWJ and VS16 are listed as standalone code points on purpose (the u flag matches them singly)
const EMOJI_GRAPHEME = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}‍️\u{e0020}-\u{e007f}]+$/u;
const EMOJI_BASE = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

export function isEmojiOnly(body) {
  if (typeof body !== "string") return false;
  const text = body.trim();
  if (!text || text.length > EMOJI_BODY_MAX_CHARS || typeof Intl?.Segmenter !== "function") return false;
  let count = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    if (/^\s+$/u.test(segment)) continue;
    if (!EMOJI_GRAPHEME.test(segment) || !EMOJI_BASE.test(segment)) return false;
    count += 1;
    if (count > EMOJI_MAX) return false;
  }
  return count > 0;
}

export function readEffectsPref(storage) {
  try {
    return storage?.getItem(EFFECTS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeEffectsPref(storage, on) {
  try {
    storage?.setItem(EFFECTS_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Blocked storage: the switch still works for this page view.
  }
}
