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

// The newcomer tour (L2 wave), part of the newcomer welcome card
// (newcomer.js): "Take a quick tour" walks through three spots in the page
// shell with Driver.js 1.14.0 (MIT, vendored verbatim as
// public/js/vendor/driver.js.iife.js + driver.css). Both files load
// same-origin on the first press, never before. Driver.js writes popover text
// with innerHTML, so every string handed to it is HTML-escaped here first,
// even though it comes from our own locale tables. Steps whose element is not
// on the page are left out; under reduced motion the tour does not animate.
// Nothing is stored or sent: the welcome card's "Got it" stays the only
// dismissal record.
import { prefersReducedMotion } from "./focus-utils.js";
import { t } from "./i18n.js";
import { loadVendorScripts } from "./vendor-load.js";

export const DRIVER_SCRIPT_SRC = "/js/vendor/driver.js.iife.js";
export const DRIVER_STYLE_HREF = "/js/vendor/driver.css";
export const TOUR_STEPS = Object.freeze([
  Object.freeze({ selector: "#account-actions", key: "newcomer.tourNav" }),
  Object.freeze({ selector: "#site-search", key: "newcomer.tourSearch" }),
  Object.freeze({ selector: "#theme-toggle", key: "newcomer.tourTheme" }),
]);

const HTML_ESCAPES = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });

export const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

const loadDefault = () => loadVendorScripts(globalThis.document, [DRIVER_SCRIPT_SRC], () => globalThis.driver?.js?.driver);

export function tourSteps(document, translate = t) {
  return TOUR_STEPS
    .map(({ selector, key }) => ({ element: document.querySelector(selector), key }))
    .filter((step) => step.element)
    .map(({ element, key }) => ({ element, popover: { description: escapeHtml(translate(key)) } }));
}

function ensureStylesheet(document) {
  if (document.querySelector(`link[href="${DRIVER_STYLE_HREF}"]`)) return;
  const link = document.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", DRIVER_STYLE_HREF);
  document.head.append(link);
}

// Resolves with the running tour, or null when there is nothing to show.
export async function startTour(document, { loadDriver = loadDefault, win = globalThis } = {}) {
  const steps = tourSteps(document);
  if (!steps.length) return null;
  ensureStylesheet(document);
  const driver = await loadDriver();
  const tour = driver({
    steps,
    animate: !prefersReducedMotion(win),
    showProgress: false,
    allowClose: true,
    popoverClass: "forum-tour",
    nextBtnText: escapeHtml(t("common.next")),
    prevBtnText: escapeHtml(t("common.back")),
    doneBtnText: escapeHtml(t("common.done")),
  });
  tour.drive();
  return tour;
}

export function createTourButton(document, options = {}) {
  const button = document.createElement("button");
  button.setAttribute("type", "button");
  button.className = "button button-secondary newcomer-tour";
  button.textContent = t("newcomer.tourStart");
  button.addEventListener("click", () => {
    startTour(document, options).catch(() => {
      // Driver.js did not load: the welcome card is still fully usable.
    });
  });
  return button;
}
