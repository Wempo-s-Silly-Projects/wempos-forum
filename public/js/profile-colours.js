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

// Batch I item 2: member colours get a WCAG contrast check. colord + its a11y
// plugin (MIT, vendored verbatim) do the relative-luminance maths:
//   - the profile accent colours text on the paper, so it is checked against
//     the light AND the dark theme's paper;
//   - the banner colour sits under white banner text, so it is checked
//     against white.
// A failing colour shows a warning (never a block: the member decides) with
// a one-click suggestion — the same hue darkened or lightened just enough to
// pass the failing theme. Coloris (MIT, vendored verbatim) is the picker on
// both fields; it loads lazily, same-origin, only on the member's own editor.
import { colord, extend } from "./vendor/colord.mjs";
import a11yPlugin from "./vendor/colord-a11y.mjs";
import { t } from "./i18n.js";

extend([a11yPlugin]);

// Mirrors constants.mjs PROFILE_CONTRAST_MIN (pinned equal by the tests).
export const PROFILE_CONTRAST_MIN = 4.5;
// The --paper token of each theme in styles.css (pinned by the tests).
export const THEME_SURFACES = Object.freeze({ light: "#fffaf0", dark: "#1d2836" });
const BANNER_TEXT = "#ffffff";
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FIX_STEP = 0.02;
const FIX_MAX_STEPS = 50;
const LIGHT_SURFACE_LUMINANCE = 0.5;
const COLORIS_SCRIPT = "./vendor/coloris.min.js";
const COLORIS_STYLESHEET = "/js/vendor/coloris.min.css";
const COLOUR_FIELD_CLASS = "profile2-colour-field";

export const contrastRatio = (foreground, background) => colord(foreground).contrast(background);

const parseHex = (value) => (typeof value === "string" && HEX_COLOUR.test(value.trim()) ? value.trim() : null);

// The colour itself when it already passes; otherwise the nearest step of the
// same hue (darker on a light surface, lighter on a dark one) that does.
export function suggestContrastFix(hex, background, minimum = PROFILE_CONTRAST_MIN) {
  const start = colord(hex);
  if (start.contrast(background) >= minimum) return start.toHex();
  const darken = colord(background).luminance() > LIGHT_SURFACE_LUMINANCE;
  for (let step = 1; step <= FIX_MAX_STEPS; step += 1) {
    const candidate = darken ? start.darken(FIX_STEP * step) : start.lighten(FIX_STEP * step);
    if (candidate.contrast(background) >= minimum) return candidate.toHex();
  }
  return darken ? "#000000" : "#ffffff";
}

const themeCheck = (hex, surface) => {
  const ratio = contrastRatio(hex, surface);
  return { ratio, ok: ratio >= PROFILE_CONTRAST_MIN };
};

// { light, dark, failing, suggestion } for an accent, or null when the value
// is not a colour (an empty field clears the accent: nothing to check).
export function accentContrastReport(value) {
  const hex = parseHex(value);
  if (!hex) return null;
  const light = themeCheck(hex, THEME_SURFACES.light);
  const dark = themeCheck(hex, THEME_SURFACES.dark);
  const failing = !light.ok ? "light" : !dark.ok ? "dark" : null;
  const suggestion = failing ? suggestContrastFix(hex, THEME_SURFACES[failing]) : null;
  return { light, dark, failing, suggestion };
}

// { ratio, ok, suggestion } for a banner colour under white text, or null.
export function bannerContrastReport(value) {
  const hex = parseHex(value);
  if (!hex) return null;
  const { ratio, ok } = themeCheck(hex, BANNER_TEXT);
  return { ratio, ok, suggestion: ok ? null : suggestContrastFix(hex, BANNER_TEXT) };
}

const formatRatio = (ratio) => String(Math.round(ratio * 10) / 10);

// The warning sentence for a report, or "" when the colour passes.
export function contrastMessage(kind, report) {
  if (!report) return "";
  if (kind === "banner") {
    return report.ok ? "" : t("profile2.contrastBanner", { ratio: formatRatio(report.ratio) });
  }
  if (!report.failing) return "";
  const key = report.failing === "light" ? "profile2.contrastLight" : "profile2.contrastDark";
  return t(key, { ratio: formatRatio(report[report.failing].ratio) });
}

const reportFor = (kind, value) => (kind === "banner" ? bannerContrastReport(value) : accentContrastReport(value));

// A live note under one colour input: the warning plus a "Use #xxxxxx"
// button that writes the suggestion back and fires input + change (the
// accent's change handler saves it; the banner field saves with its form).
export function attachContrastWarning(input, kind) {
  const document = input.ownerDocument;
  const note = document.createElement("p");
  note.className = "profile2-contrast-note";
  note.setAttribute("role", "status");
  const text = document.createElement("span");
  const fix = document.createElement("button");
  fix.type = "button";
  fix.className = "profile2-contrast-fix";
  note.append(text, fix);
  const refresh = () => {
    const report = reportFor(kind, input.value);
    const message = contrastMessage(kind, report);
    text.textContent = message;
    note.hidden = !message;
    fix.hidden = !message || !report.suggestion;
    if (report && report.suggestion) {
      fix.textContent = t("profile2.contrastUse", { color: report.suggestion });
      fix.dataset.colour = report.suggestion;
    }
  };
  fix.addEventListener("click", () => {
    if (!fix.dataset.colour) return;
    const EventType = document.defaultView?.Event ?? globalThis.Event;
    input.value = fix.dataset.colour;
    input.dispatchEvent(new EventType("input", { bubbles: true }));
    input.dispatchEvent(new EventType("change", { bubbles: true }));
  });
  input.addEventListener("input", refresh);
  input.addEventListener("change", refresh);
  input.after(note);
  refresh();
  return note;
}

let colorisLoading = null;

// Coloris loads once per page: its stylesheet as a same-origin <link>
// (style-src 'self'), its module by dynamic import (script-src 'self').
function loadColoris(document) {
  colorisLoading ??= (async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = COLORIS_STYLESHEET;
    document.head.append(link);
    const module = await import(COLORIS_SCRIPT);
    return module.default;
  })();
  return colorisLoading;
}

function colorisOptions() {
  return {
    el: "." + COLOUR_FIELD_CLASS,
    alpha: false,
    format: "hex",
    themeMode: "auto",
    clearButton: true,
    clearLabel: t("profile2.pickerClear"),
    closeButton: true,
    closeLabel: t("common.close"),
    a11y: { open: t("profile2.pickerOpen"), close: t("common.close"), clear: t("profile2.pickerClear") },
  };
}

// Wires the editor's colour fields: contrast notes always; the Coloris
// picker when it loads (a typed hex keeps working if it never does).
export function enhanceProfileColours(root, { loadPicker = loadColoris } = {}) {
  const fields = [
    [root.querySelector("#profile-banner-color"), "banner"],
    [root.querySelector(".accent-color-input"), "accent"],
  ].filter(([input]) => input);
  for (const [input, kind] of fields) {
    input.classList.add(COLOUR_FIELD_CLASS);
    attachContrastWarning(input, kind);
  }
  if (!fields.length) return Promise.resolve(false);
  return loadPicker(root.ownerDocument).then((coloris) => {
    if (typeof coloris !== "function") return false;
    coloris(colorisOptions());
    return true;
  }, () => false);
}
