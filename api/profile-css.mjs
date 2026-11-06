// v4.0 plan 3, Task 1: the custom-profile-CSS sandbox — the submit/serve
// routes for profile styles live in api/profile-css.mjs, and this family is
// the pure string pipeline they (and the profile read) share. Moved verbatim
// out of shared.mjs (deleted in the final sweep); imports nothing (a true
// leaf, like core/).
//
// Custom profile CSS (v2.5): the sandbox. Mods approve the TEXT, and at serve
// time the raw CSS is re-scoped before it ever reaches a page:
//   1. Every rule's selectors are prefixed with .profile-theme-scope (a
//      per-profile container class), so nothing can escape its container.
//   2. An @-block pass-through keeps @media/@keyframes working; @import and
//      any other at-rule are dropped (url/resource smuggling surface).
//   3. A blocklist strips the properties that could escape or hijack: any
//      fixed positioning, z-index above 1, and everything the whitelist
//      doesn't recognize as a cosmetic property (allow-list, not block-list:
//      unknown properties are dropped — browsers ignore them anyway).
// Residual risk is accepted-with-approval: a mod reads the CSS before
// it goes live, and the CSP still gates every url() to same-origin.
// The scanner FAILS CLOSED everywhere the browser's parse could diverge from
// this one (security review): comments strip quote-aware before any
// scanning, comments or strings left unterminated, an unclosed block, or a
// stray brace/escape in selector text all project to "" — the approved text
// stays put for re-review, the serve-time sheet serves nothing.
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

export const CUSTOM_CSS_MAX_BYTES = 20 * 1024;

// A depth-tracking brace scanner: finds the block whose opening brace is at
// `open` and returns the index just past its MATCHING close (handles nesting
// — @media bodies contain full rule blocks). An unterminated block returns -1
// so the caller can fail closed instead of swallowing the rest as body text.
function blockEnd(text, openAt) {
  let depth = 0;
  let inString = null;
  for (let at = openAt; at < text.length; at++) {
    const ch = text[at];
    if (inString) {
      if (ch === "\\") at += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return inString ? -1 : depth > 0 ? -1 : text.length;
}

// Comment stripping the browser and this scanner CANNOT disagree about
// (review finding): the old scanner only ignored /*...*/ when they happened
// to sit between braces, while the browser strips comments anywhere — "/*"
// hiding inside a selector or a value let each side slice the sheet into
// different blocks, and the browser's slice could escape the sandbox. Quotes
// are tracked here so a comment marker inside a string never opens a
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

// The at-rule's NAME: everything before the first non-name char (space,
// paren... — "@media(min-width:1px)" extracts cleanly).
function atRuleName(selectorText) {
  return selectorText.replace(/^\s+/, "").split(/[^@a-zA-Z-]/)[0].toLowerCase();
}

export function scopeProfileCss(rawCss) {
  const scanned = stripCssComments(String(rawCss ?? ""));
  // Fail closed: an unparsable sheet (dangling comment, unterminated string)
  // serves NOTHING — the browser's error recovery is exactly where the
  // parse divergence lived. The approved text stays intact for re-review;
  // only the serve-time projection comes out empty.
  if (scanned === null || !scanned.trim()) return "";
  const sanitizedRules = [];
  let index = 0;
  while (index < scanned.length) {
    const open = scanned.indexOf("{", index);
    if (open === -1) break;
    const close = blockEnd(scanned, open);
    // An unclosed block means the scanner could not mirror the browser's
    // structure — refuse the whole sheet rather than emit a partial slice.
    if (close === -1) return "";
    const selectorText = scanned.slice(index, open).trim();
    // With comments gone, a stray "}" or escape in selector text means the
    // sheet's structure is ambiguous — fail closed too (review finding).
    if (selectorText.includes("}") || selectorText.includes("\\")) return "";
    const bodyText = scanned.slice(open + 1, close);
    index = close + 1;
    if (selectorText.startsWith("@")) {
      const atName = atRuleName(selectorText);
      if (atName === "@media") {
        // Media blocks recurse: scope the INNER rules, keep the condition.
        const condition = selectorText.slice("@media".length).trim();
        // A condition could not smuggle structure (braces) or extra
        // declarations (semicolons) into the emitted sheet.
        if (/[\{};\\]/.test(condition)) continue;
        sanitizedRules.push("@media" + " " + condition + "{" + scopeProfileCss(bodyText) + "}");
      } else if (atName === "@keyframes" || atName === "@-webkit-keyframes") {
        // Keyframes: the inner blocks are step selectors (from/to/percentage
        // — never scoped), and each step's body passes the allow-list.
        const inner = scopeKeyframeBody(bodyText);
        sanitizedRules.push(selectorText + "{" + inner + "}");
      }
      // Everything else (@import, @font-face, @supports…) is dropped.
      continue;
    }
    const scoped = selectorText
      .split(",")
      .map((selector) => ".profile-theme-scope " + selector.trim())
      .join(", ");
    const body = sanitizeDeclarationBody(bodyText);
    if (body) sanitizedRules.push(scoped + "{" + body + "}");
  }
  return sanitizedRules.join("\n");
}

// Keyframe steps: from/to/percentage selectors in, allow-listed properties
// per step. (bodyText is a balanced region by construction — the caller
// scanned it with blockEnd — so the plain indexOf close is safe.)
function scopeKeyframeBody(bodyText) {
  const steps = [];
  let index = 0;
  while (index < bodyText.length) {
    const open = bodyText.indexOf("{", index);
    if (open === -1) break;
    const close = bodyText.indexOf("}", open);
    if (close === -1) break;
    const selector = bodyText.slice(index, open).trim();
    // Step selectors are plain tokens; a stray brace or escape in one means
    // ambiguity — drop the whole keyframes body.
    if (selector.includes("{") || selector.includes("}") || selector.includes("\\")) break;
    steps.push(selector + "{" + sanitizeDeclarationBody(bodyText.slice(open + 1, close)) + "}");
    index = close + 1;
  }
  return steps.join("\n");
}

// Property allow-list for one declaration body; url() survives only for the
// same-origin / static assets path (the CSP gates it further either way).
// Verbatim values carry ONE more admission test now (review finding): a
// value may not contain braces (they could open or close a block in the
// emitted sheet — the old "kept verbatim" path), an unbalanced quote, or an
// unbalanced parenthesis; any such declaration is dropped, not the sheet.
function sanitizeDeclarationBody(body) {
  const kept = [];
  for (const declaration of body.split(";")) {
    const prop = declaration.slice(0, declaration.indexOf(":") > -1 ? declaration.indexOf(":") : 0).trim().toLowerCase();
    const value = declaration.includes(":") ? declaration.slice(declaration.indexOf(":") + 1).trim() : "";
    if (!prop || !value) continue;
    if (prop === "z-index") continue; // stacking hijacks never pass
    if (!isSafeDeclarationValue(value)) continue;
    if (value.toLowerCase().includes("position") && prop === "position" && /(fixed|sticky)/.test(value.toLowerCase())) continue;
    if (!PROFILE_CSS_PROPERTY_ALLOW.has(prop)) continue;
    if (/(javascript:|expression\(|@import)/i.test(value)) continue;
    kept.push(prop + ":" + value);
  }
  return kept.join(";");
}

function isSafeDeclarationValue(value) {
  if (/[{}]/.test(value)) return false;
  let quote = null;
  let parens = 0;
  for (let at = 0; at < value.length; at++) {
    const ch = value[at];
    if (quote) {
      // An escaped unit (\', \\) never closes the string.
      if (ch === "\\") at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") parens += 1;
    else if (ch === ")") {
      parens -= 1;
      if (parens < 0) return false;
    }
  }
  return quote === null && parens === 0;
}
