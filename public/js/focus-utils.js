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

// Focus helpers (wave 2026-11-21-7 a11y pass). Two jobs:
// 1. Full repaints (the chat conversation's 5s poll) rebuild every node, so
//    the focused control is recorded by its class before the repaint and
//    re-focused after it, so keyboard users are not thrown to <body>.
// 2. "Jump to" buttons move keyboard focus, not just the view, and honor
//    prefers-reduced-motion (explicit smooth scrolls bypass the CSS guard).
// No DOM access at import time, so node tests can load it.

const CLASS_TOKEN = /^[a-z][a-z0-9-]*$/;

export function prefersReducedMotion(win = globalThis) {
  return win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; // i18n-ignore
}

// The focused control inside `root` as {selector, start, end}, or null.
// The first class token that is not a shared "button*" style class names it.
export function focusSelector(root, active) {
  if (!root || !active || active === root || typeof root.contains !== "function") return null;
  if (!root.contains(active)) return null;
  const token = String(active.className ?? "").split(/\s+/)
    .find((name) => CLASS_TOKEN.test(name) && !name.startsWith("button"));
  if (!token) return null;
  const caret = typeof active.selectionStart === "number"
    ? { start: active.selectionStart, end: active.selectionEnd }
    : {};
  return { selector: "." + token, ...caret };
}

export function restoreFocus(root, kept) {
  if (!root || !kept?.selector || typeof root.querySelector !== "function") return;
  const target = root.querySelector(kept.selector);
  if (!target || target.disabled || typeof target.focus !== "function") return;
  target.focus();
  if (typeof kept.start === "number" && typeof target.setSelectionRange === "function") {
    target.setSelectionRange(kept.start, kept.end);
  }
}

// Scrolls to `node` (smooth unless reduced motion) and moves focus there;
// a non-focusable target gets tabindex=-1 first so focus() takes.
export function jumpToNode(node, { block = "start", reducedMotion = prefersReducedMotion() } = {}) {
  if (!node) return;
  if (!node.hasAttribute?.("tabindex")) node.setAttribute?.("tabindex", "-1");
  node.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block });
  node.focus?.({ preventScroll: true });
}

// After a full route repaint (main.replaceChildren) the focused control is
// gone and focus falls to <body>; this lands it on the page's h1 instead
// (wave 22 a11y: mod desk restore / hide-recent).
export function focusPageHeading(root, options = {}) {
  jumpToNode(root?.querySelector?.("h1") ?? null, { block: "start", ...options });
}

// Safari reports the keydown that commits an IME candidate with
// isComposing false but keyCode 229, so both signals count.
const IME_PROCESS_KEY_CODE = 229;

// True while a keydown belongs to IME composition (Japanese, Chinese, Korean
// input): an Enter there confirms a candidate and must not send or pick.
export function isImeComposing(event) {
  return Boolean(event) && (event.isComposing === true || event.keyCode === IME_PROCESS_KEY_CODE);
}
