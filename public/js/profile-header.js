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

// Batch I items 5 + 6: the profile header decoration the member picks
// (PUT /api/me/profile-header; "" = plain).
//   - "tint": node-vibrant (MIT, vendored verbatim, loaded lazily only when a
//     profile asks for it) reads the palette of the member's OWN avatar and
//     tints the heading. Same-origin images only (a cross-origin canvas is
//     tainted anyway), and a member-chosen banner colour always wins.
//   - "dots" / "stripes" / "grid": static zero-image CSS patterns in
//     styles.css (no animation, so reduced-motion has nothing to stop).
//     css-doodle was not used: it renders through shadow-root <style>
//     elements, which the CSP (style-src 'self') refuses.

// Mirrors constants.mjs PROFILE_HEADER_STYLES (pinned equal by the tests).
export const PROFILE_HEADER_STYLES = Object.freeze(["", "tint", "dots", "stripes", "grid"]);
const PATTERN_STYLES = new Set(["dots", "stripes", "grid"]);
const VIBRANT_SRC = "/js/vendor/vibrant.min.js";
const TINT_PROPERTY = "--profile-header-tint";
// node-vibrant's swatch names, most saturated first.
const swatchesInOrder = (palette) => [
  palette.Vibrant, palette.Muted, palette.DarkVibrant, palette.DarkMuted, palette.LightVibrant, palette.LightMuted,
];

export const headerClassFor = (style) => (PATTERN_STYLES.has(style) ? "profile-header-" + style : "");

const swatchHex = (swatch) => {
  if (!swatch) return "";
  const hex = typeof swatch.getHex === "function" ? swatch.getHex() : swatch.hex;
  return typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "";
};

export function pickTint(palette) {
  if (!palette || typeof palette !== "object") return "";
  for (const swatch of swatchesInOrder(palette)) {
    const hex = swatchHex(swatch);
    if (hex) return hex;
  }
  return "";
}

const isSameOrigin = (url, origin) => {
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
};

export function canTintHeader(profile, origin) {
  return Boolean(profile && profile.profileHeader === "tint" && !profile.bannerColor &&
    typeof profile.avatarUrl === "string" && profile.avatarUrl && isSameOrigin(profile.avatarUrl, origin));
}

let vibrantLoading = null;

function loadVibrant(document) {
  vibrantLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.setAttribute("src", VIBRANT_SRC);
    script.addEventListener("load", () => resolve(document.defaultView?.Vibrant), { once: true });
    script.addEventListener("error", () => reject(new Error(VIBRANT_SRC)), { once: true });
    document.head.append(script);
  });
  return vibrantLoading;
}

// Decorates one profile heading. The tint is best-effort: any failure leaves
// the plain heading, which is the designed fallback.
export function applyProfileHeader(heading, profile, { load = loadVibrant } = {}) {
  const document = heading.ownerDocument;
  const patternClass = headerClassFor(profile?.profileHeader);
  if (patternClass) heading.classList.add("profile-header-pattern", patternClass);
  const origin = document.defaultView?.location?.origin ?? "";
  if (!canTintHeader(profile, origin)) return Promise.resolve("");
  return load(document)
    .then((Vibrant) => Vibrant.from(profile.avatarUrl).getPalette())
    .then((palette) => {
      const tint = pickTint(palette);
      if (tint && heading.isConnected !== false) {
        heading.classList.add("profile-header-tinted");
        heading.style.setProperty(TINT_PROPERTY, tint);
      }
      return tint;
    })
    .catch(() => "");
}
