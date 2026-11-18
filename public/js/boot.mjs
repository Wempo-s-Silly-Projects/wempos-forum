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

// WEMPOS-FORUM 5.0, wave 1: the browser boot wiring of the vendored Kitskey
// framework. The framework lives byte-pinned under public/js/vendor/
// (tests/vendor-parity.test.mjs enforces both directions of that pin); this
// module is the app-side seam the route waves consume:
//   - useDocument(document) installs the shared document frontload/dom's
//     el() factory rides (the factory keeps the global by default; the
//     install here is the wave-2+ contract, made explicit at boot);
//   - makeAppearance stands up the appearance engine on the forum's OWN
//     storage-key family — frontload/tokens is the theme engine, exactly as
//     the GC lane's theme.js carries it:
//       "forum-theme" — the key theme-preload.js and theme.js own today;
//         the engine reads (and later waves' setThemeChoice would write)
//         the SAME home, so a member's stored choice survives the waves.
//       "forum-skin" — the skin key, reserved in the family now, written
//         only when the forum grows a skin surface; no stored value exists
//         today, so the read resolves the default skin every time.
//
// The wave law is ZERO behavior change: theme-preload.js keeps the
// pre-paint paint, and theme.js keeps the toggle, the corner preference,
// and the Turnstile re-theme in full as app chrome. The boot apply below
// re-resolves through the same key theme.js reads and the same
// resolveTheme rules theme.js ships, re-writing the SAME data-theme value
// theme-preload.js already painted, the same two <meta theme-color>
// colors theme.js carries — and lands data-skin="brand", an attribute
// nothing in styles.css consumes (the skin dimension is inert by
// construction until the forum actually skins).
//
import { useDocument } from "./vendor/frontload/dom.mjs";
import {
  makeAppearance,
  resolveSkin,
  resolveTheme,
} from "./vendor/frontload/tokens.mjs";

export { resolveSkin, resolveTheme } from "./vendor/frontload/tokens.mjs";
export { useDocument };

export const THEME_STORAGE_KEY = "forum-theme";
export const SKIN_STORAGE_KEY = "forum-skin";

// The one engine, once per page. No onRetheme hook: the toggle decorations
// (icon, aria labels, Turnstile re-theme) remain theme.js's until their
// wave re-expresses them on this engine.
export const appearance = makeAppearance({
  themeKey: THEME_STORAGE_KEY,
  skinKey: SKIN_STORAGE_KEY,
  legacyThemeKeys: [], // "forum-theme" IS the home; no older keys exist
  // The forum has no skins, so the skin vocabulary stays the kit's default
  // and the chrome palette rides the default skin — the same colors
  // theme.js paints into index.html's theme-color metas.
  chromeColors: { brand: { light: "#f7efdc", dark: "#131b27" } },
});

// The browser wiring runs once at exactly one place — this module's own
// evaluation, from app.js's import. Storage ACCESS itself can be blocked
// (strict privacy modes throw on the property), so the pass rides the same
// guard shape theme.js's boot uses: a neutral stub keeps the OS preference
// resolving, and non-browser loaders (the suite) get the exports without
// the DOM pass entirely.
function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return { getItem: () => null };
  }
}

if (typeof document !== "undefined") {
  useDocument(document);
  appearance.applyAppearance(document, browserStorage());
}
