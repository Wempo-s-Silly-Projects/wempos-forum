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

// Apply a saved theme before styles.css paints. This same-origin script is
// allowed by the forum's strict script-src Content Security Policy.
let storedTheme = null;
try {
  storedTheme = localStorage.getItem("forum-theme");
} catch {
  // Storage can be blocked; CSS prefers-color-scheme remains the fallback.
}
if (storedTheme === "dark" || storedTheme === "light") {
  document.documentElement.dataset.theme = storedTheme;
}
// Reader text size (wave 2026-11-21-4): same early apply, same fallback.
let storedTextSize = null;
try {
  storedTextSize = localStorage.getItem("forum-text-size");
} catch {
  // Blocked storage: the default size.
}
if (storedTextSize === "large" || storedTextSize === "larger") {
  document.documentElement.dataset.textSize = storedTextSize;
}
// Reading comfort + high contrast (wave 5.27): painted here, before first
// paint, like the text size. Normal spacing and links-as-styled need no
// attribute; data-contrast always records the mode (default Auto).
{
  const readPref = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // Blocked storage: the default.
    }
  };
  const storedLineSpacing = readPref("forum-line-spacing");
  if (storedLineSpacing === "relaxed" || storedLineSpacing === "spacious") {
    document.documentElement.dataset.lineSpacing = storedLineSpacing;
  }
  if (readPref("forum-link-underline") === "on") {
    document.documentElement.dataset.linkUnderline = "on";
  }
  // Easy-reading spacing (v5.40.0): a class, only for an exact "on".
  if (readPref("forum-easy-reading") === "on") {
    document.documentElement.classList.add("easy-reading");
  }
  let moreContrastQuery = null;
  try {
    moreContrastQuery = typeof matchMedia === "function" ? matchMedia("(prefers-contrast: more)") : null; // i18n-ignore
  } catch {
    // No media queries: Auto means off.
  }
  const paintContrast = (deviceWantsMore) => {
    const stored = readPref("forum-contrast");
    const mode = stored === "on" || stored === "off" ? stored : "auto";
    document.documentElement.dataset.contrast = mode;
    const on = mode === "on" || (mode === "auto" && deviceWantsMore);
    document.documentElement.classList.toggle("high-contrast", on);
  };
  paintContrast(Boolean(moreContrastQuery?.matches));
  moreContrastQuery?.addEventListener?.("change", (event) => paintContrast(Boolean(event.matches)));
}
