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

// Batch I item 1: the profile-CSS sandbox runs on a real CSS parser
// (css-tree). Every emitted rule is scoped under .profile-theme-scope, the
// output re-parses cleanly, and a hostile corpus never escapes: no off-origin
// url(), no @import or other at-rules beyond @media/@keyframes, no
// expression()/behavior/-moz-binding, no fixed overlays, no z-index.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import parse from "css-tree/parser";
import walk from "css-tree/walker";
import { scopeProfileCss } from "../api/profile-css.mjs";

const SCOPE = "profile-theme-scope";

// The invariant every output must satisfy, checked on a fresh parse.
function assertSandboxed(output) {
  if (output === "") return;
  const errors = [];
  const ast = parse(output, { onParseError: (error) => errors.push(error.message), parseValue: true });
  assert.deepEqual(errors, [], "output re-parses without errors: " + output);
  walk(ast, (node) => {
    assert.notEqual(node.type, "Raw", "no Raw node survives: " + output);
    if (node.type === "Atrule") {
      assert.ok(["media", "keyframes"].includes(node.name.toLowerCase()), "only @media/@keyframes: " + node.name);
    }
    if (node.type === "Url") {
      assert.match(node.value, /^\/(?!\/)/, "url() stays same-origin: " + node.value);
    }
    if (node.type === "Declaration") {
      const property = node.property.toLowerCase();
      assert.ok(!["z-index", "position", "behavior", "-moz-binding"].includes(property), "blocked property " + property);
    }
    if (node.type === "Function") {
      assert.ok(!/expression|image-set|element|paint|src/i.test(node.name), "blocked function " + node.name);
    }
  });
  walk(ast, {
    visit: "Rule",
    enter(node) {
      if (this.atrule && /keyframes/i.test(this.atrule.name)) return;
      for (const selector of node.prelude.children.toArray()) {
        const parts = selector.children.toArray();
        assert.equal(parts[0].type, "ClassSelector", "selector starts with the scope class: " + output);
        assert.equal(parts[0].name, SCOPE);
        assert.equal(parts[1].type, "Combinator", "scope is followed by a descendant combinator");
        assert.equal(parts[1].name, " ");
      }
    },
  });
}

test("plain rules keep working and every selector in a list is scoped", () => {
  const out = scopeProfileCss(".bio, h2 { color: red; background-color: #fff }");
  assert.match(out, /\.profile-theme-scope \.bio,\s*\.profile-theme-scope h2\s*\{color:red;background-color:#fff\}/);
  assertSandboxed(out);
});

test("@media keeps its condition and scopes its inner rules", () => {
  const out = scopeProfileCss("@media (max-width: 600px) { .a { color: blue } }");
  assert.match(out, /^@media \(max-width:600px\)\{\.profile-theme-scope \.a\{color:blue\}\}$/);
  assertSandboxed(out);
});

test("@keyframes survive under a profile- namespace so they cannot replace the site's own", () => {
  const out = scopeProfileCss("@keyframes spin { from { opacity: 0 } to { opacity: 1 } }");
  assert.match(out, /@keyframes profile-spin\{from\{opacity:0\}to\{opacity:1\}\}/);
  assertSandboxed(out);
});

test("same-origin url() survives; off-origin, protocol-relative, data and javascript urls are dropped", () => {
  const out = scopeProfileCss([
    ".ok { background-image: url(/img/bg.png) }",
    ".a { background-image: url(https://evil.example/x.png) }",
    ".b { background-image: url('//evil.example/x.png') }",
    ".c { background-image: url(\"javascript:alert(1)\") }",
    ".d { background-image: url(data:image/png;base64,AAAA) }",
    ".e { background: u\\72l(https://evil.example/x.png) }",
    ".f { background-image: image-set(\"https://evil.example/x.png\" 1x) }",
    ".g { background-image: -webkit-image-set(\"https://evil.example/x.png\" 1x) }",
  ].join("\n"));
  assert.match(out, /url\(\/img\/bg\.png\)/);
  assert.doesNotMatch(out, /evil|javascript|data:/i);
  assertSandboxed(out);
});

const HOSTILE = [
  "@import url(https://evil.example/x.css); .a{color:red}",
  "@import 'x.css';",
  "@font-face { font-family: x; src: url(https://evil.example/f.woff) }",
  "@supports (display:grid) { body { display: none } }",
  "@namespace svg url(http://www.w3.org/2000/svg);",
  "@layer base { body { display:none } }",
  "@container (min-width: 1px) { body { display:none } }",
  "@property --x { syntax: '*'; inherits: false }",
  "@scope (body) { * { display:none } }",
  "@media screen { @import url(x.css); body { color: red } }",
  ".a { width: expression(alert(1)) }",
  ".a { behavior: url(x.htc) }",
  ".a { -moz-binding: url(x.xml#y) }",
  ".a { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh }",
  ".a { position: sticky }",
  ".a { z-index: 99999 }",
  ".a { color: red }} body { display: none }",
  ".a { color: red } } } :root { display: none }",
  ".a { color: red; body & { display: none } }",
  ".a { color: red; :root { display: none } }",
  "</style><script>alert(1)</script>",
  ".a { background: url(x) } ;}{ html { display:none }",
  ".a { font-family: \"x\\\"; } body { display:none } .b{\" }",
  ".a{color:red}/* unterminated",
  ".a{content:'unterminated}",
  "@media (min-width:1px){ .a{color:red}",
  ".a{background-image:url(/ok.png),url(https://evil.example/x)}",
  ".a{--x: url(https://evil.example/x); background-image: var(--x)}",
  ".a{filter:url(https://evil.example/f.svg#x)}",
  ".a{cursor:url(https://evil.example/c.cur),auto}",
  ".a{background:paint(x)}",
  ".a{background:element(#site-header)}",
  "html, body, :root, * { display:none }",
  ".a:is(body *) { color: red }",
  "@media (min-width: 1px) and (max-width:2px) { @media screen { .a { color: red } } }",
  "@-webkit-keyframes x { from { opacity: 0 } }",
  "@keyframes x { from { position: fixed; z-index: 9 } }",
  "\\@import url(x.css);",
  "@\\69mport url(https://evil.example/x.css);",
  ".a{background:\\75rl(https://evil.example/x)}",
];

test("the hostile corpus never escapes the sandbox", () => {
  for (const css of HOSTILE) {
    const out = scopeProfileCss(css);
    assertSandboxed(out);
    assert.doesNotMatch(out, /evil|expression|behavior|binding|@import|z-index|position|<\/style|<script/i, css + " -> " + out);
  }
});

test("unterminated comments and strings still fail closed to an empty sheet", () => {
  assert.equal(scopeProfileCss(".a{color:red}/* unterminated"), "");
  assert.equal(scopeProfileCss(".a{content:'unterminated}"), "");
  assert.equal(scopeProfileCss(""), "");
  assert.equal(scopeProfileCss(null), "");
});

test("unknown properties are dropped, cosmetic ones are kept", () => {
  const out = scopeProfileCss(".a { color: red; pointer-events: none; content: 'x'; border-radius: 4px }");
  assert.match(out, /color:red/);
  assert.match(out, /border-radius:4px/);
  assert.doesNotMatch(out, /pointer-events|content/);
});

test("fuzz: arbitrary text and css-shaped noise always yield a sandboxed sheet", () => {
  const atoms = fc.constantFrom(
    "{", "}", ";", ":", "(", ")", "'", "\"", "\\", "/*", "*/", "@import ", "@media ", "@keyframes k",
    "url(", "https://evil.example", "//", "body", ".a", ",", " ", "color", "red", "position", "fixed",
    "z-index", "9", "expression(", "&", ":root", "<", "!important", "\n",
  );
  fc.assert(fc.property(fc.array(atoms, { maxLength: 40 }), (parts) => {
    assertSandboxed(scopeProfileCss(parts.join("")));
  }), { numRuns: 400, seed: 20261122 });
  fc.assert(fc.property(fc.string({ maxLength: 200 }), (text) => {
    assertSandboxed(scopeProfileCss(text));
  }), { numRuns: 300, seed: 1122 });
});
