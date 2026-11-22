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

// Code highlighting (v5.74, slate 2026-11-22-d): the vendored Prism build
// (public/js/vendor/prism.js, MIT) loads lazily, same-origin, in manual mode,
// and only once a rendered body holds a fenced block that names a language.
// The CSP is untouched: both scripts are 'self' and built with createElement.
// Blocks Prism never sees (no or unsafe language, over the size cap, Prism
// failed to load) stay exactly the plain text they were before.

// Mirrors constants.mjs (pinned equal by tests/wave574-prism.test.mjs).
export const CODE_LINE_NUMBERS_MIN_LINES = 5;
export const CODE_HIGHLIGHT_MAX_CHARS = 20000;

export const PRISM_CONFIG_SRC = "/js/prism-config.js";
export const PRISM_SRC = "/js/vendor/prism.js";
// Every language is bundled, so the autoloader only ever asks this
// same-origin folder for names the build lacks (and gets a 404).
export const PRISM_AUTOLOADER_PATH = "/js/vendor/components/";

const LANGUAGE_NONE = "none";
// The fence info string, whole: one ASCII word (letters, digits, "_", "-").
const SAFE_LANGUAGE = /^[\w-]{1,32}$/;

// "```js" → "language-js"; anything that is not one safe word (spaces,
// paths, quotes, markup, 33+ characters, nothing) → "language-none".
export function codeLanguageClass(info) {
  const name = String(info ?? "").trim();
  return "language-" + (SAFE_LANGUAGE.test(name) ? name.toLowerCase() : LANGUAGE_NONE);
}

// What renderBodyBlocks does with one fenced block. Plain blocks are not
// handed to Prism at all, so no untranslated "Plain text" label appears.
export function codeBlockPlan(info, text) {
  const languageClass = codeLanguageClass(info);
  const source = String(text ?? "");
  const highlight = languageClass !== "language-" + LANGUAGE_NONE && source.length <= CODE_HIGHLIGHT_MAX_CHARS;
  const lineCount = source.split("\n").length;
  return { languageClass, highlight, lineNumbers: highlight && lineCount >= CODE_LINE_NUMBERS_MIN_LINES };
}

// One classic same-origin script; resolves on load, rejects on error.
function appendScript(document, src, attributes = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.setAttribute("src", src);
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(src)), { once: true });
    document.head.append(script);
  });
}

// A highlighter bound to one document. The config script must run before the
// vendor file reads window.Prism, so the second tag is only added after the
// first has loaded. The load promise is kept, success or failure: Prism is
// fetched at most once per page, and a failure is not retried (the blocks
// simply stay plain).
export function createCodeHighlighter(document, getPrism = () => globalThis.Prism) {
  let loading = null;
  const load = () => {
    loading ??= appendScript(document, PRISM_CONFIG_SRC)
      .then(() => appendScript(document, PRISM_SRC, { "data-autoloader-path": PRISM_AUTOLOADER_PATH }));
    return loading;
  };
  const paint = (codes) => {
    const prism = getPrism();
    if (!prism || typeof prism.highlightElement !== "function") return;
    for (const code of codes) prism.highlightElement(code);
  };
  return {
    highlight(codes) {
      const list = Array.from(codes ?? []);
      if (!list.length || typeof document?.head?.append !== "function") return;
      load().then(() => paint(list), () => {
        // Plain text is the designed fallback; nothing to undo.
      });
    },
  };
}

const highlighters = new WeakMap();

// The app entry point: one highlighter (one load) per document.
export function highlightCodeBlocks(document, codes) {
  if (!document || typeof document !== "object") return;
  if (!highlighters.has(document)) highlighters.set(document, createCodeHighlighter(document));
  highlighters.get(document).highlight(codes);
}
