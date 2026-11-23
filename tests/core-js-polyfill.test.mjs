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

// Slate 2026-11-22-e (E1 + E2): the cdnjs polyfill service is gone. A
// self-hosted core-js 3.51.0 build of only the modules our code needs at the
// browser floor ships as public/js/vendor/core-js.js, and a tiny first-party
// classic script, /js/polyfill-loader.js, fetches it only for browsers that
// lack one of those built-ins. The document CSP's script-src is 'self' alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { forumDocumentSecurityHeaders, secureResponse } from "../api/core/http.mjs";
import { BROWSER_FLOOR } from "../constants.mjs";
import { CORE_JS_MODULES, CORE_JS_VERSION } from "../scripts/build-core-js.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const readBytes = (path) => readFileSync(new URL("../" + path, import.meta.url));
const scriptSrc = (csp) => ((csp.match(/script-src ([^;]+);/) ?? [])[1] ?? "").split(/\s+/);

const BUNDLE_PATH = "public/js/vendor/core-js.js";
const BUNDLE_SHA256 = "960fb1338bae5d1a503c61146b0fd9ec0ce41e157e26bb6f6feb5926e1e2fff9";
const BUNDLE_BYTES = 50013;
const LOADER_PATH = "public/js/polyfill-loader.js";
const LOADER_TAG = '<script src="/js/polyfill-loader.js"></script>';
const VENDOR_SCRIPT = Object.freeze({ tag: "script", src: "/js/vendor/core-js.js", async: false });

// Every built-in public/js/** calls that core-js could fill (inventory
// Nov 22). Anything below the floor drops out of compat()'s answer; anything
// it returns must already be in the vendored build.
const CLIENT_BUILT_IN_INVENTORY = Object.freeze([
  "es.array.at",
  "es.array.flat-map",
  "es.global-this",
  "es.object.from-entries",
  "es.object.has-own",
  "es.string.match-all",
  "web.queue-microtask",
]);

const bundleModules = () => {
  const summary = read(BUNDLE_PATH).match(/\/\*\n \* modules:\n((?: \* [\w.-]+\n)+) \*\//);
  assert.ok(summary, "core-js module summary comment present");
  return summary[1].trim().split("\n").map((line) => line.replace(/^\s*\* /, ""));
};

const neededModules = (inventory) => {
  const compat = createRequire(import.meta.url)("core-js-compat");
  return compat({ targets: { ...BROWSER_FLOOR }, modules: [...inventory], version: CORE_JS_VERSION }).list;
};

test("index.html loads no third-party script and never mentions cdnjs", () => {
  const html = read("public/index.html");
  assert.doesNotMatch(html, /cdnjs/i);
  assert.doesNotMatch(html, /polyfill\.min\.js/);
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  const offSite = tags.filter((tag) => /\bsrc="(?:https?:)?\/\//i.test(tag));
  assert.deepEqual(offSite, [], "every script src is same-origin");
});

test("document CSP: script-src is exactly 'self' and names no CDN", () => {
  const csp = forumDocumentSecurityHeaders(new Headers()).get("Content-Security-Policy");
  assert.deepEqual(scriptSrc(csp), ["'self'"]);
  assert.match(csp, /(?:^|; )script-src 'self';/);
  assert.doesNotMatch(csp, /cdnjs|polyfill/);
  const shell = secureResponse(new Response("x")).headers.get("Content-Security-Policy");
  assert.deepEqual(scriptSrc(shell), ["'self'"]);
  assert.doesNotMatch(shell, /cdnjs|polyfill/);
});

test("the vendored core-js build is byte-pinned and names its version and modules", () => {
  const bytes = readBytes(BUNDLE_PATH);
  assert.equal(bytes.length, BUNDLE_BYTES);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), BUNDLE_SHA256);
  const text = bytes.toString("utf8");
  assert.match(text, /^\/\*\*\n \* core-js 3\.51\.0\n/);
  assert.match(text, /CoreJS Company/);
  assert.equal(CORE_JS_VERSION, "3.51.0");
  assert.deepEqual(bundleModules(), [...CORE_JS_MODULES]);
});

test("E2 coverage: every module the floor needs for our built-ins is in the build", () => {
  const needed = neededModules(CLIENT_BUILT_IN_INVENTORY);
  const built = new Set(bundleModules());
  assert.deepEqual(needed.filter((name) => !built.has(name)), []);
  // Nothing in the build that the inventory no longer asks for.
  assert.deepEqual([...built].filter((name) => !needed.includes(name)), []);
});

test("E2 coverage bites: a new post-floor built-in without a rebuild is caught", () => {
  const needed = neededModules([...CLIENT_BUILT_IN_INVENTORY, "es.array.find-last"]);
  const built = new Set(bundleModules());
  // core-js-compat treats a module name as a prefix, so find-last-index rides along.
  assert.deepEqual(needed.filter((name) => !built.has(name)), ["es.array.find-last", "es.array.find-last-index"]);
});

test("index.html runs the loader as a same-origin classic script before every module", () => {
  const html = read("public/index.html");
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  const loaders = tags.filter((tag) => tag.includes("/js/polyfill-loader.js"));
  assert.equal(loaders.length, 1, "exactly one loader tag");
  assert.equal(html.split(LOADER_TAG).length, 2, "loader tag is a bare classic <script src>");
  const loaderAt = tags.indexOf(loaders[0]);
  const firstModule = tags.findIndex((tag) => /type="module"/.test(tag));
  const legacy = tags.findIndex((tag) => tag.includes("/js/legacy-notice.js"));
  assert.ok(firstModule > loaderAt, "loader precedes the first module script");
  assert.ok(legacy > loaderAt, "loader precedes the no-module notice");
  assert.ok(!tags.some((tag) => tag.includes("/js/vendor/core-js.js")), "the bundle is never loaded unconditionally");
});

test("the loader is plain ES5 (it must parse on browsers older than the floor)", () => {
  const source = read(LOADER_PATH).replace(/^\/\/.*$/gm, "");
  assert.doesNotMatch(source, /=>|\blet\b|\bconst\b|\bimport\b|\bexport\b|\bclass\b|`|\?\.|\?\?/);
  assert.doesNotMatch(source, /\beval\b|new Function|innerHTML|document\.write/);
});

const runLoader = (prepare) => {
  const added = [];
  const document = {
    createElement: (tag) => ({ tag }),
    head: { appendChild: (node) => added.push(node) },
  };
  const context = vm.createContext({ document });
  vm.runInContext(prepare, context);
  vm.runInContext(read(LOADER_PATH), context);
  return added.map((node) => ({ ...node }));
};

test("the loader writes nothing when every listed built-in exists", () => {
  assert.deepEqual(runLoader(""), []);
});

test("the loader injects the vendored build when Array#at is missing", () => {
  assert.deepEqual(runLoader("delete Array.prototype.at;"), [VENDOR_SCRIPT]);
});

test("the loader injects the vendored build when Object.hasOwn is missing", () => {
  assert.deepEqual(runLoader("delete Object.hasOwn;"), [VENDOR_SCRIPT]);
});

test("the loader checks every module in the build (one check per module)", () => {
  const source = read(LOADER_PATH);
  const CHECKS = { "es.array.at": "Array.prototype.at", "es.object.has-own": "Object.hasOwn" };
  for (const name of CORE_JS_MODULES) {
    assert.ok(CHECKS[name], "loader check mapping for " + name);
    assert.ok(source.includes(CHECKS[name]), "loader feature-checks " + CHECKS[name]);
  }
});

test("REUSE: the build has its own MIT block naming CoreJS Company, one license line", () => {
  const toml = read("REUSE.toml");
  const blocks = toml.split("[[annotations]]").slice(1);
  const block = blocks.find((text) => /path = "public\/js\/vendor\/core-js\.js"/.test(text));
  assert.ok(block, "REUSE block for public/js/vendor/core-js.js");
  assert.equal((block.match(/SPDX-License-Identifier/g) ?? []).length, 1);
  assert.match(block, /SPDX-License-Identifier = "MIT"/);
  assert.match(block, /SPDX-FileCopyrightText = "[^"]*CoreJS Company[^"]*"/);
  assert.ok(blocks.indexOf(block) > blocks.findIndex((text) => /path = "public\/js\/vendor\/\*\*"/.test(text)),
    "listed after the vendor glob so it wins");
});

test("deps: core-js-builder (webpack 4) stays out; core-js-compat is pinned exactly", () => {
  const pkg = JSON.parse(read("package.json"));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.equal(all["core-js-builder"], undefined);
  assert.equal(all["core-js"], undefined);
  assert.equal(pkg.devDependencies["core-js-compat"], "3.51.0");
  assert.doesNotMatch(read("pnpm-lock.yaml"), /^ {2}webpack@/m);
});
