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

// DOMPurify as the final defence-in-depth pass (Batch C). The post renderer
// itself never parses member markup (every character lands via textContent);
// DOMPurify runs over what the vendored libraries hand back from member text:
// Mermaid's SVG string, ansi_up's HTML string, and the KaTeX / JSON-tree DOM
// they build. Every config here only narrows DOMPurify's defaults, so it can
// never loosen the renderer's own allow-list. DOMPurify is vendored at
// public/js/vendor/purify.min.js and loaded only when one of those runs.
import { loadScriptOnce } from "./vendor-loader.js";

export const PURIFY_SRC = "/js/vendor/purify.min.js";

const deepFreeze = (value) => {
  for (const inner of Object.values(value)) if (inner && typeof inner === "object") deepFreeze(inner);
  return Object.freeze(value);
};

// Mermaid output: SVG only. No foreignObject (HTML labels), no links, no
// external images or <use> references, no scripts; <style> is kept only so
// mermaidSvgParts can lift its text out before the SVG is ever connected.
export const SVG_PURIFY_CONFIG = deepFreeze({
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["foreignObject", "script", "a", "image", "use", "iframe", "object", "embed", "animate", "set"],
  FORBID_ATTR: ["href", "xlink:href"],
  ALLOW_DATA_ATTR: false,
});

// ansi_up output: plain spans with colour classes (and its own bold/rgb
// style strings, which moveInlineStyles applies through CSSOM).
export const ANSI_PURIFY_CONFIG = deepFreeze({
  ALLOWED_TAGS: ["span"],
  ALLOWED_ATTR: ["class", "style"],
  ALLOW_DATA_ATTR: false,
});

// In place over DOM a library built (KaTeX, the JSON tree).
export const INPLACE_PURIFY_CONFIG = deepFreeze({
  IN_PLACE: true,
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "form", "input", "textarea", "button", "link",
    "meta", "base"],
  ALLOW_DATA_ATTR: false,
});

export function loadPurify(document) {
  return loadScriptOnce(document, PURIFY_SRC, () => globalThis.DOMPurify);
}

// A DocumentFragment of the sanitised markup (never assigned as innerHTML).
export function purifyToFragment(purify, html, config) {
  return purify.sanitize(String(html ?? ""), { ...config, RETURN_DOM_FRAGMENT: true });
}

export function purifyInPlace(purify, node) {
  if (!purify || typeof purify.sanitize !== "function" || !node) return;
  purify.sanitize(node, { ...INPLACE_PURIFY_CONFIG });
}

// The CSP's style-src 'self' (no 'unsafe-inline') refuses style attributes
// that arrive as markup, but not CSSOM writes. Library output that relies on
// inline styles (Mermaid, ansi_up's bold/rgb) is moved across before it is
// shown, so the page never needs 'unsafe-inline'.
export function moveInlineStyles(root) {
  if (!root) return;
  const styled = typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll("[style]")) : [];
  if (typeof root.hasAttribute === "function" && root.hasAttribute("style")) styled.unshift(root);
  for (const node of styled) {
    const css = node.getAttribute("style") ?? "";
    node.removeAttribute("style");
    if (node.style) node.style.cssText = css;
  }
}
