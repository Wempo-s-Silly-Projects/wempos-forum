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

// Lazy loader for the fun extras' vendored libraries (public/js/vendor/,
// byte-for-byte, licenses in REUSE.toml). Like code-highlight.js: one classic
// same-origin <script> per library, built with createElement (CSP 'self'
// unchanged), added only the first time an enabled effect asks, never retried
// after a failure (the effect just does not run).
export const FUN_VENDOR = Object.freeze({
  confetti: Object.freeze({ src: "/js/vendor/confetti.browser.js", global: "confetti" }),
  lottie: Object.freeze({ src: "/js/vendor/lottie_light.min.js", global: "lottie" }),
  roughNotation: Object.freeze({ src: "/js/vendor/rough-notation.iife.js", global: "RoughNotation" }),
  vanillaTilt: Object.freeze({ src: "/js/vendor/vanilla-tilt.min.js", global: "VanillaTilt" }),
  typeIt: Object.freeze({ src: "/js/vendor/typeit.umd.js", global: "TypeIt" }),
  splitting: Object.freeze({ src: "/js/vendor/splitting.min.js", global: "Splitting" }), // i18n-ignore
  cursorEffects: Object.freeze({ src: "/js/vendor/cursor-effects.browser.js", global: "cursoreffects" }),
  matter: Object.freeze({ src: "/js/vendor/matter.min.js", global: "Matter" }), // i18n-ignore
  signaturePad: Object.freeze({ src: "/js/vendor/signature_pad.umd.min.js", global: "SignaturePad" }),
});
// ZzFX ships as an ES module; it is imported (same origin) instead.
export const ZZFX_MODULE = "/js/vendor/zzfx.js";

function appendScript(doc, src) {
  return new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.setAttribute("src", src);
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(src)), { once: true });
    doc.head.append(script);
  });
}

// A loader bound to one document and global object: name -> Promise<library>.
export function createVendorLoader(doc, win) {
  const pending = new Map();
  return (name) => {
    const entry = FUN_VENDOR[name];
    if (!entry) return Promise.reject(new Error(String(name)));
    if (!pending.has(name)) {
      pending.set(name, appendScript(doc, entry.src).then(() => {
        const library = win[entry.global];
        if (!library) throw new Error(entry.global);
        return library;
      }));
    }
    return pending.get(name);
  };
}

let defaultLoader = null;
export function loadVendor(name) {
  defaultLoader ??= createVendorLoader(globalThis.document, globalThis);
  return defaultLoader(name);
}

export const importVendorModule = (src) => import(src);

// The extras' own stylesheet (public/fun.css: layout, keyframes, the
// reduced-motion stills), linked once per document, only by an enabled extra.
export const FUN_STYLESHEET = "/fun.css";
const styledDocs = new WeakSet();
export function ensureFunStyles(doc) {
  if (!doc?.head || styledDocs.has(doc)) return;
  styledDocs.add(doc);
  const link = doc.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", FUN_STYLESHEET);
  doc.head.append(link);
}
