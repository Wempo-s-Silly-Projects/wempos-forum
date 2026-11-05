// v4.0 plan 3, Task 1: the custom-profile-CSS sandbox leaves shared.mjs for
// api/profile-css.mjs (its own topic module — the whole family is a pure
// string pipeline with zero imports). These tests pin the module surface AND
// the sandbox's security contract: scoping prefix on every rule, allow-list
// drops unknown properties, z-index never passes, fixed/sticky position never
// passes, @import/at-rules other than @media/@keyframes are dropped,
// url(javascript:) fails the declaration, and @media recurses scoped while
// @keyframes keeps unscoped step selectors.
import test from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_CSS_MAX_BYTES, scopeProfileCss } from "../api/profile-css.mjs";

test("profile-css.mjs exports the sandbox surface", () => {
  assert.equal(typeof scopeProfileCss, "function");
  assert.equal(CUSTOM_CSS_MAX_BYTES, 20 * 1024);
});

test("every rule is scoped under .profile-theme-scope", () => {
  assert.equal(
    scopeProfileCss("h1 { color: red; } p, a { color: blue; }"),
    ".profile-theme-scope h1{color:red}\n.profile-theme-scope p, .profile-theme-scope a{color:blue}",
  );
});

test("the allow-list drops unknown properties; z-index and fixed positioning never pass", () => {
  assert.equal(scopeProfileCss("div { color: red; z-index: 999; position: fixed; clip-path: circle(1px); }"),
    ".profile-theme-scope div{color:red}");
  // sticky position and all-unknown bodies: the whole rule drops (empty body
  // never pushes).
  assert.equal(scopeProfileCss("div { position: sticky; top: 0; }"), "");
});

test("at-rules: @media recurses scoped, @keyframes keep step selectors, everything else drops", () => {
  assert.equal(
    scopeProfileCss("@media (min-width: 1px) { h2 { color: red; } }"),
    // The push builds "@media" + " " + condition(trimmed) + "{" + inner + "}"
    // — no space before the brace, no newline inside the joined block.
    "@media (min-width: 1px){.profile-theme-scope h2{color:red}}",
  );
  assert.equal(
    scopeProfileCss("@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"),
    "@keyframes spin{from{transform:rotate(0deg)}\nto{transform:rotate(360deg)}}",
  );
  // @font-face (and @import, and every other at-rule) drops; the rule after
  // it still scopes. @supports drops WITH its body — nothing inside leaks.
  assert.equal(scopeProfileCss("@font-face { font-family: X; } p { color: red; }"),
    ".profile-theme-scope p{color:red}");
  assert.equal(scopeProfileCss("@supports (display: grid) { p { color: red; } }"), "");
});

test("dangerous declaration values fail", () => {
  assert.equal(scopeProfileCss("p { color: red; background-image: javascript:alert(1); }"),
    ".profile-theme-scope p{color:red}");
});
