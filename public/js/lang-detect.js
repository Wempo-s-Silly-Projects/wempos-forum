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

// Post language hint (batch L item 4): a post body's language, guessed in
// the browser and set as the `lang` attribute on the rendered body, so
// screen readers pick the right voice and the browser's own Translate offer
// knows what it is looking at. No network: the trigram profiles and script
// expressions are franc-min's (vendored verbatim, MIT), loaded lazily on
// the first post; the scoring follows franc's published method (the
// most-used script picks the candidate set, then the 300 most frequent
// padded trigrams are ranked against each language profile).
import { maskSpoilers } from "./markdown.js";

export const LANG_DETECT_MIN_CHARS = 40;

const SAMPLE_MAX_CHARS = 2048;
const MAX_DIFFERENCE = 300;
const UNDETERMINED = null;

// franc-min's ISO 639-3 codes → the shortest BCP 47 tag. Codes with no
// two-letter form stay three letters (themselves valid BCP 47).
const BCP47 = Object.freeze({
  spa: "es", eng: "en", por: "pt", ind: "id", fra: "fr", deu: "de", jav: "jv", vie: "vi", ita: "it",
  tur: "tr", pol: "pl", swh: "sw", sun: "su", ron: "ro", hau: "ha", bos: "bs", hrv: "hr", nld: "nl",
  srp: "sr", yor: "yo", uzn: "uz", zlm: "ms", ibo: "ig", tgl: "tl", hun: "hu", azj: "az", ces: "cs",
  run: "rn", plt: "mg", nya: "ny", kin: "rw", zul: "zu", swe: "sv", lin: "ln", som: "so", rus: "ru",
  ukr: "uk", bel: "be", bul: "bg", kaz: "kk", arb: "ar", urd: "ur", pes: "fa", pbu: "ps", hin: "hi",
  mar: "mr", npi: "ne", cmn: "zh", ben: "bn", jpn: "ja", kor: "ko", tel: "te", tam: "ta", guj: "gu",
  kan: "kn", mal: "ml", mya: "my", pan: "pa", amh: "am", tha: "th", sin: "si", ell: "el",
});
const tagFor = (code) => BCP47[code] ?? (/^[a-z]{3}$/.test(code) ? code : UNDETERMINED);

// Markdown that is not prose: fenced and inline code, links' targets, bare
// URLs, @mentions and markup punctuation.
export function proseOf(body) {
  return String(body ?? "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\]\([^)\s]*\)/g, "]")
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    .replace(/@[A-Za-z0-9_]+/g, " ")
    .replace(/[#>*_~|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const letterCount = (text) => (text.match(/\p{L}/gu) ?? []).length;

function trigramsByFrequency(text) {
  const cleaned = " " + text.replace(/[!-@]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase() + " ";
  const counts = new Map();
  for (let index = 0; index + 3 <= cleaned.length; index += 1) {
    const gram = cleaned.slice(index, index + 3);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[1] - b[1]);
}

function topScript(text, expressions) {
  let best = null;
  let bestShare = -1;
  for (const [script, expression] of Object.entries(expressions)) {
    const share = (text.match(new RegExp(expression.source, "g")) ?? []).length / text.length;
    if (share > bestShare) {
      bestShare = share;
      best = script;
    }
  }
  return bestShare > 0 ? best : null;
}

const profileCache = new WeakMap();

function profilesFor(data, script) {
  if (!profileCache.has(data)) profileCache.set(data, new Map());
  const cache = profileCache.get(data);
  if (!cache.has(script)) {
    const languages = Object.entries(data[script] ?? {}).map(([code, model]) => {
      const ranks = new Map(model.split("|").map((gram, rank) => [gram, rank]));
      return [code, ranks];
    });
    cache.set(script, languages);
  }
  return cache.get(script);
}

function distance(trigrams, ranks) {
  let total = 0;
  for (const [gram, count] of trigrams) {
    total += ranks.has(gram) ? Math.abs(count - ranks.get(gram) - 1) : MAX_DIFFERENCE;
  }
  return total;
}

// Pure: the BCP 47 tag for `body`, or null when it is too short, mostly
// code, or no language matches.
export function detectLanguageFrom(body, { data, expressions }) {
  const text = proseOf(maskSpoilers(body)).slice(0, SAMPLE_MAX_CHARS);
  if (letterCount(text) < LANG_DETECT_MIN_CHARS) return UNDETERMINED;
  const script = topScript(text, expressions);
  if (!script) return UNDETERMINED;
  if (!(script in data)) return tagFor(script);
  const trigrams = trigramsByFrequency(text);
  let best = null;
  let bestDistance = Infinity;
  for (const [code, ranks] of profilesFor(data, script)) {
    const score = distance(trigrams, ranks);
    if (score < bestDistance) {
      bestDistance = score;
      best = code;
    }
  }
  return best ? tagFor(best) : UNDETERMINED;
}

let loading = null;
const loadProfiles = () => {
  loading ??= Promise.all([import("./vendor/franc-min/data.js"), import("./vendor/franc-min/expressions.js")])
    .then(([dataModule, expressionModule]) => ({ data: dataModule.data, expressions: expressionModule.expressions }));
  return loading;
};

export async function detectLanguage(body) {
  if (letterCount(proseOf(body)) < LANG_DETECT_MIN_CHARS) return UNDETERMINED;
  try {
    return detectLanguageFrom(body, await loadProfiles());
  } catch {
    return UNDETERMINED;
  }
}

// The render hook: sets lang on the body element (or each of a list of
// body block elements) once the guess is in.
export async function applyPostLanguage(target, body) {
  const tag = await detectLanguage(body);
  const elements = Array.isArray(target) ? target : [target];
  if (tag) for (const element of elements) element?.setAttribute?.("lang", tag);
  return tag;
}
