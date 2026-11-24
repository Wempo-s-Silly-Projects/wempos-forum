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

// Serbian script helpers for the sr (Cyrillic) and sr-Latn bundles. The
// mapping is the standard 1:1 Serbian one (lj/nj/dž are single letters).
// Text that is not Serbian stays Latin in both bundles: {placeholders}, URLs,
// domains, paths, code identifiers, tokens with digits, words that use
// q/w/x/y, and the brand and technical names listed in LATIN_WORDS.

const LATIN_TO_CYRILLIC = Object.freeze({
  a: "а", b: "б", c: "ц", č: "ч", ć: "ћ", d: "д", đ: "ђ", e: "е", f: "ф", g: "г", h: "х", i: "и",
  j: "ј", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", r: "р", s: "с", š: "ш", t: "т", u: "у",
  v: "в", z: "з", ž: "ж",
});
const DIGRAPHS = Object.freeze({ lj: "љ", nj: "њ", dž: "џ" });
const CYRILLIC_TO_LATIN = Object.freeze(Object.fromEntries([
  ...Object.entries(LATIN_TO_CYRILLIC), ...Object.entries(DIGRAPHS),
].map(([latin, cyrillic]) => [cyrillic, latin])));

// Kept Latin wherever they appear: brands, file formats, units, keyboard keys.
export const LATIN_WORDS = Object.freeze(new Set([
  "Accounts", "Aegis", "Authenticator", "AutoMod", "Bitwarden", "CSS", "Ctrl", "End", "Enter", "Esc",
  "GIF", "Google", "HTML", "Home", "IP", "JPEG", "JSON", "KB", "Konami", "Mac", "Mastodon",
  "MiB", "PNG", "Polytoria", "QR", "SHA", "Tab", "URI", "URL", "ZIP", "glob",
]));
// Multi-word names and code snippets kept verbatim.
const LATIN_PHRASES = ["Do Not Track", "Global Privacy Control", "Cloudflare Workers AI", "body { font-family: serif; }", "a–z"];
// Single-letter key names, only on the keyboard-shortcut strings.
const SHORTCUT_KEY = /^(shortcuts|ux\.keys)/;
const SHORTCUT_LETTERS = new Set(["C", "G", "H", "J", "K"]);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PROTECTED = new RegExp([
  ...LATIN_PHRASES.map(escape),
  String.raw`\{\w+\}`,
  String.raw`https?://\S+`,
  String.raw`[A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)+`,
  String.raw`(?<![\p{L}\p{N}])/[A-Za-z]+/?`,
  String.raw`#[0-9A-Fa-f]{3,8}\b`,
  String.raw`\b\w*_\w*\b`,
  String.raw`\b[A-Za-z]*\d\w*`,
].join("|"), "gu");
const LATIN_WORD = /[A-Za-zČčĆćĐđŠšŽž]+/g;

function keepsLatin(word, key) {
  if (/[qwxyQWXY]/.test(word) || LATIN_WORDS.has(word)) return true;
  return SHORTCUT_KEY.test(key) && SHORTCUT_LETTERS.has(word);
}

// Calls convert(segment) on the parts of text outside protected spans.
function mapUnprotected(text, convert) {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(PROTECTED)) {
    out += convert(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + convert(text.slice(last));
}

const withCase = (source, cyrillic) => (source[0] === source[0].toLowerCase() ? cyrillic : cyrillic.toUpperCase());

function wordToCyrillic(word) {
  let out = "";
  for (let index = 0; index < word.length;) {
    const pair = word.slice(index, index + 2);
    const digraph = DIGRAPHS[pair.toLowerCase()];
    if (digraph) {
      out += withCase(pair, digraph);
      index += 2;
    } else {
      const char = word[index];
      out += withCase(char, LATIN_TO_CYRILLIC[char.toLowerCase()] ?? char);
      index += 1;
    }
  }
  return out;
}

export function toCyrillic(text, key = "") {
  return mapUnprotected(text, (segment) => segment.replace(LATIN_WORD,
    (word) => (keepsLatin(word, key) ? word : wordToCyrillic(word))));
}

export function toLatin(text) {
  const chars = [...text];
  return chars.map((char, index) => {
    const latin = CYRILLIC_TO_LATIN[char.toLowerCase()];
    if (!latin) return char;
    if (char === char.toLowerCase()) return latin;
    const next = chars[index + 1] ?? "";
    const nextIsUpper = next !== next.toLowerCase();
    return nextIsUpper ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1);
  }).join("");
}

// Latin letters left after removing everything allowed to stay Latin.
export function strayLatin(text, key = "") {
  const stray = [];
  mapUnprotected(text, (segment) => {
    for (const [word] of segment.matchAll(LATIN_WORD)) if (!keepsLatin(word, key)) stray.push(word);
    return segment;
  });
  return stray;
}
