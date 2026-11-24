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

// Wave i18n (v4.6.0): the forum's own translations, no third-party service.
// Strings live in /locales/<code>.json (flat dotted keys, en.json is the
// source table). t(key, vars) is synchronous, so every surface awaits
// i18nReady() once before it paints; lookups fall back to English, then to
// the key itself. Values are always painted with textContent by callers.

export const DEFAULT_LOCALE = "en";
export const STORAGE_KEY = "wempo-locale";
const PLURAL_ONE = "one";
const PLURAL_OTHER = "other";
const EXTRA_PLURALS = new Set(["few", "many"]);

// Native names so a member can find their language whatever is showing now.
export const LOCALES = Object.freeze([
  { code: "en", name: "English", dir: "ltr" },
  { code: "es", name: "Español", dir: "ltr" },
  { code: "pt", name: "Português", dir: "ltr" },
  { code: "fr", name: "Français", dir: "ltr" },
  { code: "br", name: "Brezhoneg", dir: "ltr" },
  { code: "kw", name: "Kernewek", dir: "ltr" },
  { code: "de", name: "Deutsch", dir: "ltr" },
  { code: "it", name: "Italiano", dir: "ltr" },
  { code: "co", name: "Corsu", dir: "ltr" },
  { code: "ca", name: "Català", dir: "ltr" },
  { code: "eu", name: "Euskara", dir: "ltr" },
  { code: "an", name: "Aragonés", dir: "ltr" },
  { code: "eo", name: "Esperanto", dir: "ltr" },
  { code: "ro", name: "Română", dir: "ltr" },
  { code: "nl", name: "Nederlands", dir: "ltr" },
  { code: "af", name: "Afrikaans", dir: "ltr" },
  { code: "da", name: "Dansk", dir: "ltr" },
  { code: "nb", name: "Norsk bokmål", dir: "ltr" },
  { code: "sv", name: "Svenska", dir: "ltr" },
  { code: "fi", name: "Suomi", dir: "ltr" },
  { code: "et", name: "Eesti", dir: "ltr" },
  { code: "pl", name: "Polski", dir: "ltr" },
  { code: "cs", name: "Čeština", dir: "ltr" },
  { code: "sk", name: "Slovenčina", dir: "ltr" },
  { code: "hu", name: "Magyar", dir: "ltr" },
  { code: "hr", name: "Hrvatski", dir: "ltr" },
  { code: "sr", name: "Српски", dir: "ltr" },
  { code: "sr-Latn", name: "Srpski (latinica)", dir: "ltr" },
  { code: "bs", name: "Bosanski", dir: "ltr" },
  { code: "bg", name: "Български", dir: "ltr" },
  { code: "sq", name: "Shqip", dir: "ltr" },
  { code: "el", name: "Ελληνικά", dir: "ltr" },
  { code: "ru", name: "Русский", dir: "ltr" },
  { code: "uk", name: "Українська", dir: "ltr" },
  { code: "be", name: "Беларуская", dir: "ltr" },
  { code: "ab", name: "Аҧсуа", dir: "ltr" },
  { code: "av", name: "Авар мацӏ", dir: "ltr" },
  { code: "ba", name: "Башҡорт теле", dir: "ltr" },
  { code: "cv", name: "Чӑвашла", dir: "ltr" },
  { code: "ce", name: "Нохчийн мотт", dir: "ltr" },
  { code: "tr", name: "Türkçe", dir: "ltr" },
  { code: "az", name: "Azərbaycanca", dir: "ltr" },
  { code: "hy", name: "Հայերեն", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "he", name: "עברית", dir: "rtl" },
  { code: "fa", name: "فارسی", dir: "rtl" },
  { code: "ur", name: "اردو", dir: "rtl" },
  { code: "dv", name: "ދިވެހި", dir: "rtl" },
  { code: "hi", name: "हिन्दी", dir: "ltr" },
  { code: "bn", name: "বাংলা", dir: "ltr" },
  { code: "as", name: "অসমীয়া", dir: "ltr" },
  { code: "ta", name: "தமிழ்", dir: "ltr" },
  { code: "dz", name: "རྫོང་ཁ", dir: "ltr" },
  { code: "id", name: "Bahasa Indonesia", dir: "ltr" },
  { code: "ms", name: "Bahasa Melayu", dir: "ltr" },
  { code: "fil", name: "Filipino", dir: "ltr" },
  { code: "ch", name: "Finu' Chamoru", dir: "ltr" },
  { code: "bi", name: "Bislama", dir: "ltr" },
  { code: "vi", name: "Tiếng Việt", dir: "ltr" },
  { code: "th", name: "ไทย", dir: "ltr" },
  { code: "my", name: "မြန်မာ", dir: "ltr" },
  { code: "ay", name: "Aymar aru", dir: "ltr" },
  { code: "cr", name: "ᓀᐦᐃᔭᐍᐏᐣ", dir: "ltr" },
  { code: "sw", name: "Kiswahili", dir: "ltr" },
  { code: "am", name: "አማርኛ", dir: "ltr" },
  { code: "aa", name: "Qafar af", dir: "ltr" },
  { code: "ak", name: "Akan", dir: "ltr" },
  { code: "ee", name: "Eʋegbe", dir: "ltr" },
  { code: "bm", name: "Bamanankan", dir: "ltr" },
  { code: "ny", name: "Chichewa", dir: "ltr" },
  { code: "ja", name: "日本語", dir: "ltr" },
  { code: "ko", name: "한국어", dir: "ltr" },
  { code: "zh-Hans", name: "简体中文", dir: "ltr" },
  { code: "zh-Hant", name: "繁體中文", dir: "ltr" },
]);

const BY_CODE = new Map(LOCALES.map((locale) => [locale.code.toLowerCase(), locale]));
const TRADITIONAL_CHINESE = new Set(["zh-hant", "zh-tw", "zh-hk", "zh-mo"]);
// Browser tags that name a shipped language by another code (Norwegian, Tagalog).
const LEGACY_CODES = new Map([["iw", "he"], ["in", "id"], ["no", "nb"], ["nn", "nb"], ["tl", "fil"]]);

export function localeDir(code) {
  return BY_CODE.get(String(code).toLowerCase())?.dir ?? "ltr";
}

function matchTag(tag) {
  const lower = String(tag || "").trim().toLowerCase().replace(/_/g, "-");
  if (!lower) return null;
  if (BY_CODE.has(lower)) return BY_CODE.get(lower).code;
  const parts = lower.split("-");
  if (parts[0] === "zh") {
    const traditional = parts.some((part, index) => index > 0 && TRADITIONAL_CHINESE.has(`zh-${part}`));
    return traditional ? "zh-Hant" : "zh-Hans";
  }
  // Serbian: Cyrillic (sr) by default, the Latin bundle for any -Latn tag.
  if (parts[0] === "sr") return parts.includes("latn") ? "sr-Latn" : "sr";
  const base = LEGACY_CODES.get(parts[0]) ?? parts[0];
  return BY_CODE.get(base)?.code ?? null;
}

// Stored choice first, then the browser's preference list, then English.
export function detectLocale(stored, preferred = []) {
  const storedMatch = matchTag(stored);
  if (storedMatch) return storedMatch;
  for (const tag of Array.isArray(preferred) ? preferred : []) {
    const match = matchTag(tag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

export function interpolate(template, vars) {
  if (!vars || typeof vars !== "object") return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole);
}

// Instance branding (v5.19.0): locale strings name the forum through
// {siteName}, filled from the owner-saved name the worker stamps into the
// shell (<meta name="site-name">), else the default below. An owner-saved
// tagline/footer replaces the translated default copy verbatim.
export const DEFAULT_SITE_NAME = "Wempo's Forum";
const BRAND_METAS = Object.freeze({ siteName: "site-name", tagline: "site-tagline", footer: "site-footer" });

// readBrand(doc) -> { siteName, tagline, footer } from the stamped metas
// (attribute values only; every surface paints them with textContent).
export function readBrand(doc) {
  const read = (name) => {
    const value = doc?.querySelector?.(`meta[name="${name}"]`)?.getAttribute?.("content");
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    siteName: read(BRAND_METAS.siteName) || DEFAULT_SITE_NAME,
    tagline: read(BRAND_METAS.tagline),
    footer: read(BRAND_METAS.footer),
  };
}

// Owner-saved tagline/footer: { key: text } painted as-is (no placeholders).
function brandOverrides(siteName, brand) {
  const overrides = {};
  if (brand.tagline) {
    const heading = `${siteName}: ${brand.tagline}`;
    overrides["shell.tagline"] = heading;
    overrides["feed.introTitle"] = heading;
  }
  if (brand.footer) overrides["shell.footer"] = brand.footer;
  return overrides;
}

// Intl.PluralRules quietly resolves a locale it has no data for (Abkhaz and
// Afar today) to the runtime's default locale, so a browser set to Russian
// would pick Russian plural forms for them. Keep the rules only when they
// resolved to the requested language; otherwise use English's n = 1 rule,
// which is CLDR's rule for ab and the one/other split pinned for aa (CLDR has
// no aa entry). Dates and numbers for those codes still fall back to the
// runtime default, which only changes formatting, not the words.
function pluralRulesFor(locale) {
  const language = String(locale).split("-")[0].toLowerCase();
  try {
    const rules = new Intl.PluralRules(locale);
    if (rules.resolvedOptions().locale.split("-")[0].toLowerCase() === language) return rules;
  } catch {
    // An invalid tag falls through to English rules.
  }
  return new Intl.PluralRules(DEFAULT_LOCALE);
}

// key.one / key.other come in pairs in every locale. A locale may also carry
// key.few / key.many (Slavic counts); those are read from the active table
// only, never from the English fallback, and a missing one falls to key.other.
function pluralTemplate(category, key, messages, lookup) {
  if (EXTRA_PLURALS.has(category) && typeof messages[`${key}.${category}`] === "string") {
    return messages[`${key}.${category}`];
  }
  const form = category === PLURAL_ONE ? PLURAL_ONE : PLURAL_OTHER;
  return lookup(`${key}.${form}`) ?? lookup(`${key}.${PLURAL_OTHER}`) ?? key;
}

// Pure translator: messages for the active locale, English as the fallback.
// Intl.PluralRules picks the plural form (see pluralTemplate).
export function createTranslator(locale, messages = {}, fallback = {}, brand = {}) {
  const siteName = typeof brand.siteName === "string" && brand.siteName ? brand.siteName : DEFAULT_SITE_NAME;
  const overrides = brandOverrides(siteName, brand);
  const rules = pluralRulesFor(locale);
  const lookup = (key) => {
    if (typeof messages[key] === "string") return messages[key];
    if (typeof fallback[key] === "string") return fallback[key];
    return null;
  };
  const t = (key, vars) => (Object.hasOwn(overrides, key)
    ? overrides[key]
    : interpolate(lookup(key) ?? key, { siteName, ...vars }));
  const tn = (key, count, vars = {}) => {
    const category = rules.select(Number(count));
    const template = pluralTemplate(category, key, messages, lookup);
    return interpolate(template, { siteName, ...vars, count });
  };
  return { locale, t, tn };
}

let active = createTranslator(DEFAULT_LOCALE);
let readyPromise = null;

export const t = (key, vars) => active.t(key, vars);
export const tn = (key, count, vars) => active.tn(key, count, vars);
export const currentLocale = () => active.locale;

async function fetchMessages(code) {
  try {
    const response = await fetch(`/locales/${encodeURIComponent(code)}.json`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch (error) {
    console.error(`Could not load the ${code} translations:`, error);
    return {};
  }
}

function readStoredLocale() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function applyDocumentLocale(doc, code) {
  doc.documentElement.lang = code;
  doc.documentElement.dir = localeDir(code);
}

const STATIC_ATTRIBUTES = ["aria-label", "placeholder", "title", "alt"];

// index.html marks its copy with data-i18n (text) and data-i18n-<attribute>.
export function translateStatic(root) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const attribute of STATIC_ATTRIBUTES) {
    for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
    }
  }
}

async function init() {
  const code = detectLocale(readStoredLocale(), navigator.languages ?? [navigator.language]);
  const [fallback, messages] = await Promise.all([
    fetchMessages(DEFAULT_LOCALE),
    code === DEFAULT_LOCALE ? null : fetchMessages(code),
  ]);
  active = createTranslator(code, messages ?? fallback, fallback, readBrand(document));
  applyDocumentLocale(document, code);
  translateStatic(document);
  return code;
}

// Every self-mounting surface awaits this once; init runs a single time.
export function i18nReady() {
  readyPromise ??= init();
  return readyPromise;
}

export function setLocale(code) {
  const match = matchTag(code) ?? DEFAULT_LOCALE;
  try {
    localStorage.setItem(STORAGE_KEY, match);
  } catch {
    // Private windows can refuse storage; the choice then lasts this load only.
  }
  // A reload repaints every surface in the new language in one pass.
  location.reload();
}

// The header's language menu: native names, current language selected.
export function createLanguagePicker(doc) {
  const label = doc.createElement("label");
  label.className = "language-picker";
  const caption = doc.createElement("span");
  caption.className = "visually-hidden";
  caption.textContent = t("language.label");
  const select = doc.createElement("select");
  select.name = "language";
  select.title = t("language.label");
  for (const locale of LOCALES) {
    const option = doc.createElement("option");
    option.value = locale.code;
    option.textContent = locale.name;
    option.lang = locale.code;
    option.selected = locale.code === active.locale;
    select.append(option);
  }
  select.addEventListener("change", () => setLocale(select.value));
  label.append(caption, select);
  return label;
}
