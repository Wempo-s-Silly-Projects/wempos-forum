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

// Wave 5.73.0 (slate 2026-11-22-b): B1 shrink-wrapped DM bubbles, B2 in-house
// code highlighting through the CSS Custom Highlight API (no DOM mutation),
// B3 the no-module notice for browsers that cannot run ES modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { FakeNode, FakeText } from "./helpers/fake-dom.mjs";
import * as serverConstants from "../constants.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CSS = read("public/styles.css");
const HTML = read("public/index.html");

// The body of the first rule whose selector is exactly `selector`.
function rule(selector) {
  const escaped = selector.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const match = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `rule ${selector} not found in styles.css`);
  return match[1];
}

// ---- B1: shrink-wrapped DM bubbles ----

test("B1: a DM bubble is only as wide as its text, capped at 78%", () => {
  const body = rule(".dm-thread-view .chat-message-body");
  assert.match(body, /\bwidth:\s*fit-content;/);
  assert.match(body, /\bmax-inline-size:\s*78%;/);
  assert.doesNotMatch(body, /\bmax-width:/, "the cap is the logical max-inline-size");
});

test("B1: own DM bubbles align to the logical end (RTL-safe)", () => {
  const row = rule(".dm-thread-view .chat-message.chat-mine");
  assert.match(row, /align-items:\s*flex-end;/);
  assert.match(row, /text-align:\s*end;/);
  const bubble = rule(".dm-thread-view .chat-message.chat-mine .chat-message-body");
  assert.match(bubble, /align-self:\s*end;/);
  for (const text of [row, bubble]) {
    assert.doesNotMatch(text, /\b(?:left|right)\b|margin-left|margin-right|float:/);
  }
});

test("B1: the chat-panel DM bubble shrink-wraps and keeps its 85% cap", () => {
  const body = rule(".chat-widget-message");
  assert.match(body, /\bwidth:\s*fit-content;/);
  assert.match(body, /\bmax-inline-size:\s*85%;/);
  assert.doesNotMatch(body, /\bmax-width:/);
  assert.match(rule(".chat-widget-message.mine"), /align-self:\s*flex-end;/);
});

test("B1 (Roselli): no hover/focus rule resizes a message bubble", () => {
  for (const [, selector, body] of CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/chat-message-body|chat-widget-message\b/.test(selector)) continue;
    if (!/:(?:hover|focus)/.test(selector)) continue;
    assert.doesNotMatch(body, /width|inline-size|padding|font-weight|font-size|border-width/, selector.trim());
  }
});

test("B1: lobby, easy-reading and line-spacing rules still exclude media bodies", () => {
  assert.match(CSS, /\.chat-widget-lobby \.chat-message\.chat-mine \.chat-message-body\s*\{\s*color:\s*var\(--muted\);\s*\}/);
  assert.match(CSS, /:root\.easy-reading :where\([^)]*\.chat-message-body\):not\(\.chat-gif-body, \.chat-dm-image-body, \.chat-emoji-jumbo\)/);
  assert.match(CSS, /:root\[data-line-spacing="relaxed"\] :is\(\.post-body, \.chat-message-body:not\(\.chat-gif-body, \.chat-dm-image-body, \.chat-emoji-jumbo\), textarea\)/);
});

// ---- B2: in-house code highlighting ----

const highlighter = await import("../public/js/code-highlight.js").catch((error) => ({ loadError: error }));
const hl = () => {
  assert.ok(!highlighter.loadError, `public/js/code-highlight.js failed to load: ${highlighter.loadError}`);
  return highlighter;
};
const tokens = (text, lang) => hl().tokenize(text, lang).map(({ type, start, end }) => [type, text.slice(start, end)]);

test("B2 tokenizer: keywords and numbers, identifiers left alone", () => {
  assert.deepEqual(tokens("const x = 1; return x1;", "js"), [
    ["keyword", "const"], ["number", "1"], ["keyword", "return"],
  ]);
});

test("B2 tokenizer: strings with escapes, keywords inside strings stay strings", () => {
  assert.deepEqual(tokens(String.raw`"a\"if" + 'c\\' + ` + "`t`", "js"), [
    ["string", String.raw`"a\"if"`], ["string", String.raw`'c\\'`], ["string", "`t`"],
  ]);
});

test("B2 tokenizer: an unterminated string stops at the end of its line", () => {
  assert.deepEqual(tokens('"abc\nlet y', "js"), [["string", '"abc'], ["keyword", "let"]]);
});

test("B2 tokenizer: line and block comments per language", () => {
  assert.deepEqual(tokens("// hi\nx /* if */ # z", "js"), [["comment", "// hi"], ["comment", "/* if */"]]);
  assert.deepEqual(tokens("x = 1 # if\ndef f(): pass", "py"), [
    ["number", "1"], ["comment", "# if"], ["keyword", "def"], ["keyword", "pass"],
  ]);
  assert.deepEqual(tokens("echo $1 # done", "sh"), [["keyword", "echo"], ["comment", "# done"]]);
  assert.deepEqual(tokens("a { color: red } /* x */", "css"), [["comment", "/* x */"]]);
  assert.deepEqual(tokens("/* unclosed\nif", "js"), [["comment", "/* unclosed\nif"]]);
});

test("B2 tokenizer: numbers (hex, decimal, exponent), not inside identifiers", () => {
  assert.deepEqual(tokens("0x1F 3.14 1e9 a1 _2", "generic"), [
    ["number", "0x1F"], ["number", "3.14"], ["number", "1e9"],
  ]);
});

test("B2 tokenizer: JSON knows true/false/null and double-quoted strings", () => {
  assert.deepEqual(tokens('{"a": true, "b": null, "c": -2}', "json"), [
    ["string", '"a"'], ["keyword", "true"], ["string", '"b"'], ["keyword", "null"], ["string", '"c"'], ["number", "2"],
  ]);
});

test("B2: the fence info string picks the keyword set", () => {
  const { languageOf } = hl();
  assert.equal(languageOf("js"), "js");
  assert.equal(languageOf("TypeScript"), "js");
  assert.equal(languageOf("python"), "py");
  assert.equal(languageOf("bash"), "sh");
  assert.equal(languageOf("json"), "json");
  assert.equal(languageOf("css"), "css");
  assert.equal(languageOf("html"), "html");
  assert.equal(languageOf("rust"), "generic");
  assert.equal(languageOf(""), "generic");
  assert.equal(languageOf(undefined), "generic");
  assert.deepEqual(tokens("def function", "py"), [["keyword", "def"]]);
  assert.deepEqual(tokens("def function", "js"), [["keyword", "function"]]);
});

test("B2: tokenizing a block at the cap stays fast", () => {
  const cap = hl().CODE_HIGHLIGHT_MAX_CHARS;
  const line = "let s = \"x\"; // c\n";
  const big = line.repeat(Math.floor(cap / line.length));
  const started = performance.now();
  hl().tokenize(big, "js");
  assert.ok(performance.now() - started < 200);
});

// A fake Highlight registry + Range recorder (the fake DOM has neither).
function fakeEnv() {
  const highlights = new Map();
  const ranges = [];
  class Highlight { constructor(...items) { this.items = items; } }
  const createRange = () => {
    const range = {
      setStart(node, offset) { this.node = node; this.start = offset; },
      setEnd(node, offset) { this.endNode = node; this.end = offset; },
    };
    ranges.push(range);
    return range;
  };
  return { highlights, Highlight, createRange, ranges };
}
function codeBlock(text, lang) {
  const pre = new FakeNode("pre");
  pre.className = "post-codeblock";
  const code = new FakeNode("code");
  if (lang) code.dataset.lang = lang;
  code.append(new FakeText(text));
  pre.append(code);
  return { pre, code };
}

test("B2: highlighting registers ranges and never mutates the DOM", () => {
  const root = new FakeNode("div");
  const { pre, code } = codeBlock('let a = "s"; // c', "js");
  root.append(pre);
  const env = fakeEnv();
  hl().highlightCodeBlocks(root, env);
  assert.equal(code.childNodes.length, 1, "no spans inserted");
  assert.equal(code.textContent, 'let a = "s"; // c');
  assert.equal(pre.childNodes.length, 1);
  const spans = (name) => env.highlights.get(name).items.map((r) => code.firstChild.textContent.slice(r.start, r.end));
  assert.deepEqual(spans("code-keyword"), ["let"]);
  assert.deepEqual(spans("code-string"), ['"s"']);
  assert.deepEqual(spans("code-comment"), ["// c"]);
  for (const range of env.ranges) assert.equal(range.node, code.firstChild);
});

test("B2: a no-op when CSS.highlights is missing", () => {
  const root = new FakeNode("div");
  root.append(codeBlock("let a", "js").pre);
  let created = 0;
  const count = hl().highlightCodeBlocks(root, { highlights: undefined, Highlight: undefined, createRange: () => { created += 1; } });
  assert.equal(count, 0);
  assert.equal(created, 0);
  assert.doesNotThrow(() => hl().scheduleCodeHighlight());
});

test("B2: blocks over CODE_HIGHLIGHT_MAX_CHARS are skipped", () => {
  const { CODE_HIGHLIGHT_MAX_CHARS } = hl();
  assert.equal(CODE_HIGHLIGHT_MAX_CHARS, serverConstants.CODE_HIGHLIGHT_MAX_CHARS, "client mirror equals constants.mjs");
  const root = new FakeNode("div");
  root.append(codeBlock("let ".repeat(Math.ceil(CODE_HIGHLIGHT_MAX_CHARS / 4) + 1), "js").pre);
  const env = fakeEnv();
  hl().highlightCodeBlocks(root, env);
  assert.equal(env.ranges.length, 0);
});

test("B2: each pass rebuilds the sets from the blocks still on the page", () => {
  const root = new FakeNode("div");
  const first = codeBlock("let a", "js");
  const second = codeBlock("const b", "js");
  root.append(first.pre, second.pre);
  const env = fakeEnv();
  hl().highlightCodeBlocks(root, env);
  assert.equal(env.highlights.get("code-keyword").items.length, 2);
  first.pre.remove();
  hl().highlightCodeBlocks(root, env);
  assert.equal(env.highlights.get("code-keyword").items.length, 1);
  second.pre.remove();
  hl().highlightCodeBlocks(root, env);
  assert.equal(env.highlights.has("code-keyword"), false, "an empty set is removed");
});

test("B2: code-highlight.js is DOM-read-only, feature-detected, no third-party code", () => {
  const source = read("public/js/code-highlight.js");
  assert.match(source, /globalThis\.CSS\?\.highlights/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|createElement|\.append\(|textContent\s*=|eval\(|new Function/);
  assert.doesNotMatch(source, /^\s*import\b/m, "no imports: no third-party code");
  assert.doesNotMatch(source, /localStorage|sessionStorage|api\(/);
});

test("B2: fences keep a safe info string and render.js wires the highlighter", async () => {
  const { parseBlocks } = await import("../public/js/markdown.js");
  assert.equal(parseBlocks("```js\nlet a\n```")[0].lang, "js");
  assert.equal(parseBlocks("```\nlet a\n```")[0].lang, "");
  assert.equal(parseBlocks("```<b onload=x>\nlet a\n```")[0].lang, "");
  assert.deepEqual(parseBlocks("```py\nx\ny\n```")[0].text, ["x", "y"]);
  const render = read("public/js/render.js");
  assert.match(render, /import \{ scheduleCodeHighlight \} from "\.\/code-highlight\.js";/);
  assert.match(render, /if \(block\.lang\) code\.dataset\.lang = block\.lang;/);
  assert.match(render, /scheduleCodeHighlight\(\);/);
  assert.match(render, /createCopyCodeButton\(document, \(\) => code\.textContent\)/, "copy stays plain text");
  assert.match(HTML, /<link rel="modulepreload" href="\/js\/code-highlight\.js">/);
});

test("B2: ::highlight rules use theme tokens; forced colors stay plain", () => {
  for (const name of ["keyword", "string", "comment", "number"]) {
    assert.match(CSS, new RegExp(`::highlight\\(code-${name}\\)\\s*\\{\\s*color:\\s*var\\(--code-${name}\\);\\s*\\}`));
  }
  assert.match(CSS, /@media \(forced-colors: active\)\s*\{\s*::highlight\(code-keyword\),\s*::highlight\(code-string\),\s*::highlight\(code-comment\),\s*::highlight\(code-number\)\s*\{\s*color:\s*CanvasText;/);
  assert.match(CSS, /@media \(prefers-contrast: more\)\s*\{/);
});

// ---- B3: the no-module notice ----

test("B3: index.html carries a hidden static notice and a same-origin nomodule script", () => {
  const block = HTML.match(/<div id="legacy-notice" class="legacy-notice" hidden>([\s\S]*?)<\/div>/);
  assert.ok(block, "hidden #legacy-notice block");
  assert.match(block[1], /<a href="https:\/\/[^"]+">/);
  assert.doesNotMatch(block[1], /<(?:img|script|iframe|link)\b|\bsrc=/i, "no resource loads");
  assert.match(HTML, /<script nomodule src="\/js\/legacy-notice\.js"><\/script>/);
  assert.match(CSS, /\.legacy-notice\s*\{/);
});

test("B3: legacy-notice.js is plain ES5 and un-hides the notice", () => {
  assert.ok(existsSync(new URL("../public/js/legacy-notice.js", import.meta.url)), "public/js/legacy-notice.js exists");
  const source = read("public/js/legacy-notice.js");
  const code = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|\bimport\b|\bexport\b|`|\bclass\b|\.\.\./);
  const notice = { attrs: { hidden: "" }, removeAttribute(name) { delete this.attrs[name]; } };
  vm.runInNewContext(source, { document: { getElementById: (id) => (id === "legacy-notice" ? notice : null) } });
  assert.equal("hidden" in notice.attrs, false);
  assert.doesNotThrow(() => vm.runInNewContext(source, { document: { getElementById: () => null } }));
});
