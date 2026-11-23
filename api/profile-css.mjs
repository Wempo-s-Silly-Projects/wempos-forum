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

// The custom-profile-CSS sandbox (v2.5; parser-backed since batch I). Staff
// approve the TEXT (approved_css); at serve time that text is re-projected
// through this module before it ever reaches a page:
//   1. css-tree (MIT, a spec-following CSS parser) builds the syntax tree, so
//      the sandbox sees the same tokens the browser does — escapes such as
//      "u\72l(" or "@\69mport" are tokens, not text to pattern-match.
//   2. The output is GENERATED from an allow-list walk of that tree, never
//      sliced from the input: every rule's selectors are prefixed with
//      .profile-theme-scope (the per-profile container class); only @media
//      (recursing) and @keyframes (renamed into a profile- namespace so a
//      member cannot redefine the site's own animations) survive; every
//      other at-rule (@import, @font-face, @supports, @layer...) is dropped.
//   3. Declarations pass a property allow-list (no position, z-index,
//      behavior, -moz-binding, custom properties...), a function allow-list
//      (no expression(), image-set(), element(), paint(), src()...), and
//      url() survives only as a same-origin path ("/..." — never a scheme,
//      "//host", data: or javascript:).
//   4. Anything the parser could only keep as Raw (its error recovery) is
//      dropped, and the finished sheet must re-parse with zero errors and no
//      Raw node — otherwise the whole sheet serves nothing (fail closed).
// Unterminated comments or strings still fail closed before parsing (the
// browser's error recovery is exactly where a parse divergence would live).
// Residual risk stays accepted-with-approval: staff read the CSS before it
// goes live, and the CSP still gates every url() to same-origin.
import parse from "css-tree/parser";
import generate from "css-tree/generator";
import walk from "css-tree/walker";

const SCOPE_CLASS = "profile-theme-scope";
const KEYFRAMES_PREFIX = "profile-";

const PROFILE_CSS_PROPERTY_ALLOW = new Set([
  "color", "background", "background-color", "background-image", "background-position", "background-size", "background-repeat",
  "border", "border-color", "border-width", "border-style", "border-radius",
  "font", "font-family", "font-size", "font-style", "font-weight",
  "letter-spacing", "line-height", "text-align", "text-transform", "text-decoration", "text-shadow",
  "padding", "padding-left", "padding-right", "padding-top", "padding-bottom",
  "margin", "margin-left", "margin-right", "margin-top", "margin-bottom",
  "width", "height", "max-width", "max-height", "min-width", "min-height",
  "opacity", "transform", "box-shadow", "display", "align-items", "justify-content",
  "flex-direction", "flex-wrap", "gap", "overflow", "overflow-x", "overflow-y",
  "object-fit", "object-position", "filter", "backdrop-filter", "border-bottom", "border-top",
  "border-left", "border-right", "border-bottom-color", "border-top-color",
  "border-left-color", "border-right-color",
]);

// Value functions a cosmetic declaration may use. Anything else (expression,
// image-set, -webkit-image-set, element, paint, src, cross-fade, attr, env,
// an escaped name...) drops the declaration.
const PROFILE_CSS_FUNCTION_ALLOW = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix",
  "calc", "min", "max", "clamp", "var",
  "linear-gradient", "radial-gradient", "conic-gradient",
  "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient",
  "translate", "translatex", "translatey", "translatez", "translate3d",
  "rotate", "rotatex", "rotatey", "rotatez", "rotate3d",
  "scale", "scalex", "scaley", "scalez", "scale3d",
  "skew", "skewx", "skewy", "matrix", "matrix3d", "perspective",
  "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate",
  "invert", "opacity", "saturate", "sepia",
  "fit-content", "minmax", "repeat", "cubic-bezier", "steps",
]);

const KEYFRAME_STEP = /^(?:from|to|\d{1,3}(?:\.\d+)?%)(?:,(?:from|to|\d{1,3}(?:\.\d+)?%))*$/i;
const KEYFRAME_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const SAME_ORIGIN_PATH = /^\/(?!\/)[^\\\s]*$/;
const FORBIDDEN_VALUE_TEXT = /(javascript:|expression\(|@import|[{}<>\\])/i;

export const CUSTOM_CSS_MAX_BYTES = 20 * 1024;

// Comment stripping the browser and this module CANNOT disagree about:
// quotes are tracked so a comment marker inside a string never opens a
// comment, and any UNTERMINATED comment or string fails closed (null: the
// sheet serves nothing) instead of guessing where the browser stops.
function stripCssComments(text) {
  let out = "";
  let at = 0;
  let quote = null;
  while (at < text.length) {
    const ch = text[at];
    if (quote) {
      if (ch === "\\") {
        out += ch + (text[at + 1] ?? "");
        at += 2;
        continue;
      }
      if (ch === quote) quote = null;
      out += ch;
      at += 1;
      continue;
    }
    if (ch === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2);
      if (end === -1) return null;
      out += " "; // a comment is one space: token separation survives
      at = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    out += ch;
    at += 1;
  }
  if (quote) return null;
  return out;
}

const parseCss = (text, onError) =>
  parse(text, { parseValue: true, parseCustomProperty: false, parseAtrulePrelude: true, onParseError: onError });

const hasNodeType = (node, type) => {
  let found = false;
  walk(node, (inner) => {
    if (inner.type === type) found = true;
  });
  return found;
};

const childrenOf = (node) => (node && node.children ? node.children.toArray() : []);

function isSafeValueNode(value) {
  if (!value || value.type !== "Value") return false;
  let safe = true;
  walk(value, (node) => {
    if (node.type === "Raw") safe = false;
    else if (node.type === "Url" && !SAME_ORIGIN_PATH.test(node.value)) safe = false;
    else if (node.type === "Function" && !PROFILE_CSS_FUNCTION_ALLOW.has(node.name.toLowerCase())) safe = false;
  });
  return safe;
}

// One declaration in, its generated text (or null to drop it) out.
function sanitizeDeclaration(node) {
  if (node.type !== "Declaration") return null;
  const property = node.property.toLowerCase();
  if (!PROFILE_CSS_PROPERTY_ALLOW.has(property)) return null;
  if (!isSafeValueNode(node.value)) return null;
  const valueText = generate(node.value);
  if (!valueText.trim() || FORBIDDEN_VALUE_TEXT.test(valueText)) return null;
  return property + ":" + valueText + (node.important ? "!important" : "");
}

// Declarations only: nested rules (CSS nesting: "body & {...}") and any Raw
// recovery inside a block are dropped.
function sanitizeBlock(block) {
  return childrenOf(block).map(sanitizeDeclaration).filter(Boolean).join(";");
}

function scopeSelectorList(prelude) {
  if (!prelude || prelude.type !== "SelectorList") return [];
  return childrenOf(prelude).flatMap((selector) => {
    const parts = childrenOf(selector);
    if (!parts.length || parts[0].type === "Combinator") return [];
    if (hasNodeType(selector, "Raw") || hasNodeType(selector, "NestingSelector")) return [];
    return ["." + SCOPE_CLASS + " " + generate(selector)];
  });
}

function sanitizeRule(node) {
  const selectors = scopeSelectorList(node.prelude);
  const body = sanitizeBlock(node.block);
  return selectors.length && body ? selectors.join(",") + "{" + body + "}" : "";
}

function sanitizeKeyframes(node) {
  const names = childrenOf(node.prelude);
  if (names.length !== 1 || names[0].type !== "Identifier" || !KEYFRAME_NAME.test(names[0].name)) return "";
  const steps = childrenOf(node.block).flatMap((step) => {
    if (step.type !== "Rule" || hasNodeType(step.prelude, "Raw")) return [];
    const selector = generate(step.prelude);
    if (!KEYFRAME_STEP.test(selector)) return [];
    return [selector + "{" + sanitizeBlock(step.block) + "}"];
  });
  return "@keyframes " + KEYFRAMES_PREFIX + names[0].name + "{" + steps.join("") + "}";
}

function sanitizeMedia(node) {
  if (!node.prelude || !node.block || hasNodeType(node.prelude, "Raw")) return "";
  const condition = generate(node.prelude);
  if (!condition.trim() || /[{};\\]/.test(condition)) return "";
  const inner = sanitizeRuleList(node.block).join("");
  return inner ? "@media " + condition + "{" + inner + "}" : "";
}

function sanitizeNode(node) {
  if (node.type === "Rule") return sanitizeRule(node);
  if (node.type !== "Atrule") return "";
  const name = node.name.toLowerCase();
  if (name === "media") return sanitizeMedia(node);
  if (name === "keyframes" || name === "-webkit-keyframes") return node.block ? sanitizeKeyframes(node) : "";
  return ""; // @import, @font-face, @supports, @layer, @namespace... dropped
}

function sanitizeRuleList(container) {
  return childrenOf(container).map(sanitizeNode).filter(Boolean);
}

// The finished sheet must stand on its own: zero parse errors, no Raw node.
function reparsesCleanly(css) {
  let clean = true;
  const ast = parseCss(css, () => {
    clean = false;
  });
  return clean && !hasNodeType(ast, "Raw");
}

export function scopeProfileCss(rawCss) {
  const scanned = stripCssComments(String(rawCss ?? ""));
  if (scanned === null || !scanned.trim()) return "";
  let ast;
  try {
    ast = parseCss(scanned, () => {
      // Recovery regions surface as Raw nodes, which the walk drops.
    });
  } catch {
    return "";
  }
  const output = sanitizeRuleList(ast).join("\n");
  if (!output) return "";
  return reparsesCleanly(output) ? output : "";
}
