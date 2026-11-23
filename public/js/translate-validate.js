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

// The translate module's validation laws (docs/translating.md; slate
// 2026-11-22-translate §4). Pure functions shared by the worker
// (api/translate.mjs, which re-runs every check), the browser (instant
// feedback in routes/translate.js) and scripts/translate-export.mjs. They
// mirror tests/i18n.test.mjs: the same {placeholder} regex, only the plural
// forms English has, no copy of English. Nothing here fetches or stores.
import { LOCALES } from "./i18n.js";

export const SOURCE_LOCALE = "en";
export const TRANSLATE_VALUE_HARD_MAX = 1000;
export const TRANSLATE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
const PLACEHOLDER = /\{(\w+)\}/g;
// Plural forms tn() reads besides .one/.other; English has none of them, and
// the i18n test demands the exact English key set, so they are refused.
const EXTRA_PLURAL = /\.(zero|two|few|many)$/;
// Tags, entities, control characters (newlines included) and the bidi
// override/isolate characters: refused, never stripped.
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const MARKUP = /<[^>]*>|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);|[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/i;

// Keys whose value may legitimately equal English (brand placeholders, the
// separator, product names). Read 2026-11-22: these are equal to English in
// most of the 65 shipped tables.
export const TRANSLATE_SAME_AS_EN_OK = Object.freeze([
  "shell.brand", "app.siteName", "app.titleWithPage", "counts.separator",
  "admin.section.automod", "composer.emoji", "render.roleBot",
]);

// The locales members can suggest for: every shipped table except English.
export const TRANSLATABLE_LOCALES = Object.freeze(LOCALES.filter((locale) => locale.code !== SOURCE_LOCALE));
const BY_CODE = new Map(TRANSLATABLE_LOCALES.map((locale) => [locale.code, locale]));
export const translatableLocale = (code) => BY_CODE.get(String(code)) ?? null;

export const placeholdersOf = (value) => [...String(value).matchAll(PLACEHOLDER)].map((match) => match[1]).sort();

// Graphemes where Intl.Segmenter exists, code points otherwise.
export function textLength(value) {
  const text = String(value);
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)).length;
  }
  return [...text].length;
}

export const translateValueMax = (source) => {
  const length = textLength(source);
  return Math.min(TRANSLATE_VALUE_HARD_MAX, Math.max(3 * length, length + 60));
};

export const isExtraPluralKey = (key) => EXTRA_PLURAL.test(String(key));
export const isMissing = (key, value, source) => value === source && !TRANSLATE_SAME_AS_EN_OK.includes(key);

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
const fold = (value) => String(value).trim().toLocaleLowerCase();
const edgeSpace = (value) => [/^\s/.test(value), /\s$/.test(value)];

// The first law a suggestion breaks, or null. Reasons map to
// translate.error.<reason> keys: placeholders, plural, tooLong,
// copyOfEnglish, markup. ("empty" never paints; the form needs text.)
export function suggestionProblem({ key, value, source }) {
  if (isExtraPluralKey(key)) return "plural";
  const text = typeof value === "string" ? value : "";
  if (!text.trim()) return "empty";
  if (MARKUP.test(text)) return "markup";
  const [leading, trailing] = edgeSpace(text);
  const [sourceLeading, sourceTrailing] = edgeSpace(source);
  if ((leading && !sourceLeading) || (trailing && !sourceTrailing)) return "markup";
  const names = placeholdersOf(text);
  const braces = (text.match(/[{}]/g) || []).length;
  if (!sameList(names, placeholdersOf(source)) || braces !== names.length * 2) return "placeholders";
  if (textLength(text) > translateValueMax(source)) return "tooLong";
  if (fold(text) === fold(source) && !TRANSLATE_SAME_AS_EN_OK.includes(key)) return "copyOfEnglish";
  return null;
}

// The numbers the plural helper previews, and which stored form tn() picks
// for each: only PluralRules "one" reads .one; everything else reads .other
// (no shipped table has .few/.many).
export const PLURAL_SAMPLES = Object.freeze([0, 1, 2, 5, 11, 21, 101]);
export function pluralNumbersFor(code, form) {
  let rules;
  try {
    rules = new Intl.PluralRules(code);
  } catch {
    rules = new Intl.PluralRules(SOURCE_LOCALE);
  }
  return PLURAL_SAMPLES.filter((n) => (rules.select(n) === "one" ? "one" : "other") === form);
}
