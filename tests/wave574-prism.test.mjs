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

// Wave 5.74 (slate 2026-11-22-d, B2): vendored Prism 1.30.0 highlighting.
// Pins the byte-for-byte vendor file and its REUSE licensing, the lazy
// same-origin loader (manual mode first, one script each, only when a block
// asks for it), the fence-info sanitiser, the size cap and line-number
// threshold, copy-code fidelity after real Prism highlighting (run in vm),
// the scoped token theme's contrast in light and dark, and an unchanged CSP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import * as constants from "../constants.mjs";
import {
  CODE_HIGHLIGHT_MAX_CHARS, CODE_LINE_NUMBERS_MIN_LINES, PRISM_AUTOLOADER_PATH, PRISM_CONFIG_SRC, PRISM_SRC,
  codeBlockPlan, codeLanguageClass, createCodeHighlighter,
} from "../public/js/code-highlight.js";
import { createCopyCodeButton } from "../public/js/copy-code.js";
import { renderBodyBlocks } from "../public/js/render.js";
import { secureResponse } from "../api/core/http.mjs";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const VENDOR_SHA256 = "918b44fb3f752ac35614f73a0f219569f4b162034614eb265191cec747baa945";
const AA = 4.5;
const AAA = 7;
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- identity

test("public/js/vendor/prism.js is the approved Prism 1.30.0 build, byte for byte", () => {
  const bytes = readFileSync(new URL("public/js/vendor/prism.js", ROOT));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), VENDOR_SHA256);
});

test("REUSE.toml annotates public/js/vendor/** as MIT (PrismJS) and LICENSES/MIT.txt ships", () => {
  const reuse = read("REUSE.toml");
  const block = reuse.split("[[annotations]]").find((part) => part.includes('"public/js/vendor/**"'));
  assert.ok(block, "an annotations block names public/js/vendor/**");
  assert.match(block, /SPDX-License-Identifier = "MIT"/);
  assert.match(block, /SPDX-FileCopyrightText = "Lea Verou and PrismJS contributors"/);
  assert.match(block, /precedence = "override"/);
  const mit = read("LICENSES/MIT.txt");
  assert.match(mit, /^MIT License/);
  assert.match(mit, /Permission is hereby granted, free of charge/);
});

test("no Prism stylesheet ships under public/ (our scoped theme lives in styles.css)", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  const css = walk(new URL("public/", ROOT).pathname).filter((file) => /prism[^/]*\.css$/i.test(file));
  assert.deepEqual(css, []);
});

// ---------------------------------------------------------------- constants

test("the two new constants live in root constants.mjs and the client mirrors them exactly", () => {
  assert.equal(constants.CODE_LINE_NUMBERS_MIN_LINES, 5);
  assert.equal(constants.CODE_HIGHLIGHT_MAX_CHARS, 20000);
  assert.equal(CODE_LINE_NUMBERS_MIN_LINES, constants.CODE_LINE_NUMBERS_MIN_LINES);
  assert.equal(CODE_HIGHLIGHT_MAX_CHARS, constants.CODE_HIGHLIGHT_MAX_CHARS);
});

// ---------------------------------------------------------------- sanitiser

test("fence info sanitiser: [\\w-]{1,32} becomes language-<name>, anything else language-none", () => {
  assert.equal(codeLanguageClass("js"), "language-js");
  assert.equal(codeLanguageClass("  python "), "language-python");
  assert.equal(codeLanguageClass("objective-c"), "language-objective-c");
  assert.equal(codeLanguageClass("C_sharp"), "language-c_sharp");
  assert.equal(codeLanguageClass("x".repeat(32)), "language-" + "x".repeat(32));
  for (const bad of ["../x", "a b", '"><img', "x".repeat(33), "", null, undefined, "js;", "é", "a/b", "a.b"]) {
    assert.equal(codeLanguageClass(bad), "language-none", JSON.stringify(bad));
  }
});

test("codeBlockPlan: named languages highlight; none and oversized blocks stay plain; line numbers from the threshold", () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `x${i}`).join("\n");
  assert.deepEqual(codeBlockPlan("js", lines(5)), { languageClass: "language-js", highlight: true, lineNumbers: true });
  assert.deepEqual(codeBlockPlan("js", lines(4)), { languageClass: "language-js", highlight: true, lineNumbers: false });
  assert.deepEqual(codeBlockPlan("", lines(9)), { languageClass: "language-none", highlight: false, lineNumbers: false });
  assert.deepEqual(codeBlockPlan("a b", "x"), { languageClass: "language-none", highlight: false, lineNumbers: false });
  const huge = "y".repeat(CODE_HIGHLIGHT_MAX_CHARS + 1);
  assert.deepEqual(codeBlockPlan("js", huge), { languageClass: "language-js", highlight: false, lineNumbers: false });
  assert.equal(codeBlockPlan("js", "y".repeat(CODE_HIGHLIGHT_MAX_CHARS)).highlight, true, "the cap is inclusive");
});

// ---------------------------------------------------------------- loader

function loaderHarness() {
  const appended = [];
  const head = new FakeNode("head");
  head.append = (...nodes) => { appended.push(...nodes); };
  const document = makeFakeDocument({ head });
  const highlighted = [];
  const prism = { highlightElement: (code) => highlighted.push(code) };
  let prismLoaded = false;
  const highlighter = createCodeHighlighter(document, () => (prismLoaded ? prism : undefined));
  const fire = async (index, type) => {
    if (type === "load" && index === 1) prismLoaded = true;
    for (const listener of appended[index].listeners[type] ?? []) listener({});
    await tick();
  };
  return { appended, highlighted, highlighter, fire, document };
}

test("loader does nothing when there is no code block to highlight", async () => {
  const { appended, highlighter } = loaderHarness();
  highlighter.highlight([]);
  await tick();
  assert.equal(appended.length, 0);
});

test("loader: manual-mode config first, then the same-origin vendor script once, then highlightElement per block", async () => {
  const { appended, highlighted, highlighter, fire, document } = loaderHarness();
  const a = document.createElement("code");
  const b = document.createElement("code");
  highlighter.highlight([a]);
  highlighter.highlight([b]);
  assert.equal(appended.length, 1, "only the config script until it has loaded");
  assert.equal(appended[0].getAttribute("src"), PRISM_CONFIG_SRC);
  await fire(0, "load");
  assert.equal(appended.length, 2);
  assert.equal(appended[1].getAttribute("src"), PRISM_SRC);
  assert.equal(appended[1].getAttribute("data-autoloader-path"), PRISM_AUTOLOADER_PATH);
  await fire(1, "load");
  assert.deepEqual(highlighted, [a, b]);
  const c = document.createElement("code");
  highlighter.highlight([c]);
  await tick();
  assert.equal(appended.length, 2, "idempotent: never a second script");
  assert.deepEqual(highlighted, [a, b, c]);
  for (const script of appended) {
    const src = script.getAttribute("src");
    assert.match(src, /^\/js\/[\w/.-]+\.js$/, "same-origin absolute path");
    assert.equal(script.tagName.toLowerCase(), "script");
  }
  assert.equal(PRISM_CONFIG_SRC, "/js/prism-config.js");
  assert.equal(PRISM_SRC, "/js/vendor/prism.js");
  assert.equal(PRISM_AUTOLOADER_PATH, "/js/vendor/components/");
});

test("a failed load leaves blocks plain and is not retried", async () => {
  const { appended, highlighted, highlighter, fire } = loaderHarness();
  highlighter.highlight([new FakeNode("code")]);
  await fire(0, "error");
  highlighter.highlight([new FakeNode("code")]);
  await tick();
  assert.equal(appended.length, 1);
  assert.deepEqual(highlighted, []);
});

test("a document without a head (tests, workers) is a silent no-op", () => {
  const highlighter = createCodeHighlighter(makeFakeDocument(), () => undefined);
  assert.doesNotThrow(() => highlighter.highlight([new FakeNode("code")]));
});

test("prism-config.js puts Prism in manual mode before the vendor file runs", () => {
  const context = vm.createContext({});
  context.window = context;
  vm.runInContext(read("public/js/prism-config.js"), context);
  assert.equal(context.Prism.manual, true);
  vm.runInContext(read("public/js/vendor/prism.js"), context);
  assert.equal(context.Prism.manual, true, "the vendor file honours the preset flag");
  assert.equal(typeof context.Prism.highlightElement, "function");
});

// ---------------------------------------------------------------- render

const renderCode = (body) => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body }, document, article);
  const pre = findByClass(article, "post-codeblock");
  const code = Array.from(pre.children).find((node) => node.tagName?.toLowerCase() === "code");
  return { article, pre, code };
};

test("renderBodyBlocks tags the code with the sanitised language and opts out of whitespace rewriting", () => {
  const { pre, code } = renderCode("```js\nconst a = 1;\n```");
  assert.match(code.className, /(^|\s)language-js(\s|$)/);
  assert.match(code.className, /(^|\s)no-whitespace-normalization(\s|$)/);
  assert.doesNotMatch(pre.className, /line-numbers/);
  assert.equal(code.textContent, "const a = 1;");
  const hostile = renderCode('```"><img src=x>\nx\n```');
  assert.match(hostile.code.className, /(^|\s)language-none(\s|$)/);
  assert.doesNotMatch(hostile.code.className, /img|"/);
});

test("renderBodyBlocks adds line-numbers only from the threshold, and never to plain or oversized blocks", () => {
  const five = Array.from({ length: CODE_LINE_NUMBERS_MIN_LINES }, (_, i) => `l${i}`).join("\n");
  assert.match(renderCode("```js\n" + five + "\n```").pre.className, /(^|\s)line-numbers(\s|$)/);
  const four = five.split("\n").slice(1).join("\n");
  assert.doesNotMatch(renderCode("```js\n" + four + "\n```").pre.className, /line-numbers/);
  assert.doesNotMatch(renderCode("```\n" + five + "\n```").pre.className, /line-numbers/);
  const huge = ("z".repeat(80) + "\n").repeat(Math.ceil(CODE_HIGHLIGHT_MAX_CHARS / 80) + 1);
  assert.doesNotMatch(renderCode("```js\n" + huge + "```").pre.className, /line-numbers/);
});

test("edit swap and thread text still see a code block once Prism wraps it in .code-toolbar", () => {
  assert.match(read("public/js/render.js"), /code-toolbar/, "isEditBodyBlock knows the toolbar wrapper");
  const threadText = read("public/js/thread-text.js");
  assert.match(threadText, /"code-toolbar"/);
  assert.match(threadText, /"toolbar"/, "the Prism language label is not exported as body text");
});

test("copy-code still yields the plain source after real Prism highlighting (vm)", async () => {
  const context = vm.createContext({});
  context.window = context;
  vm.runInContext(read("public/js/prism-config.js"), context);
  vm.runInContext(read("public/js/vendor/prism.js"), context);
  const source = "const a = 1; // <b>&amp;\nfunction f(x) {\n  return `${x}`;\n}";
  const html = context.Prism.highlight(source, context.Prism.languages.javascript, "javascript");
  assert.match(html, /class="token keyword[ "]/, "real tokens were produced");
  const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const textContent = decode(html.replace(/<[^>]+>/g, ""));
  const written = [];
  const tools = createCopyCodeButton(makeFakeDocument(), () => textContent, {
    clipboard: { writeText: async (text) => { written.push(text); } }, schedule: () => {},
  });
  await findByClass(tools, "copy-code").fire("click");
  assert.deepEqual(written, [source]);
});

// ---------------------------------------------------------------- theme

const CSS = read("public/styles.css");
const CODE_TOKENS = ["--code-comment", "--code-punctuation", "--code-keyword", "--code-string", "--code-number",
  "--code-function", "--code-class-name", "--code-operator", "--code-regex", "--code-deleted", "--code-inserted"];
const DIFF_BGS = ["--code-deleted-bg", "--code-inserted-bg"];
const tokensIn = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));

function block(selector) {
  const escaped = selector.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const match = CSS.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `block ${selector} not found in styles.css`);
  return tokensIn(match[1]);
}
function luminance(hex) {
  assert.match(hex ?? "", /^#[0-9a-f]{6}$/i, `expected a 6-digit hex colour, got ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mediaBlock = (query) => {
  const start = CSS.indexOf(`@media (${query}) {`);
  assert.ok(start >= 0, `@media (${query}) exists`);
  return CSS.slice(start, CSS.indexOf("\n}\n", start));
};

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

for (const [name, theme] of Object.entries({ light, dark })) {
  for (const token of CODE_TOKENS) {
    test(`${name}: ${token} on the code background (--field) is at least ${AA}:1`, () => {
      assert.ok(theme[token], `${token} missing from ${name}`);
      const value = ratio(theme[token], theme["--field"]);
      assert.ok(value >= AA, `${name} ${token} ${theme[token]} on ${theme["--field"]} = ${value.toFixed(2)}:1`);
    });
  }
  test(`${name}: diff line backgrounds keep ink and their sign colour at least ${AA}:1`, () => {
    for (const [bg, fg] of [["--code-deleted-bg", "--code-deleted"], ["--code-inserted-bg", "--code-inserted"]]) {
      assert.ok(ratio(theme["--ink"], theme[bg]) >= AA, `${name} --ink on ${bg}`);
      assert.ok(ratio(theme[fg], theme[bg]) >= AA, `${name} ${fg} on ${bg}`);
    }
  });
}

test("the OS-dark route repeats the manual dark code tokens exactly", () => {
  const osDark = tokensIn(mediaBlock("prefers-color-scheme: dark"));
  for (const token of [...CODE_TOKENS, ...DIFF_BGS]) {
    assert.equal(osDark[token], dark[token], `${token} matches between the two dark routes`);
  }
});

test("prefers-contrast: more strengthens every code token to at least 7:1 in light and dark", () => {
  const body = mediaBlock("prefers-contrast: more");
  const pick = (selector) => {
    const at = body.indexOf(selector + " {");
    assert.ok(at >= 0, `${selector} inside prefers-contrast`);
    return tokensIn(body.slice(at, body.indexOf("}", at)));
  };
  const strongLight = pick(":root");
  const strongDark = pick(':root[data-theme="dark"]');
  const strongOsDark = pick(':root:not([data-theme="light"]):not([data-theme="dark"])');
  for (const token of CODE_TOKENS) {
    assert.ok(ratio(strongLight[token], light["--field"]) >= AAA, `light strong ${token}`);
    assert.ok(ratio(strongDark[token], dark["--field"]) >= AAA, `dark strong ${token}`);
    assert.equal(strongOsDark[token], strongDark[token], `OS-dark strong ${token} repeats the manual one`);
    assert.ok(ratio(strongLight[token], light["--field"]) > ratio(light[token], light["--field"]), `light ${token} is stronger`);
    assert.ok(ratio(strongDark[token], dark["--field"]) > ratio(dark[token], dark["--field"]), `dark ${token} is stronger`);
  }
});

test("forced-colors makes tokens plain CanvasText; reduced motion stops the previewer motion", () => {
  assert.match(CSS, /@media \(forced-colors: active\) \{[^@]*\.post-codeblock \.token[^{]*\{[^}]*color: CanvasText/);
  const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  assert.match(reduced, /\.prism-previewer[^{]*\{[^}]*transition: none/);
  assert.match(reduced, /\.prism-previewer-time circle[^{]*\{[^}]*animation: none/);
});

test("theme hides the CSP-blocked inline colour swatch and draws treeview lines with glyphs", () => {
  assert.match(CSS, /\.inline-color-wrapper\s*\{[^}]*display: none/);
  assert.match(CSS, /\.line-h::before\s*\{[^}]*content: "├── "/);
  assert.match(CSS, /\.line-v-last::before\s*\{[^}]*content: "└── "/);
  assert.match(CSS, /\.code-toolbar:focus-within > \.toolbar/);
  assert.doesNotMatch(CSS, /url\(\s*["']?data:/, "no data: fonts or images (CSP)");
});

test("the line-number gutter uses logical properties (RTL-safe)", () => {
  const rows = CSS.match(/\.line-numbers-rows\s*\{([^}]*)\}/);
  assert.ok(rows, ".line-numbers-rows rule exists");
  assert.match(rows[1], /inset-inline-start/);
  assert.match(rows[1], /border-inline-end/);
  assert.doesNotMatch(rows[1], /(^|[\s;])(left|right)\s*:/);
});

// ---------------------------------------------------------------- CSP

test("CSP is unchanged: same script origins, style-src 'self', nothing inline", () => {
  const csp = secureResponse(new Response("x")).headers.get("Content-Security-Policy");
  const scriptSrc = (csp.match(/script-src ([^;]+);/) ?? [])[1].split(/\s+/);
  // v5.73.1 scoped cdnjs to the polyfill path; Prism must not widen it again.
  assert.deepEqual(scriptSrc, ["'self'", "https://challenges.cloudflare.com", "https://cdnjs.cloudflare.com/polyfill/"]);
  assert.match(csp, /style-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|font-src/);
});

test("no inline script: the loader builds script elements; index.html gains no Prism tag", () => {
  assert.ok(existsSync(new URL("public/js/prism-config.js", ROOT)));
  const loader = read("public/js/code-highlight.js");
  assert.match(loader, /createElement\("script"\)/);
  assert.doesNotMatch(loader, /innerHTML|textContent\s*=|\.text\s*=/);
  assert.doesNotMatch(read("public/index.html"), /prism/i);
});
