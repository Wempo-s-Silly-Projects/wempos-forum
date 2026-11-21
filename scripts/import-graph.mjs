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

// Static import graph of the browser client (wave 2026-11-21-10 F2). Walks
// every `import … from "…"`, bare `import "…"` and `export … from "…"` out of
// the <script type="module"> entries in public/index.html, and reports how
// many modules load and how deep the sequential discovery waterfall runs.
// Dynamic `import("…")` edges are listed separately: they are lazy, so they
// never count toward the boot graph.
//
//   node scripts/import-graph.mjs          # summary
//   node scripts/import-graph.mjs --json   # full graph

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = join(ROOT, "public");

const STATIC_IMPORT = /(?:^|[;\s])(?:import|export)\s+(?:[\w$*{}\s,]+?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:"'\\])\/\/.*$/gm;

function stripComments(source) {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "$1");
}

function specifiers(source, pattern) {
  return [...stripComments(source).matchAll(pattern)].map((match) => match[1]);
}

// "/js/app.js" (site path) → absolute file under public/.
export function sitePathToFile(sitePath) {
  return join(PUBLIC_DIR, sitePath.replace(/^\//, ""));
}

function fileToSitePath(file) {
  return "/" + relative(PUBLIC_DIR, file).split("\\").join("/");
}

function resolveSpecifier(fromFile, specifier) {
  return specifier.startsWith("/") ? sitePathToFile(specifier) : resolve(dirname(fromFile), specifier);
}

export function moduleEntries(html = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8")) {
  return [...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map((match) => match[1]);
}

export function modulePreloads(html = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8")) {
  return [...html.matchAll(/<link\s+rel="modulepreload"\s+href="([^"]+)"/g)].map((match) => match[1]);
}

// Breadth-first walk; depth = the shortest import chain from an entry, which
// is the number of round trips the browser needs before it even learns the
// module exists (without modulepreload hints).
export function buildGraph(entries = moduleEntries(), preloaded = []) {
  const depth = new Map();
  const edges = new Map();
  const lazy = [];
  const queue = [];
  for (const entry of entries) {
    const file = sitePathToFile(entry);
    if (!depth.has(file)) { depth.set(file, 0); queue.push(file); }
  }
  // A modulepreload hint is fetched with the document, so it starts at depth 0
  // too — its own imports are then discovered one hop later.
  for (const hint of preloaded) {
    const file = sitePathToFile(hint);
    if (!depth.has(file)) { depth.set(file, 0); queue.push(file); }
  }
  while (queue.length) {
    const file = queue.shift();
    const source = readFileSync(file, "utf8");
    const children = specifiers(source, STATIC_IMPORT).map((spec) => resolveSpecifier(file, spec));
    edges.set(file, children);
    for (const spec of specifiers(source, DYNAMIC_IMPORT)) {
      lazy.push({ from: fileToSitePath(file), path: fileToSitePath(resolveSpecifier(file, spec)) });
    }
    for (const child of children) {
      if (depth.has(child)) continue;
      depth.set(child, depth.get(file) + 1);
      queue.push(child);
    }
  }
  const modules = [...depth.entries()].map(([file, d]) => ({ path: fileToSitePath(file), depth: d, exists: existsSync(file) }));
  return {
    count: modules.length,
    maxDepth: Math.max(0, ...modules.map((m) => m.depth)),
    modules: modules.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
    lazy,
  };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const raw = buildGraph();
  const hinted = buildGraph(moduleEntries(), modulePreloads());
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ raw, hinted }, null, 2) + "\n");
  } else {
    process.stdout.write(`modules: ${raw.count}\nimport depth (no hints): ${raw.maxDepth}\n` +
      `effective depth (with modulepreload): ${hinted.maxDepth}\nlazy imports: ${raw.lazy.length}\n`);
    for (let d = 0; d <= raw.maxDepth; d += 1) {
      process.stdout.write(`  depth ${d}: ${raw.modules.filter((m) => m.depth === d).map((m) => m.path).join(" ")}\n`);
    }
  }
}
