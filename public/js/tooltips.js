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

// Badge tooltips (Batch J): the role chips ("New", "You", "QOTD", the
// thread-starter chip) explain themselves in a tooltip placed by the
// vendored Floating UI (MIT), which flips and shifts it so it is never
// clipped by the viewport. Unlike the native title it shows on keyboard
// focus too (the chip becomes focusable), is tied to the chip with
// aria-describedby, stays while the pointer moves onto it, and Esc hides it
// (WCAG 1.4.13). Text only (textContent); nothing is fetched or stored.
import { loadVendorScripts } from "./vendor-load.js";

export const TOOLTIP_SELECTOR = ".role-badge[title], [data-tooltip]";
export const FLOATING_SOURCES = Object.freeze([
  "/js/vendor/floating-ui.core.umd.min.js",
  "/js/vendor/floating-ui.dom.umd.min.js",
]);
const TOOLTIP_GAP_PX = 6;
const VIEWPORT_PADDING_PX = 8;
const HIDE_DELAY_MS = 120;

let tooltipCount = 0;
const open = new Map();

// Moves a native title into data-tooltip (so two tooltips never stack) and
// makes the chip reachable by keyboard. Idempotent.
export function prepareTooltipTrigger(trigger) {
  const title = trigger.getAttribute("title");
  if (title) {
    trigger.setAttribute("data-tooltip", title);
    trigger.removeAttribute("title");
  }
  if (!trigger.hasAttribute("tabindex") && trigger.tagName !== "BUTTON" && trigger.tagName !== "A") {
    trigger.setAttribute("tabindex", "0");
  }
  return trigger;
}

// Every tooltip chip already on the page under `root` (run after a route
// renders, so keyboard users can tab to chips they have not hovered).
export function prepareTooltips(root) {
  root?.querySelectorAll?.(TOOLTIP_SELECTOR)?.forEach((trigger) => prepareTooltipTrigger(trigger));
}

const loadFloating = () => loadVendorScripts(globalThis.document, FLOATING_SOURCES, () => globalThis.FloatingUIDOM);

async function floatingPosition(trigger, tip) {
  const { computePosition, flip, offset, shift } = await loadFloating();
  const { x, y } = await computePosition(trigger, tip, {
    placement: "top",
    strategy: "fixed",
    middleware: [offset(TOOLTIP_GAP_PX), flip(), shift({ padding: VIEWPORT_PADDING_PX })],
  });
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

export function hideTooltip(trigger) {
  const entry = open.get(trigger);
  if (!entry) return;
  clearTimeout(entry.timer);
  open.delete(trigger);
  trigger.removeAttribute("aria-describedby");
  entry.tip.remove();
}

export async function showTooltip(document, trigger, { position = floatingPosition } = {}) {
  prepareTooltipTrigger(trigger);
  const existing = open.get(trigger);
  if (existing) {
    clearTimeout(existing.timer);
    return existing.tip;
  }
  const text = trigger.getAttribute("data-tooltip");
  if (!text) return null;
  tooltipCount += 1;
  const tip = document.createElement("div");
  tip.className = "forum-tooltip";
  tip.id = "forum-tooltip-" + tooltipCount;
  tip.setAttribute("role", "tooltip");
  tip.textContent = text;
  document.body.append(tip);
  trigger.setAttribute("aria-describedby", tip.id);
  const entry = { tip, timer: null };
  open.set(trigger, entry);
  tip.addEventListener("pointerenter", () => clearTimeout(entry.timer));
  tip.addEventListener("pointerleave", () => scheduleHide(trigger));
  try {
    await position(trigger, tip);
  } catch {
    // Floating UI failed to load: the tooltip still shows, unplaced by CSS.
  }
  return tip;
}

function scheduleHide(trigger) {
  const entry = open.get(trigger);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => hideTooltip(trigger), HIDE_DELAY_MS);
}

const triggerOf = (event) => event.target?.closest?.(TOOLTIP_SELECTOR) ?? null;

// One set of delegated listeners for the whole page, so chips rendered
// later (feeds, threads, profiles) need no wiring of their own.
export function initTooltips(document) {
  const show = (event) => {
    const trigger = triggerOf(event);
    if (trigger) showTooltip(document, trigger);
  };
  const hide = (event) => {
    const trigger = triggerOf(event);
    if (trigger) scheduleHide(trigger);
  };
  document.addEventListener("pointerover", show);
  document.addEventListener("focusin", show);
  document.addEventListener("pointerout", hide);
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || open.size === 0) return;
    for (const trigger of [...open.keys()]) hideTooltip(trigger);
  });
}
