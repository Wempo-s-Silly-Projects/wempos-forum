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

// `pnpm i18n:add` / `pnpm i18n:remove`: add or remove one translation key in
// every public/locales/*.json file at once. Each file keeps its indentation,
// its trailing newline and its existing key order; a file that would not
// round-trip byte-for-byte is refused instead of reformatted.
//
//   pnpm i18n:add <key> "<English text>" [--after <existing.key>] [--translations <file.json>]
//   pnpm i18n:remove <key>
//
// --translations points at a JSON object of { "<locale>": "<text>" }; locales
// it does not list get the English text, ready for a translator. sr-Latn is
// always derived from the sr text, so the two Serbian scripts stay 1:1.
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toLatin } from "../tests/helpers/serbian-script.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCALES_DIR = process.env.WEMPO_LOCALES_DIR ? resolve(process.env.WEMPO_LOCALES_DIR) : join(ROOT, "public", "locales");

function parseLocale(text, label) {
  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  const newline = text.endsWith("\n") ? "\n" : "";
  const data = JSON.parse(text);
  if (data === null || typeof data !== "object" || Array.isArray(data)
    || Object.values(data).some((value) => typeof value !== "string")) {
    throw new Error(label + " is not a flat object of string translations");
  }
  if (JSON.stringify(data, null, indent) + newline !== text) {
    throw new Error(label + " is not in the standard one-key-per-line layout; refusing to reformat it");
  }
  return { data, format: (next) => JSON.stringify(next, null, indent) + newline };
}

export function addKey(text, key, value, { after, label = "locale" } = {}) {
  const { data, format } = parseLocale(text, label);
  if (typeof key !== "string" || key === "") throw new Error("the key must be a non-empty string");
  if (typeof value !== "string" || value === "") throw new Error(label + ": the text for " + key + " must be a non-empty string");
  if (Object.hasOwn(data, key)) throw new Error(label + " already has " + key);
  if (after !== undefined && !Object.hasOwn(data, after)) throw new Error(label + " has no key " + after);
  // Null prototype, so a key such as "__proto__" becomes a real property.
  const next = Object.create(null);
  for (const [k, v] of Object.entries(data)) {
    next[k] = v;
    if (k === after) next[key] = value;
  }
  if (after === undefined) next[key] = value;
  return format(next);
}

export function removeKey(text, key, { label = "locale" } = {}) {
  const { data, format } = parseLocale(text, label);
  if (!Object.hasOwn(data, key)) throw new Error(label + " has no key " + key);
  delete data[key];
  return format(data);
}

function localeFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => join(dir, name));
}

// A journal makes the multi-file update recoverable if the process stops
// between renames. The next invocation restores the complete old set before
// starting another operation, so a half-applied translation never persists.
function transactionPath(dir) {
  return dir + ".i18n-key-transaction.json";
}

export function recoverLocaleTransaction(dir = LOCALES_DIR) {
  const journal = transactionPath(dir);
  if (!existsSync(journal)) return false;
  const transaction = JSON.parse(readFileSync(journal, "utf8"));
  if (!Array.isArray(transaction.files)) throw new Error("invalid i18n transaction journal");
  for (const file of transaction.files) {
    if (typeof file.name !== "string" || basename(file.name) !== file.name
      || !file.name.endsWith(".json") || typeof file.original !== "string") {
      throw new Error("invalid i18n transaction journal entry");
    }
    const path = join(dir, file.name);
    const restore = path + ".restore.tmp";
    writeFileSync(restore, file.original);
    renameSync(restore, path);
    rmSync(path + ".tmp", { force: true });
  }
  rmSync(journal);
  return true;
}

export function applyToLocales(transform, dir = LOCALES_DIR) {
  recoverLocaleTransaction(dir);
  const out = localeFiles(dir).map((path) => {
    const locale = basename(path, ".json");
    const original = readFileSync(path, "utf8");
    return [path, original, transform(original, locale)];
  });
  const journal = transactionPath(dir);
  const journalTemp = journal + "." + process.pid + ".tmp";
  rmSync(journalTemp, { force: true });
  writeFileSync(journalTemp, JSON.stringify({
    files: out.map(([path, original]) => ({ name: basename(path), original })),
  }), { flag: "wx" });
  renameSync(journalTemp, journal);
  try {
    for (const [path, , text] of out) writeFileSync(path + ".tmp", text);
    for (const [path] of out) renameSync(path + ".tmp", path);
    rmSync(journal);
    return out.length;
  } catch (error) {
    recoverLocaleTransaction(dir);
    throw error;
  }
}

function placeholderNames(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

export function validateAddInput(key, english, translations, dir = LOCALES_DIR) {
  if (!/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(key)) {
    throw new Error("the key must use the locale key format (for example, app.newLabel)");
  }
  if (typeof english !== "string" || !english.trim()) throw new Error("English text must be a non-empty string");
  if (translations === null || typeof translations !== "object" || Array.isArray(translations)) {
    throw new Error("--translations must contain a JSON object of locale strings");
  }
  const locales = new Set(localeFiles(dir).map((path) => basename(path, ".json")));
  const expected = JSON.stringify(placeholderNames(english));
  for (const [locale, value] of Object.entries(translations)) {
    if (!locales.has(locale)) throw new Error("unknown locale in --translations: " + locale);
    if (locale === "en") throw new Error("English is supplied as the positional text argument");
    if (locale === "sr-Latn") throw new Error("sr-Latn is generated from sr and must not be supplied");
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(locale + " translation must be a non-empty string");
    }
    if (JSON.stringify(placeholderNames(value)) !== expected) {
      throw new Error(locale + " translation placeholders do not match English");
    }
  }
}

function usage() {
  process.stderr.write(
    "usage: pnpm i18n:add <key> \"<English text>\" [--after <key>] [--translations <file.json>]\n"
    + "       pnpm i18n:remove <key>\n");
  process.exit(2);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [command, ...rest] = process.argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--after" || rest[i] === "--translations") {
      if (rest[i + 1] === undefined || rest[i + 1].startsWith("--")) usage();
      flags[rest[i].slice(2)] = rest[++i];
    } else positional.push(rest[i]);
  }
  try {
    let count;
    if (command === "add" && positional.length === 2) {
      const [key, english] = positional;
      const translations = flags.translations ? JSON.parse(readFileSync(resolve(flags.translations), "utf8")) : {};
      validateAddInput(key, english, translations);
      const textFor = (locale) => {
        if (locale === "en") return english;
        if (locale === "sr-Latn") return toLatin(textFor("sr"));
        return Object.hasOwn(translations, locale) ? translations[locale] : english;
      };
      count = applyToLocales((text, locale) => addKey(text, key, textFor(locale),
        { after: flags.after, label: locale + ".json" }));
      process.stdout.write("Added " + key + " to " + count + " locale files.\n");
    } else if (command === "remove" && positional.length === 1) {
      count = applyToLocales((text, locale) => removeKey(text, positional[0], { label: locale + ".json" }));
      process.stdout.write("Removed " + positional[0] + " from " + count + " locale files.\n");
    } else {
      usage();
    }
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exit(1);
  }
}
