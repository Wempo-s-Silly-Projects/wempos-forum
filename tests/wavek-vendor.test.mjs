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

// Batch K vendoring: idb-keyval 6.3.0 (Apache-2.0), client-zip 2.5.1 (MIT)
// and nanoevents 10.0.0 (MIT) ship byte for byte from their npm tarballs
// under public/js/vendor/, each pinned by sha256, licensed in REUSE.toml,
// self-contained (no bare or remote imports) and served same-origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const VENDORED = [
  { file: "public/js/vendor/idb-keyval.js", sha256: "480f1d31a40b5720fbaaee44c1a21d83392c6cf9516672007813a1824483a058",
    license: "Apache-2.0", holder: "Jake Archibald" },
  { file: "public/js/vendor/client-zip.js", sha256: "28c957c53d8e5290951d4b45ccff8ab8c9c37219da08b9d537bbdd595a75706d",
    license: "MIT", holder: "David Junger" },
  { file: "public/js/vendor/nanoevents.js", sha256: "6699494a9ef0674ca92b1b3252bfcedb09522e145d988ef66f262a9ac2994c52",
    license: "MIT", holder: "Andrey Sitnik" },
];

for (const { file, sha256, license, holder } of VENDORED) {
  test(`${file} is the approved upstream build, byte for byte`, () => {
    assert.equal(createHash("sha256").update(readFileSync(new URL(file, ROOT))).digest("hex"), sha256);
  });

  test(`${file} is annotated ${license} in REUSE.toml`, () => {
    const block = read("REUSE.toml").split("[[annotations]]").find((part) => part.includes(`"${file}"`));
    assert.ok(block, `an annotations block names ${file}`);
    assert.match(block, new RegExp(`SPDX-License-Identifier = "${license.replace(".", "\\.")}"`));
    assert.match(block, new RegExp(`SPDX-FileCopyrightText = "[^"]*${holder}`));
    assert.match(block, /precedence = "override"/);
  });

  test(`${file} imports nothing (no bare specifiers, no CDN)`, () => {
    const source = read(file);
    assert.doesNotMatch(source, /\bimport\s*[\s{*]|\bimport\(|from\s*["']/);
    assert.doesNotMatch(source, /https?:\/\/[^\s"'`]*\.(?:js|mjs)\b/);
  });
}

test("the vendored files' REUSE blocks come after the Prism wildcard block (last match wins)", () => {
  const reuse = read("REUSE.toml");
  const prism = reuse.indexOf('"public/js/vendor/**"');
  for (const { file } of VENDORED) assert.ok(reuse.indexOf(`"${file}"`) > prism, file);
});

test("LICENSES/Apache-2.0.txt ships for idb-keyval", () => {
  const text = read("LICENSES/Apache-2.0.txt");
  assert.match(text, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(text, /END OF TERMS AND CONDITIONS/);
});
