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

// Batch F (account security), items 1 + 2: the zxcvbn-ts strength meter and
// the EFF-wordlist passphrase suggester, both 100% client-side. Pins the
// vendored bytes and their REUSE licensing, the lazy loader, that the
// password never leaves the page, and unbiased crypto word picking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { BATCHF_VENDOR_PINS } from "./helpers/batchf-vendor-pins.mjs";
import { ZXCVBN_SCRIPTS, scorePassword } from "../public/js/password-strength.js";
import { pickPassphrase, PASSPHRASE_WORDS } from "../public/js/passphrase.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

test("every Batch F vendored file is byte-for-byte upstream", () => {
  const paths = Object.keys(BATCHF_VENDOR_PINS);
  assert.ok(paths.length >= 25);
  for (const path of paths) {
    const digest = createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex");
    assert.equal(digest, BATCHF_VENDOR_PINS[path], path);
  }
});

test("REUSE.toml annotates each vendored library with its upstream licence", () => {
  const reuse = read("REUSE.toml");
  for (const [path, licence] of [
    ["public/js/vendor/qrcode-generator/**", "MIT"],
    ["public/js/vendor/simplewebauthn-browser/**", "MIT"],
    ["public/js/vendor/altcha-lib/**", "MIT"],
    ["public/js/vendor/zxcvbn-ts/**", "MIT"],
    ["public/js/vendor/eff-wordlist/**", "CC-BY-4.0"],
  ]) {
    const block = reuse.split("[[annotations]]").find((part) => part.includes('"' + path + '"'));
    assert.ok(block, "annotation for " + path);
    const expression = (block.match(/SPDX-License-Identifier = "([^"]*)"/) ?? [])[1] ?? "";
    assert.ok(expression.split(/[\s()]+/).includes(licence), path + " licence " + licence + " in " + expression);
  }
  for (const text of ["LICENSES/CC-BY-4.0.txt", "LICENSES/ODC-By-1.0.txt", "LICENSES/MIT.txt"]) {
    assert.ok(read(text).length > 500, text);
  }
});

function loadBundles() {
  const context = vm.createContext({});
  for (const src of ZXCVBN_SCRIPTS) vm.runInContext(read("public" + src), context);
  return context.zxcvbnts;
}

test("the three zxcvbn-ts classic bundles load in order and expose the factory", () => {
  assert.deepEqual(ZXCVBN_SCRIPTS, [
    "/js/vendor/zxcvbn-ts/core.js", "/js/vendor/zxcvbn-ts/language-common.js", "/js/vendor/zxcvbn-ts/language-en.js",
  ]);
  const globals = loadBundles();
  assert.equal(typeof globals.core.ZxcvbnFactory, "function");
  assert.ok(globals["language-common"].dictionary);
  assert.ok(globals["language-en"].dictionary);
});

test("scorePassword: common passwords score low, a long diceware passphrase scores 4", () => {
  const globals = loadBundles();
  assert.ok(scorePassword(globals, "password") <= 1);
  assert.ok(scorePassword(globals, "qwerty123") <= 1);
  assert.equal(scorePassword(globals, "tremor-cosmic-ladle-orbit-sculpt-velvet"), 4);
  assert.equal(scorePassword(globals, ""), 0);
});

test("the meter never sends the password anywhere and loads lazily", () => {
  const source = read("public/js/password-strength.js");
  assert.doesNotMatch(source, /\bapi\(|fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
  assert.match(source, /createElement\("script"\)/, "bundles are injected on demand, not on page load");
  assert.doesNotMatch(read("public/index.html"), /zxcvbn/);
});

test("pickPassphrase: crypto-random EFF words, rejection-sampled (no modulo bias)", () => {
  assert.equal(PASSPHRASE_WORDS, 6);
  const words = Array.from({ length: 7776 }, (_, i) => "w" + i);
  // A fake RNG that first yields a value in the biased tail (rejected), then 5.
  const limit = Math.floor(0x100000000 / 7776) * 7776;
  const queue = [limit + 3, 5, 7775, 0, 1, 2, 3];
  const fakeRandom = (array) => { array[0] = queue.shift(); return array; };
  assert.deepEqual(pickPassphrase(words, 6, fakeRandom), ["w5", "w7775", "w0", "w1", "w2", "w3"]);
  const real = pickPassphrase(words, 6, (array) => globalThis.crypto.getRandomValues(array));
  assert.equal(real.length, 6);
});

test("the vendored EFF large wordlist has 7776 unique lowercase words", () => {
  const words = JSON.parse(read("public/js/vendor/eff-wordlist/wordlist.json"));
  assert.equal(words.length, 7776);
  assert.equal(new Set(words).size, 7776);
  for (const word of words) assert.match(word, /^[a-z-]+$/);
  const source = read("public/js/passphrase.js");
  assert.match(source, /crypto\.getRandomValues/);
  assert.doesNotMatch(source, /Math\.random/);
});

test("the first-owner setup form wires the meter and the passphrase button", () => {
  const auth = read("public/js/routes/auth.js");
  assert.match(auth, /attachStrengthMeter\(/);
  assert.match(auth, /attachPassphraseButton\(/);
});
