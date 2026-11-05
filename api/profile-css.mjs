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
// — @media bodies contain full rule blocks).
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
  return text.length;
}

// The at-rule's NAME: everything before the first non-name char (space,
// paren... — "@media(min-width:1px)" extracts cleanly).
function atRuleName(selectorText) {
  return selectorText.replace(/^\s+/, "").split(/[^@a-zA-Z-]/)[0].toLowerCase();
}

export function scopeProfileCss(rawCss) {
  const text = String(rawCss ?? "");
  if (!text.trim()) return "";
  const sanitizedRules = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open === -1) break;
    const close = blockEnd(text, open);
    const selectorText = text.slice(index, open).trim();
    const bodyText = text.slice(open + 1, close);
    index = close + 1;
    if (selectorText.startsWith("@")) {
      const atName = atRuleName(selectorText);
      if (atName === "@media") {
        // Media blocks recurse: scope the INNER rules, keep the condition.
        const condition = selectorText.slice("@media".length).trim();
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
// per step.
function scopeKeyframeBody(bodyText) {
  const steps = [];
  let index = 0;
  while (index < bodyText.length) {
    const open = bodyText.indexOf("{", index);
    if (open === -1) break;
    const close = bodyText.indexOf("}", open);
    if (close === -1) break;
    const selector = bodyText.slice(index, open).trim();
    steps.push(selector + "{" + sanitizeDeclarationBody(bodyText.slice(open + 1, close)) + "}");
    index = close + 1;
  }
  return steps.join("\n");
}

// Property allow-list for one declaration body; url() survives only for the
// same-origin / static assets path (the CSP gates it further either way).
function sanitizeDeclarationBody(body) {
  const kept = [];
  for (const declaration of body.split(";")) {
    const prop = declaration.slice(0, declaration.indexOf(":") > -1 ? declaration.indexOf(":") : 0).trim().toLowerCase();
    const value = declaration.includes(":") ? declaration.slice(declaration.indexOf(":") + 1).trim() : "";
    if (!prop || !value) continue;
    if (prop === "z-index") continue; // stacking hijacks never pass
    if (value.toLowerCase().includes("position") && prop === "position" && /(fixed|sticky)/.test(value.toLowerCase())) continue;
    if (!PROFILE_CSS_PROPERTY_ALLOW.has(prop)) continue;
    if (/(javascript:|expression\(|@import)/i.test(value)) continue;
    kept.push(prop + ":" + value);
  }
  return kept.join(";");
}
