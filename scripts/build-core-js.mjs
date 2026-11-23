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

// Rebuilds public/js/vendor/core-js.js, the self-hosted polyfill that
// replaced the cdnjs polyfill service (slate 2026-11-22-e, E1).
//
// core-js version: 3.51.0 (core-js, core-js-builder and core-js-compat all
//   pinned to exactly this release).
// Targets: BROWSER_FLOOR in constants.mjs (Chrome/Edge 85, Firefox 79,
//   Safari/iOS 14, Samsung 14, Opera 71).
// Modules: CORE_JS_MODULES below (2 modules), the built-ins public/js/**
//   calls that the floor lacks. Inventory Nov 22: Array#at in 4 files,
//   Object.hasOwn in 5; URL.parse, URL.canParse, URLSearchParams#size,
//   two-argument has/delete and String#at are not called.
//   tests/core-js-polyfill.test.mjs re-checks the list with core-js-compat.
//
// core-js-builder pulls webpack 4, so it is NOT a forum dependency: install
// it in a folder outside this repo and point the script at it:
//
//   mkdir -p ~/core-js-build && cd ~/core-js-build
//   pnpm add core-js-builder@3.51.0
//   cd <forum checkout>
//   CORE_JS_BUILDER_DIR=~/core-js-build node scripts/build-core-js.mjs
//
// Builder call: builder({ modules: CORE_JS_MODULES, targets: BROWSER_FLOOR,
//   format: "bundle", minify: false,
//   summary: { comment: { size: false, modules: true } } }).
// The output is unminified (readable source) and keeps core-js's own banner
// and module summary; the file is vendored verbatim and its sha256 is pinned
// by the test above.

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BROWSER_FLOOR } from "../constants.mjs";

export const CORE_JS_VERSION = "3.51.0";
export const CORE_JS_MODULES = Object.freeze(["es.array.at", "es.object.has-own"]);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CORE_JS_OUTPUT = join(ROOT, "public", "js", "vendor", "core-js.js");

function loadBuilder() {
  const base = process.env.CORE_JS_BUILDER_DIR;
  if (!base) {
    throw new Error("Set CORE_JS_BUILDER_DIR to a folder outside the repo with core-js-builder@" + CORE_JS_VERSION);
  }
  const require = createRequire(join(base, "package.json"));
  const version = require("core-js-builder/package.json").version;
  if (version !== CORE_JS_VERSION) {
    throw new Error("core-js-builder " + version + " found; expected " + CORE_JS_VERSION);
  }
  return require("core-js-builder");
}

async function main() {
  const builder = loadBuilder();
  const bundle = await builder({
    modules: [...CORE_JS_MODULES],
    targets: { ...BROWSER_FLOOR },
    format: "bundle",
    minify: false,
    summary: { comment: { size: false, modules: true } },
  });
  await writeFile(CORE_JS_OUTPUT, bundle);
  process.stdout.write("wrote " + CORE_JS_OUTPUT + " (" + Buffer.byteLength(bundle) + " bytes)\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
  });
}
