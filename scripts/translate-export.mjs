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

// The translate module's export (docs/translating.md). The owner runs it on
// their own machine; it READS the approved suggestions from D1 and merges
// them into public/locales/<code>.json. It writes nothing to the database.
//
//   node scripts/translate-export.mjs --db <database-name> [--local] [--rows rows.json] [--no-test]
//
// Per locale it keeps the newest approved row per key, drops rows whose
// English changed since (source hash), rows for keys English no longer has
// and rows that break a validation law, keeps the table's key order, writes
// the file in the format every table uses (2-space JSON, UTF-8, trailing
// newline), then runs tests/i18n.test.mjs. Member names are never read.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { suggestionProblem, translatableLocale } from "../public/js/translate-validate.js";

export const EXPORT_SQL =
  "SELECT id, locale, msg_key, value, source_hash FROM translate_suggestions WHERE status = 'approved' ORDER BY id";

const LOCALE_DIR = new URL("../public/locales/", import.meta.url);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// The shipped format: Python's json.dumps(indent=2, ensure_ascii=False) plus
// a trailing newline, which JSON.stringify with 2 spaces reproduces.
export const serializeTable = (table) => JSON.stringify(table, null, 2) + "\n";

// mergeApproved({ en, tables: Map<code, table>, rows }) ->
//   { tables: Map<code, new table>, counts: { code: changed } }
// Inputs are never mutated.
export function mergeApproved({ en, tables, rows }) {
  const newest = new Map();
  for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) {
    if (!translatableLocale(row.locale) || !tables.has(row.locale)) continue;
    if (!Object.hasOwn(en, row.msg_key) || row.source_hash !== sha256(en[row.msg_key])) continue;
    if (suggestionProblem({ key: row.msg_key, value: row.value, source: en[row.msg_key] })) continue;
    newest.set(row.locale + "\u0000" + row.msg_key, row);
  }
  const merged = new Map();
  const counts = {};
  for (const [code, table] of tables) {
    const next = {};
    for (const key of Object.keys(table)) next[key] = table[key];
    for (const key of Object.keys(en)) if (!Object.hasOwn(next, key)) next[key] = table[key] ?? en[key];
    let changed = 0;
    for (const key of Object.keys(en)) {
      const row = newest.get(code + "\u0000" + key);
      if (row && next[key] !== row.value) {
        next[key] = row.value;
        changed += 1;
      }
    }
    if (changed) counts[code] = changed;
    merged.set(code, next);
  }
  return { tables: merged, counts };
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readRows(args) {
  const file = argValue(args, "--rows");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const db = argValue(args, "--db");
  if (!db || !/^[A-Za-z0-9_-]+$/.test(db)) throw new Error("Pass --db <database-name> (or --rows <file.json>).");
  const where = args.includes("--local") ? "--local" : "--remote";
  const out = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", db, where, "--json", "--command", EXPORT_SQL],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((part) => part.results || []);
}

function main(args) {
  const rows = readRows(args);
  const read = (code) => JSON.parse(readFileSync(new URL(code + ".json", LOCALE_DIR), "utf8"));
  const en = read("en");
  const codes = [...new Set(rows.map((row) => row.locale))].filter((code) => translatableLocale(code));
  const { tables, counts } = mergeApproved({ en, tables: new Map(codes.map((code) => [code, read(code)])), rows });
  for (const code of Object.keys(counts)) writeFileSync(new URL(code + ".json", LOCALE_DIR), serializeTable(tables.get(code)));
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log("translate-export: %d strings in %d locales", total, Object.keys(counts).length, counts);
  if (total && !args.includes("--no-test")) {
    execFileSync(process.execPath, ["--test", fileURLToPath(new URL("../tests/i18n.test.mjs", import.meta.url))],
      { stdio: "inherit" });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error("translate-export failed:", error.message);
    process.exitCode = 1;
  }
}
