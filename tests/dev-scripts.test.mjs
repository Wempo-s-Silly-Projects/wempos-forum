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

// Developer scripts: `pnpm i18n:add` / `pnpm i18n:remove` keep every locale
// file's layout and key order, and `pnpm setup:local` never overwrites or
// leaks an existing .dev.vars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { addKey, applyToLocales, removeKey } from "../scripts/i18n-key.mjs";
import { DEV_SECRETS, devVarsText, ensureDevVars, hasLocalD1State, writeDevVars } from "../scripts/setup-local.mjs";
import { migrationTargets } from "../scripts/migrate-local.mjs";
import { toLatin } from "./helpers/serbian-script.mjs";

const ROOT = new URL("../", import.meta.url);
const SAMPLE = '{\n  "b.key": "B",\n  "a.key": "A"\n}\n';

test("i18n:add appends a key, or places it after a named key, without reordering", () => {
  assert.equal(addKey(SAMPLE, "c.key", "C"), '{\n  "b.key": "B",\n  "a.key": "A",\n  "c.key": "C"\n}\n');
  assert.equal(addKey(SAMPLE, "c.key", "C", { after: "b.key" }), '{\n  "b.key": "B",\n  "c.key": "C",\n  "a.key": "A"\n}\n');
  assert.throws(() => addKey(SAMPLE, "a.key", "again"), /already has a\.key/);
  assert.throws(() => addKey(SAMPLE, "c.key", "C", { after: "zz" }), /has no key zz/);
});

test("i18n:add keeps a __proto__ key and rejects empty or non-string text", () => {
  assert.equal(addKey(SAMPLE, "__proto__", "P", { after: "b.key" }), '{\n  "b.key": "B",\n  "__proto__": "P",\n  "a.key": "A"\n}\n');
  assert.throws(() => addKey(SAMPLE, "c.key", ""), /non-empty string/);
  assert.throws(() => addKey(SAMPLE, "c.key", 42), /non-empty string/);
});

test("i18n scripts refuse a locale file that is not a flat object of strings", () => {
  assert.throws(() => addKey('[\n  "A"\n]\n', "b", "B"), /flat object/);
  assert.throws(() => addKey('{\n  "a": 1\n}\n', "b", "B"), /flat object/);
});

test("i18n:remove drops one key and keeps the rest byte-for-byte", () => {
  assert.equal(removeKey(SAMPLE, "a.key"), '{\n  "b.key": "B"\n}\n');
  assert.throws(() => removeKey(SAMPLE, "zz"), /has no key zz/);
});

test("i18n scripts keep a file's own indentation and refuse a non-standard layout", () => {
  const tabs = '{\n\t"a": "A"\n}';
  assert.equal(addKey(tabs, "b", "B"), '{\n\t"a": "A",\n\t"b": "B"\n}');
  assert.throws(() => addKey('{ "a": "A" }\n', "b", "B"), /refusing to reformat/);
});

test("every shipped locale file round-trips through the i18n scripts unchanged", () => {
  const dir = new URL("public/locales/", ROOT);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.ok(files.length >= 74, "locale files: " + files.length);
  for (const name of files) {
    const text = readFileSync(new URL(name, dir), "utf8");
    assert.equal(removeKey(addKey(text, "zz.devScriptProbe", "x"), "zz.devScriptProbe"), text, name);
  }
});

test("applyToLocales writes nothing when any file fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "i18n-key-"));
  try {
    writeFileSync(join(dir, "en.json"), SAMPLE);
    writeFileSync(join(dir, "xx.json"), '{\n  "c.key": "C"\n}\n');
    assert.throws(() => applyToLocales((text) => removeKey(text, "a.key"), dir), /has no key a\.key/);
    assert.equal(readFileSync(join(dir, "en.json"), "utf8"), SAMPLE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setup:local writes fresh random secrets and HUMAN_CHECK=off", () => {
  const text = devVarsText();
  for (const name of DEV_SECRETS) assert.match(text, new RegExp("^" + name + "=[0-9a-f]{64}$", "m"));
  assert.match(text, /^HUMAN_CHECK=off$/m);
  assert.notEqual(devVarsText(), text, "each run draws new values");
});

test("setup:local never overwrites an existing .dev.vars", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-local-"));
  try {
    const path = join(dir, ".dev.vars");
    assert.equal(writeDevVars(path, "FIRST=1\n"), true);
    assert.equal(writeDevVars(path, "SECOND=2\n"), false);
    assert.equal(readFileSync(path, "utf8"), "FIRST=1\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("package scripts expose the local-dev flow", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
  assert.equal(scripts.dev, "wrangler dev --local --infer-origin-from-routes=false");
  assert.equal(scripts["setup:local"], "node scripts/setup-local.mjs");
  assert.equal(scripts["db:migrate:local"], "node scripts/migrate-local.mjs");
  assert.equal(scripts.check, "pnpm run lint && pnpm test");
  assert.equal(scripts["test:watch"], "node --test --watch");
  assert.equal(scripts["i18n:add"], "node scripts/i18n-key.mjs add");
  assert.equal(scripts["i18n:remove"], "node scripts/i18n-key.mjs remove");
});

test("db:migrate:local uses configured database names and skips an unbound search database", () => {
  const bound = '[[d1_databases]]\nbinding = "FORUM_DB"\ndatabase_name = "forum-local"\n[[d1_databases]]\nbinding = "SEARCH_DB"\ndatabase_name = "search-local"\n';
  const commented = '# [[d1_databases]]\n# binding = "SEARCH_DB"\n';
  const envOnly = 'name = "x"\n[env.preview]\n[[env.preview.d1_databases]]\nbinding = "SEARCH_DB"\ndatabase_name = "preview-search"\n';
  assert.deepEqual(migrationTargets({}, bound), ["forum-local", "search-local"]);
  assert.throws(() => migrationTargets({ D1_SEARCH_DATABASE: "other-search" }, bound), /must match/);
  assert.deepEqual(migrationTargets({}, commented), ["wempo-forum-data"]);
  assert.deepEqual(migrationTargets({}, envOnly), ["wempo-forum-data"]);
  assert.deepEqual(migrationTargets({}, readFileSync(new URL("wrangler.toml", ROOT), "utf8")),
    ["wempo-forum-data", "wempo-forum-search"]);
});


test("setup:local refuses to mint a new password pepper over existing local D1 state", () => {
  const root = mkdtempSync(join(tmpdir(), "setup-local-state-"));
  try {
    const d1 = join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
    mkdirSync(d1, { recursive: true });
    writeFileSync(join(d1, "local.sqlite"), "");
    assert.equal(hasLocalD1State(root), true);
    assert.throws(() => ensureDevVars(root, "PASSWORD_PEPPER=new\n"), /restore the original \.dev\.vars/);
    assert.equal(existsSync(join(root, ".dev.vars")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("i18n locale transaction recovers the whole previous set after an interrupted write", () => {
  const dir = mkdtempSync(join(tmpdir(), "i18n-recovery-"));
  try {
    const path = join(dir, "en.json");
    writeFileSync(path, SAMPLE.replace('"B"', '"changed"'));
    writeFileSync(dir + ".i18n-key-transaction.json", JSON.stringify({
      files: [{ name: "en.json", original: SAMPLE }],
    }));
    assert.equal(applyToLocales((text) => text, dir), 1);
    assert.equal(readFileSync(path, "utf8"), SAMPLE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dir + ".i18n-key-transaction.json", { force: true });
  }
});

test("actual i18n CLI adds/removes across locales, derives Serbian Latin, and rejects bad translations", () => {
  const dir = mkdtempSync(join(tmpdir(), "i18n-cli-"));
  const translationDir = mkdtempSync(join(tmpdir(), "i18n-translations-"));
  try {
    const source = new URL("../public/locales/", import.meta.url);
    for (const name of readdirSync(source).filter((name) => name.endsWith(".json"))) {
      copyFileSync(new URL(name, source), join(dir, name));
    }
    const translations = join(translationDir, "translations.json");
    writeFileSync(translations, JSON.stringify({ fr: "Bonjour {name}", sr: "Zdravo {name}" }));
    const script = fileURLToPath(new URL("../scripts/i18n-key.mjs", import.meta.url));
    const env = { ...process.env, WEMPO_LOCALES_DIR: dir };
    const add = spawnSync(process.execPath, [script, "add", "dev.cliProbe", "Hello {name}", "--translations", translations],
      { cwd: fileURLToPath(ROOT), env, encoding: "utf8" });
    assert.equal(add.status, 0, add.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, "en.json"), "utf8"))["dev.cliProbe"], "Hello {name}");
    assert.equal(JSON.parse(readFileSync(join(dir, "fr.json"), "utf8"))["dev.cliProbe"], "Bonjour {name}");
    assert.equal(JSON.parse(readFileSync(join(dir, "sr-Latn.json"), "utf8"))["dev.cliProbe"],
      toLatin("Zdravo {name}"));
    const before = readFileSync(join(dir, "en.json"), "utf8");
    writeFileSync(translations, JSON.stringify({ fr: "Bonjour {other}" }));
    const invalid = spawnSync(process.execPath, [script, "add", "dev.invalidProbe", "Hello {name}", "--translations", translations],
      { cwd: fileURLToPath(ROOT), env, encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert.equal(readFileSync(join(dir, "en.json"), "utf8"), before);
    const missingFlag = spawnSync(process.execPath, [script, "add", "dev.badFlag", "Text", "--translations"],
      { cwd: fileURLToPath(ROOT), env, encoding: "utf8" });
    assert.equal(missingFlag.status, 2);
    const remove = spawnSync(process.execPath, [script, "remove", "dev.cliProbe"],
      { cwd: fileURLToPath(ROOT), env, encoding: "utf8" });
    assert.equal(remove.status, 0, remove.stderr);
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(join(dir, "en.json"), "utf8")), "dev.cliProbe"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(translationDir, { recursive: true, force: true });
    rmSync(dir + ".i18n-key-transaction.json", { force: true });
  }
});
