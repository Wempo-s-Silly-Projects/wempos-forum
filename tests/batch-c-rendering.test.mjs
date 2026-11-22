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

// Batch C (post content rendering): vendored KaTeX, Mermaid (+ svg-pan-zoom),
// ansi_up, json-formatter-js and DOMPurify. Pins the byte-for-byte vendor
// files and their REUSE licensing, an unchanged CSP (fonts ride default-src
// 'self'; no unsafe-eval), the lazy same-origin loading (a library loads only
// when a body needs it), the math tokenizer, and XSS through every renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import * as constants from "../constants.mjs";
import { secureResponse, securityHeaders } from "../api/core/http.mjs";
import { renderBodyBlocks } from "../public/js/render.js";
import { KATEX_CSS, KATEX_OPTIONS, KATEX_SRC, MATH_MAX_CHARS, splitMath, typesetMath } from "../public/js/math.js";
import {
  ANSI_PURIFY_CONFIG, INPLACE_PURIFY_CONFIG, PURIFY_SRC, SVG_PURIFY_CONFIG, moveInlineStyles, purifyInPlace,
} from "../public/js/sanitize.js";
import {
  JSON_FORMATTER_SRC, JSON_TREE_MIN_LINES, MERMAID_CONFIG, MERMAID_MAX_CHARS, MERMAID_PAN_MIN_WIDTH,
  MERMAID_SRC, SVG_PAN_ZOOM_SRC, ansiToSafeHtml, enhanceRenderedBody, hardenTreeLinks, isAnsiFence, isMermaidFence,
  jsonTreePlan, mermaidSvgParts,
} from "../public/js/rich-blocks.js";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sha = (path) => createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const ESC = "\u001b";

// ---------------------------------------------------------------- identity

const VENDOR = {
  "public/js/vendor/purify.min.js": "f69a46022ab1f53e969c8ebbca98172c8995785a9b3be72ea4a12d25b1a1bf67",
  "public/js/vendor/katex/katex.min.js": "fa140498b8cfc8302cbe5e7cb1bdbc1f952bc38b3fa258ede09e73edbf9a74bc",
  "public/js/vendor/katex/katex.min.css": "00e0b094171b07f58422075f469b4feac2b2f7bce1aeec943c08da4d697f4dcf",
  "public/js/vendor/mermaid.min.js": "336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3",
  "public/js/vendor/svg-pan-zoom.min.js": "9c8fc41b3359e699990766dd7a943595d234a80c880a90dfc14b920a273b99d8",
  "public/js/vendor/ansi_up.js": "554a7d9ca4f3721db1f14941f92dc75b254f57d4b7bffeb84eea1174aa160780",
  "public/js/vendor/json-formatter.umd.js": "817ad56e15fd25e2605b05df0aebc3da29f0b4f7d94bfe6cce4dcf0e071809b5",
};

test("every Batch C vendor file is the approved upstream build, byte for byte", () => {
  for (const [path, hash] of Object.entries(VENDOR)) assert.equal(sha(path), hash, path);
});

test("the KaTeX stylesheet's woff2 fonts all ship beside it (other formats are never fetched)", () => {
  const css = read("public/js/vendor/katex/katex.min.css");
  const woff2 = [...css.matchAll(/url\((fonts\/[\w-]+\.woff2)\)/g)].map((m) => m[1]);
  assert.ok(woff2.length >= 20);
  for (const font of woff2) assert.ok(existsSync(new URL("public/js/vendor/katex/" + font, ROOT)), font);
  const shipped = readdirSync(new URL("public/js/vendor/katex/fonts/", ROOT));
  assert.ok(shipped.every((name) => name.endsWith(".woff2")), "only woff2 is vendored");
});

test("REUSE.toml annotates each new vendor path with its upstream licence; the texts ship", () => {
  const reuse = read("REUSE.toml");
  const block = (path) => reuse.split("[[annotations]]").find((part) => part.includes(`path = "${path}"`));
  const expected = {
    "public/js/vendor/purify.min.js": "MPL-2.0 OR Apache-2.0",
    "public/js/vendor/katex/**": "MIT",
    "public/js/vendor/mermaid.min.js": "MIT",
    "public/js/vendor/svg-pan-zoom.min.js": "BSD-2-Clause",
    "public/js/vendor/ansi_up.js": "MIT",
    "public/js/vendor/json-formatter.umd.js": "MIT",
  };
  for (const [path, licence] of Object.entries(expected)) {
    const found = block(path);
    assert.ok(found, path);
    assert.ok(found.includes(`SPDX-License-Identifier = "${licence}"`), path);
    assert.match(found, /precedence = "override"/, path);
  }
  // The narrower blocks must come after the Prism catch-all (last match wins).
  assert.ok(reuse.indexOf('"public/js/vendor/**"') < reuse.indexOf('"public/js/vendor/purify.min.js"'));
  for (const id of ["MIT", "Apache-2.0", "MPL-2.0", "BSD-2-Clause"]) {
    assert.ok(existsSync(new URL(`LICENSES/${id}.txt`, ROOT)), id);
  }
});

// ---------------------------------------------------------------- constants

test("the Batch C caps live in root constants.mjs and the client mirrors them exactly", () => {
  assert.equal(constants.MATH_MAX_CHARS, 2000);
  assert.equal(constants.MERMAID_MAX_CHARS, 20000);
  assert.equal(constants.MERMAID_PAN_MIN_WIDTH, 800);
  assert.equal(constants.JSON_TREE_MIN_LINES, 20);
  assert.equal(MATH_MAX_CHARS, constants.MATH_MAX_CHARS);
  assert.equal(MERMAID_MAX_CHARS, constants.MERMAID_MAX_CHARS);
  assert.equal(MERMAID_PAN_MIN_WIDTH, constants.MERMAID_PAN_MIN_WIDTH);
  assert.equal(JSON_TREE_MIN_LINES, constants.JSON_TREE_MIN_LINES);
});

// ---------------------------------------------------------------- CSP

test("CSP unchanged: script-src pinned, no unsafe-eval/inline, fonts ride default-src 'self'", () => {
  for (const csp of [secureResponse(new Response("x")).headers.get("Content-Security-Policy"),
    securityHeaders(new Headers()).get("Content-Security-Policy")]) {
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|wasm-unsafe-eval/);
    assert.match(csp, /default-src 'self';/);
    // 'self' plus, at most, exact sha256 hashes (v5.79 embeds add WaveSurfer's
    // one static shadow <style>); never 'unsafe-inline'.
    assert.match(csp, /style-src 'self'(?: 'sha256-[A-Za-z0-9+/=]+')*;/);
    assert.doesNotMatch(csp, /font-src/, "no font-src: default-src 'self' covers the KaTeX fonts");
  }
  const html = secureResponse(new Response("x")).headers.get("Content-Security-Policy");
  assert.match(html, /script-src 'self' https:\/\/challenges\.cloudflare\.com https:\/\/cdnjs\.cloudflare\.com\/polyfill\/;/);
});

test("no vendored renderer needs eval: no eval( or new Function anywhere in them", () => {
  for (const path of Object.keys(VENDOR).filter((p) => p.endsWith(".js"))) {
    const source = read(path);
    assert.doesNotMatch(source, /[^\w$.]eval\(/, path);
    assert.doesNotMatch(source, /new Function\(/, path);
  }
  // Mermaid's only Function() is lodash's global fallback, reached only when
  // `self` is missing (never in a browser page).
  const mermaid = read("public/js/vendor/mermaid.min.js");
  const hits = [...mermaid.matchAll(/.{0,40}Function\("return this"\)/g)];
  for (const m of hits) assert.match(m[0], /self/);
});

// ---------------------------------------------------------------- math

test("splitMath: $…$ inline and $$…$$ display, raw text kept for the fallback", () => {
  assert.deepEqual(splitMath("a $x^2$ b"), [
    { kind: "text", value: "a " },
    { kind: "math", tex: "x^2", display: false, raw: "$x^2$" },
    { kind: "text", value: " b" },
  ]);
  assert.deepEqual(splitMath("$$\\sum_i i$$"), [{ kind: "math", tex: "\\sum_i i", display: true, raw: "$$\\sum_i i$$" }]);
});

test("splitMath leaves prices, escapes, inline code, spoilers and oversized runs alone", () => {
  const plain = (text) => assert.deepEqual(splitMath(text), [{ kind: "text", value: text }], JSON.stringify(text));
  plain("costs $5 and $10 today");
  plain("a $ b $ c");
  plain("escaped \\$x$ stays");
  plain("code `$x$` stays code");
  plain("||$secret$|| spoiler");
  plain("$" + "x".repeat(MATH_MAX_CHARS + 1) + "$");
  plain("no math here");
  plain("$$$$");
  assert.equal(splitMath("$" + "x".repeat(MATH_MAX_CHARS) + "$")[0].kind, "math", "the cap is inclusive");
});

test("markup inside math is never parsed: the placeholder holds the literal source", () => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body: "see $<script>alert(1)</script>$ and $<img src=x onerror=alert(1)>$" }, document, article);
  const math = findByClass(article, "math-inline");
  assert.ok(math);
  assert.equal(math.textContent, "$<script>alert(1)</script>$");
  assert.equal(math.children.length, 0, "text only, no element built from member input");
});

test("math is never detected inside code fences or inline code", () => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body: "```\n$x$\n```\nuse `$y$` here" }, document, article);
  assert.equal(findByClass(article, "math-inline"), null);
});

test("KATEX_OPTIONS are strict: no trust, no throw, bounded size and macro expansion", () => {
  assert.equal(KATEX_OPTIONS.trust, false);
  assert.equal(KATEX_OPTIONS.throwOnError, false);
  assert.ok(KATEX_OPTIONS.maxExpand <= 1000);
  assert.ok(KATEX_OPTIONS.maxSize <= 10);
  assert.ok(Object.isFrozen(KATEX_OPTIONS));
  assert.equal(KATEX_SRC, "/js/vendor/katex/katex.min.js");
  assert.equal(KATEX_CSS, "/js/vendor/katex/katex.min.css");
});

test("real KaTeX with our options refuses javascript: links, HTML and attribute injection", () => {
  const context = vm.createContext({});
  context.window = context;
  context.self = context;
  vm.runInContext(read("public/js/vendor/katex/katex.min.js"), context);
  const render = (tex) => context.katex.renderToString(tex, { ...KATEX_OPTIONS });
  for (const tex of ["\\href{javascript:alert(1)}{x}", "\\url{javascript:alert(1)}", "\\htmlId{x}{y}",
    "\\htmlData{onclick=alert(1)}{y}", "\\includegraphics{https://evil.example/x.png}"]) {
    const html = render(tex);
    assert.doesNotMatch(html, /\son\w+=|\shref=|<img|<a\s|data-onclick/i, tex);
  }
  const escaped = render("\\text{<script>alert(1)</script>}");
  assert.doesNotMatch(escaped, /<script/);
  assert.match(escaped, /&lt;script&gt;/);
});

test("typesetMath renders each placeholder with the frozen options and keeps raw text on failure", async () => {
  const document = makeFakeDocument();
  const ok = document.createElement("span");
  ok.textContent = "$x$";
  const bad = document.createElement("span");
  bad.textContent = "$$y$$";
  const calls = [];
  const katex = {
    render(tex, node, options) {
      calls.push({ tex, options });
      if (tex === "y") throw new Error("boom");
      node.textContent = "RENDERED";
    },
  };
  await typesetMath(document, [{ node: ok, tex: "x", display: false }, { node: bad, tex: "y", display: true }],
    { loadKatex: async () => katex });
  assert.equal(ok.textContent, "RENDERED");
  assert.equal(bad.textContent, "$$y$$");
  assert.equal(calls[0].options.trust, false);
  assert.equal(calls[0].options.displayMode, false);
  assert.equal(calls[1].options.displayMode, true);
});

// ---------------------------------------------------------------- DOMPurify

test("DOMPurify configs only ever tighten: SVG forbids foreignObject/script/links, ANSI is span-only", () => {
  assert.equal(PURIFY_SRC, "/js/vendor/purify.min.js");
  for (const tag of ["foreignObject", "script", "a", "image", "use", "iframe"]) {
    assert.ok(SVG_PURIFY_CONFIG.FORBID_TAGS.includes(tag), tag);
  }
  assert.ok(SVG_PURIFY_CONFIG.FORBID_ATTR.includes("href") && SVG_PURIFY_CONFIG.FORBID_ATTR.includes("xlink:href"));
  assert.deepEqual([...ANSI_PURIFY_CONFIG.ALLOWED_TAGS], ["span"]);
  assert.deepEqual([...ANSI_PURIFY_CONFIG.ALLOWED_ATTR], ["class", "style"]);
  assert.equal(INPLACE_PURIFY_CONFIG.IN_PLACE, true);
  for (const tag of ["script", "iframe", "object", "embed", "style", "form"]) {
    assert.ok(INPLACE_PURIFY_CONFIG.FORBID_TAGS.includes(tag), tag);
  }
  for (const config of [SVG_PURIFY_CONFIG, ANSI_PURIFY_CONFIG, INPLACE_PURIFY_CONFIG]) {
    assert.ok(Object.isFrozen(config));
    assert.equal(config.ALLOW_UNKNOWN_PROTOCOLS ?? false, false);
    assert.equal(config.SAFE_FOR_TEMPLATES ?? false, false);
  }
});

test("purifyInPlace hands DOMPurify the node and the frozen in-place config", () => {
  const seen = [];
  const purify = { sanitize: (node, config) => seen.push({ node, config }) };
  const node = new FakeNode("p");
  purifyInPlace(purify, node);
  assert.equal(seen[0].node, node);
  assert.equal(seen[0].config.IN_PLACE, true);
  assert.doesNotThrow(() => purifyInPlace(null, node), "no DOMPurify: nothing to do");
});

test("moveInlineStyles: style attributes move to CSSOM (CSP style-src 'self' blocks the attribute)", () => {
  const root = new FakeNode("svg");
  const child = new FakeNode("rect");
  child.setAttribute("style", "fill:red");
  root.append(child);
  root.setAttribute("style", "max-width:100px");
  moveInlineStyles(root);
  assert.equal(child.hasAttribute("style"), false);
  assert.equal(child.style.cssText, "fill:red");
  assert.equal(root.style.cssText, "max-width:100px");
});

// ---------------------------------------------------------------- mermaid

test("mermaid fences are recognised by the info word only", () => {
  assert.equal(isMermaidFence("mermaid"), true);
  assert.equal(isMermaidFence(" Mermaid "), true);
  for (const info of ["", "js", "mermaid2", "mermaid x", null]) assert.equal(isMermaidFence(info), false, String(info));
});

test("MERMAID_CONFIG: strict security, no HTML labels, no click callbacks, locked against directives", () => {
  assert.equal(MERMAID_CONFIG.securityLevel, "strict");
  assert.equal(MERMAID_CONFIG.startOnLoad, false);
  assert.equal(MERMAID_CONFIG.htmlLabels, false);
  assert.equal(MERMAID_CONFIG.flowchart.htmlLabels, false);
  assert.equal(MERMAID_CONFIG.maxTextSize, MERMAID_MAX_CHARS);
  for (const key of ["secure", "securityLevel", "startOnLoad", "maxTextSize", "htmlLabels", "flowchart", "themeCSS",
    "fontFamily", "dompurifyConfig"]) {
    assert.ok(MERMAID_CONFIG.secure.includes(key), key);
  }
  assert.equal(MERMAID_SRC, "/js/vendor/mermaid.min.js");
  assert.equal(SVG_PAN_ZOOM_SRC, "/js/vendor/svg-pan-zoom.min.js");
});

test("mermaidSvgParts: style elements leave the fragment as text, scripts never survive", () => {
  const fragment = new FakeNode("fragment");
  const svg = new FakeNode("svg");
  const style = new FakeNode("style");
  style.textContent = "#d1 .node{fill:#eee}";
  const rect = new FakeNode("rect");
  rect.setAttribute("style", "stroke:blue");
  svg.append(style, rect);
  fragment.append(svg);
  const purify = {
    sanitize: (html, config) => {
      assert.equal(config.RETURN_DOM_FRAGMENT, true);
      return fragment;
    },
  };
  const parts = mermaidSvgParts(purify, "<svg>…</svg>");
  assert.equal(parts.svg, svg);
  assert.equal(parts.css, "#d1 .node{fill:#eee}");
  assert.equal(svg.querySelector("style"), null);
  assert.equal(rect.style.cssText, "stroke:blue");
  assert.equal(mermaidSvgParts({ sanitize: () => new FakeNode("fragment") }, "x"), null, "no svg: no diagram");
});

// ---------------------------------------------------------------- ansi

test("ANSI fences: ansi/console info AND a real escape character", () => {
  assert.equal(isAnsiFence("ansi", `${ESC}[31mred`), true);
  assert.equal(isAnsiFence("console", `${ESC}[1mbold`), true);
  assert.equal(isAnsiFence("ansi", "no escapes"), false);
  assert.equal(isAnsiFence("bash", `${ESC}[31mred`), false);
});

test("real ansi_up through ansiToSafeHtml: colours as classes, HTML always escaped, no links", async () => {
  const { AnsiUp } = await import(new URL("public/js/vendor/ansi_up.js", ROOT));
  const html = ansiToSafeHtml(AnsiUp, `${ESC}[31m<script>alert(1)</script>${ESC}[0m <img src=x onerror=alert(1)>`
    + `${ESC}]8;;javascript:alert(1)${ESC}\\click${ESC}]8;;${ESC}\\`
    + `${ESC}]8;;https://evil.example/${ESC}\\link${ESC}]8;;${ESC}\\`);
  assert.match(html, /class="ansi-red-fg"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<img|javascript:|<a /);
});

// ---------------------------------------------------------------- json

const jsonLines = (n) => JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i])), null, 1);

test("jsonTreePlan: json fences of at least JSON_TREE_MIN_LINES valid lines only", () => {
  const long = jsonLines(JSON_TREE_MIN_LINES);
  assert.ok(long.split("\n").length >= JSON_TREE_MIN_LINES);
  assert.deepEqual(jsonTreePlan("json", long).value.k0, 0);
  assert.equal(jsonTreePlan("json", '{"a":1}'), null, "short blocks stay plain");
  assert.equal(jsonTreePlan("js", long), null);
  assert.equal(jsonTreePlan("json", "," + long), null, "invalid JSON stays plain");
  assert.equal(JSON_FORMATTER_SRC, "/js/vendor/json-formatter.umd.js");
});

test("a long json block gets a tree toggle; the copy button still copies the raw text", () => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  const body = "```json\n" + jsonLines(JSON_TREE_MIN_LINES) + "\n```";
  renderBodyBlocks({ body }, document, article);
  const toggle = findByClass(article, "json-tree-toggle");
  assert.ok(toggle, "toggle button");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  const code = findByClass(article, "post-codeblock").getElementsByTagName("code")[0];
  assert.equal(code.textContent, jsonLines(JSON_TREE_MIN_LINES));
});

test("hardenTreeLinks: tree anchors open safely; anything not http(s) loses its href", () => {
  const root = new FakeNode("div");
  const good = new FakeNode("a");
  good.setAttribute("href", "https://example.com/");
  const bad = new FakeNode("a");
  bad.setAttribute("href", "javascript:alert(1)");
  root.append(good, bad);
  hardenTreeLinks(root);
  assert.equal(good.getAttribute("rel"), "noopener noreferrer");
  assert.equal(good.getAttribute("target"), "_blank");
  assert.equal(bad.hasAttribute("href"), false);
});

// ---------------------------------------------------------------- lazy loading

function headDocument() {
  const appended = [];
  const head = new FakeNode("head");
  head.append = (...nodes) => {
    appended.push(...nodes);
  };
  return { document: makeFakeDocument({ head }), appended };
}

const srcs = (appended) => appended.map((node) => node.getAttribute("src") ?? node.getAttribute("href"));

test("a plain body loads no Batch C library at all", async () => {
  const { document, appended } = headDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body: "hello **world**\n```js\nx\n```" }, document, article);
  await tick();
  for (const src of [KATEX_SRC, KATEX_CSS, MERMAID_SRC, PURIFY_SRC, SVG_PAN_ZOOM_SRC, JSON_FORMATTER_SRC]) {
    assert.ok(!srcs(appended).includes(src), src);
  }
});

test("math in a body loads KaTeX (script + same-origin stylesheet) and nothing else", async () => {
  const { document, appended } = headDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body: "area $\\pi r^2$" }, document, article);
  await tick();
  assert.ok(srcs(appended).includes(KATEX_SRC));
  assert.ok(srcs(appended).includes(KATEX_CSS));
  assert.ok(!srcs(appended).includes(MERMAID_SRC));
  for (const src of srcs(appended)) assert.match(src, /^\/js\/vendor\/[\w/.-]+$/);
});

test("a mermaid fence loads Mermaid and DOMPurify lazily; the source block stays as the fallback", async () => {
  const { document, appended } = headDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body: "```mermaid\ngraph TD; A-->B\n```" }, document, article);
  await tick();
  assert.ok(srcs(appended).includes(MERMAID_SRC));
  assert.ok(srcs(appended).includes(PURIFY_SRC));
  assert.ok(findByClass(article, "post-codeblock"), "source kept until a diagram replaces it");
});

test("enhanceRenderedBody wires mermaid output through DOMPurify and the strict config", async () => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  const pre = document.createElement("pre");
  article.append(pre);
  const svg = new FakeNode("svg");
  svg.setAttribute("viewBox", "0 0 100 50");
  const fragment = new FakeNode("fragment");
  fragment.append(svg);
  const seen = {};
  const mermaid = {
    initialize: (config) => {
      seen.config = config;
    },
    render: async (id, source) => {
      seen.source = source;
      return { svg: "<svg></svg>" };
    },
  };
  const purify = {
    sanitize: (html, config) => {
      seen.purified = config;
      return fragment;
    },
  };
  await enhanceRenderedBody(document, { math: [], ansi: [], mermaid: [{ pre, source: "graph TD; A-->B" }] }, {
    loadMermaid: async () => mermaid, loadPurify: async () => purify, loadPanZoom: async () => null,
    attachShadow: (host) => host,
  });
  assert.equal(seen.config.securityLevel, "strict");
  assert.equal(seen.source, "graph TD; A-->B");
  assert.ok(seen.purified.FORBID_TAGS.includes("foreignObject"));
  assert.ok(findByClass(article, "post-mermaid"), "diagram figure inserted");
  assert.equal(pre.hidden, true, "source hidden behind the toggle, not removed");
  assert.ok(findByClass(article, "mermaid-source-toggle"));
});

test("a mermaid source over the cap is never handed to Mermaid", async () => {
  const document = makeFakeDocument();
  let rendered = false;
  const big = { pre: new FakeNode("pre"), source: "x".repeat(MERMAID_MAX_CHARS + 1) };
  await enhanceRenderedBody(document, { math: [], ansi: [], mermaid: [big] }, {
    loadMermaid: async () => ({
      initialize() {},
      render: async () => {
        rendered = true;
        return { svg: "" };
      },
    }),
    loadPurify: async () => ({ sanitize: () => new FakeNode("fragment") }), loadPanZoom: async () => null,
  });
  assert.equal(rendered, false);
});

test("a Mermaid failure leaves the source block visible", async () => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  const pre = document.createElement("pre");
  article.append(pre);
  await enhanceRenderedBody(document, { math: [], ansi: [], mermaid: [{ pre, source: "nonsense" }] }, {
    loadMermaid: async () => ({
      initialize() {},
      render: async () => {
        throw new Error("parse");
      },
    }),
    loadPurify: async () => ({ sanitize: () => new FakeNode("fragment") }), loadPanZoom: async () => null,
  });
  assert.equal(pre.hidden, false);
  assert.equal(findByClass(article, "post-mermaid"), null);
});

test("an ANSI fence renders through ansi_up then DOMPurify into the same code element", async () => {
  const document = makeFakeDocument();
  const code = document.createElement("code");
  code.textContent = `${ESC}[31mred`;
  const fragment = new FakeNode("fragment");
  const span = new FakeNode("span");
  span.textContent = "red";
  fragment.append(span);
  let config;
  class FakeAnsiUp {
    ansi_to_html(text) {
      return `<span class="ansi-red-fg">${text.slice(5)}</span>`;
    }
  }
  await enhanceRenderedBody(document, { math: [], mermaid: [], ansi: [{ code, source: code.textContent }] }, {
    loadAnsiUp: async () => FakeAnsiUp,
    loadPurify: async () => ({
      sanitize: (html, c) => {
        config = c;
        return fragment;
      },
    }),
  });
  assert.deepEqual([...config.ALLOWED_TAGS], ["span"]);
  assert.equal(code.textContent, "red");
});

// ---------------------------------------------------------------- strings

test("every new render.* string exists in en.json and every other locale", () => {
  const keys = ["render.diagram", "render.diagramSource", "render.zoomIn", "render.zoomOut", "render.zoomReset",
    "render.jsonTree"];
  const dir = new URL("public/locales/", ROOT);
  for (const file of readdirSync(dir)) {
    const table = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    for (const key of keys) assert.equal(typeof table[key], "string", `${file}: ${key}`);
  }
});

test("edit then cancel hides the diagram with the body and never reveals its hidden source", async () => {
  const { openEditForm, closeEditForm } = await import("../public/js/render.js");
  const document = makeFakeDocument();
  const article = document.createElement("article");
  article.postBody = "x";
  article.dataset.postId = "1";
  const figure = document.createElement("figure");
  figure.className = "post-mermaid";
  const pre = document.createElement("pre");
  pre.className = "post-codeblock";
  pre.hidden = true;
  article.append(figure, pre);
  assert.equal(openEditForm(article, document), true);
  assert.equal(figure.hidden, true);
  closeEditForm(article);
  assert.equal(figure.hidden, false);
  assert.equal(pre.hidden, true, "the source stays behind its toggle");
});
