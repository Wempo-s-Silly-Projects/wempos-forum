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

// Theme preference for the forum: a manual choice stored in localStorage
// under "forum-theme" ("dark" | "light") always beats the OS preference;
// with no valid manual choice the OS `prefers-color-scheme` decides.
// styles.css consumes the result as a `data-theme` attribute on <html> and
// index.html loads theme-preload.js before styles.css; the same-origin script complies with CSP.

export const THEME_STORAGE_KEY = "forum-theme";
// Stored when the chosen look matches the OS: not dark/light, so the OS decides.
export const THEME_FOLLOW_OS = "system";

export function resolveTheme(preference, prefersDark) {
  if (preference === "dark" || preference === "light") return preference;
  return prefersDark ? "dark" : "light";
}

function readPreference(storage) {
  try {
    return storage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (privacy modes); fall back to the OS look.
    return null;
  }
}

function readOsPreference(doc) {
  const view = doc.defaultView;
  return view !== null && !!view.matchMedia("(prefers-color-scheme: dark)").matches; // i18n-ignore
}

import { t } from "./i18n.js";
import { createIcon } from "./icons.js";
import { rethemeTurnstile } from "./turnstile.js";
import { EVENTS, bus } from "./event-bus.js";

// Corners (v2.5): "round" is the default; the account-settings checkbox
// flips the appearance pref. Same client-side persistence as the theme.
export function applyCornerPreference(doc, storage) {
  let corners;
  try {
    corners = storage.getItem("forum-corners") === "square" ? "square" : "round";
  } catch {
    corners = "round";
  }
  doc.documentElement.dataset.corners = corners;
}

export function initTheme(doc, storage) {
  const root = doc.documentElement;

  // Browser chrome (v4.0): the phone's address/status bar follows the
  // EFFECTIVE theme, not just the OS preference — a manual dark choice on a
  // light-OS phone must not paint the chrome light. The two media-scoped
  // <meta theme-color> tags in index.html carry the colors; rewriting their
  // content keeps one source of truth.
  const BROWSER_CHROME_COLORS = { light: "#f7efdc", dark: "#131b27" };
  const applyBrowserChromeColor = (theme) => {
    const color = BROWSER_CHROME_COLORS[theme];
    if (!color) return;
    for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
      meta.content = color;
    }
  };

  const announceNextMode = (theme) => {
    const toggle = doc.querySelector("#theme-toggle");
    if (toggle) {
      // The label announces the action the NEXT click performs; the icon
      // reflects the CURRENT mode — sun in light, moon in dark (owner spec).
      toggle.setAttribute(
        "aria-label",
        theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark"),
      );
      toggle.replaceChildren(createIcon(doc, theme === "dark" ? "moon" : "sun"));
      toggle.title = theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark");
      rethemeTurnstile();
    }
  };

  const theme = resolveTheme(readPreference(storage), readOsPreference(doc));
  root.dataset.theme = theme;
  announceNextMode(theme);
  applyBrowserChromeColor(theme);

  const show = (next) => {
    root.dataset.theme = next;
    announceNextMode(next);
    applyBrowserChromeColor(next);
  };
  // Batch K: a choice made in another tab (already stored there) applies
  // here too; tab-sync.js only delivers "light" or "dark".
  bus.on(EVENTS.remoteTheme, show);

  doc.querySelector("#theme-toggle")?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    show(next);
    bus.emit(EVENTS.theme, next);
    // Two-state (v5.71.1): clicking back to the OS look stops storing a
    // manual choice, so the forum follows the OS again. The key is
    // overwritten, never removed (wave 5.6: device prefs are never removed);
    // resolveTheme and theme-preload.js ignore anything but dark/light.
    const osTheme = readOsPreference(doc) ? "dark" : "light";
    try {
      storage.setItem(THEME_STORAGE_KEY, next === osTheme ? THEME_FOLLOW_OS : next);
    } catch {
      // Persistence is best-effort; the choice still applies to this page.
    }
  });
}
