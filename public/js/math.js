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

// Math in post bodies (Batch C): $…$ inline and $$…$$ display runs render
// with the vendored KaTeX (public/js/vendor/katex/, MIT), loaded only when a
// body holds math. Until it loads, or if it fails, the run stays the exact
// text the member wrote. Never inside code: fences never reach here and
// inline `code` spans are skipped by the scanner. KaTeX builds its DOM itself
// (CSSOM styles, no markup strings) with trust off, so \href, \url, \html…
// and \includegraphics are refused.
import { loadScriptOnce, loadStylesheetOnce } from "./vendor-loader.js";

// Mirrors constants.mjs (pinned equal by tests/batch-c-rendering.test.mjs).
export const MATH_MAX_CHARS = 2000;

export const KATEX_SRC = "/js/vendor/katex/katex.min.js";
export const KATEX_CSS = "/js/vendor/katex/katex.min.css";

export const KATEX_OPTIONS = Object.freeze({
  throwOnError: false,
  trust: false,
  strict: "ignore",
  maxSize: 10,
  maxExpand: 1000,
  output: "htmlAndMathml",
});

const SPOILER_MARK = "||";
const isSpace = (ch) => ch === undefined || /\s/.test(ch);
const isDigit = (ch) => ch !== undefined && ch >= "0" && ch <= "9";
const usable = (tex) => tex.trim() !== "" && tex.length <= MATH_MAX_CHARS && !tex.includes(SPOILER_MARK);

function matchDisplay(value, at) {
  const close = value.indexOf("$$", at + 2);
  if (close === -1) return null;
  const tex = value.slice(at + 2, close);
  return usable(tex) ? { tex, display: true, end: close + 2 } : null;
}

// Inline: the opener is followed by a non-space, the closer is preceded by
// a non-space and not followed by a digit ("$5 and $10" stays text), and
// the run stays on one line.
function matchInline(value, at) {
  if (isSpace(value[at + 1]) || value[at + 1] === "$") return null;
  let close = value.indexOf("$", at + 1);
  while (close !== -1 && close - at - 1 <= MATH_MAX_CHARS) {
    const tex = value.slice(at + 1, close);
    if (tex.includes("\n")) return null;
    if (!isSpace(value[close - 1]) && value[close - 1] !== "\\" && !isDigit(value[close + 1])) {
      return usable(tex) ? { tex, display: false, end: close + 1 } : null;
    }
    close = value.indexOf("$", close + 1);
  }
  return null;
}

// One inline run → [{kind:"text", value} | {kind:"math", tex, display, raw}].
// Inline `code`, backslash escapes and spoiler interiors are skipped, so
// the markdown inline parser still sees them exactly as before.
export function splitMath(text) {
  const value = String(text ?? "");
  if (!value.includes("$")) return [{ kind: "text", value }];
  const segments = [];
  let textStart = 0;
  let spoilers = 0;
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === "`") {
      const close = value.indexOf("`", i + 1);
      i = close > i + 1 ? close + 1 : i + 1;
      continue;
    }
    if (value.startsWith(SPOILER_MARK, i)) {
      spoilers += 1;
      i += 2;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "$") {
      i += 1;
      continue;
    }
    const isDisplay = value.startsWith("$$", i);
    const match = spoilers % 2 === 0 ? (isDisplay ? matchDisplay(value, i) : matchInline(value, i)) : null;
    if (!match) {
      i += isDisplay ? 2 : 1;
      continue;
    }
    if (i > textStart) segments.push({ kind: "text", value: value.slice(textStart, i) });
    segments.push({ kind: "math", tex: match.tex, display: match.display, raw: value.slice(i, match.end) });
    i = textStart = match.end;
  }
  if (textStart < value.length) segments.push({ kind: "text", value: value.slice(textStart) });
  return segments.length ? segments : [{ kind: "text", value }];
}

// The placeholder: the raw source as text, until KaTeX replaces it.
export function createMathNode(document, segment) {
  const node = document.createElement("span");
  node.className = segment.display ? "math-display" : "math-inline";
  node.textContent = segment.raw;
  return node;
}

export function loadKatex(document) {
  loadStylesheetOnce(document, KATEX_CSS).catch(() => {
    // Unstyled math is still readable; nothing to undo.
  });
  return loadScriptOnce(document, KATEX_SRC, () => globalThis.katex);
}

// Renders every queued placeholder; returns the nodes KaTeX filled. A run
// KaTeX throws on keeps its raw text.
export async function typesetMath(document, items, { loadKatex: load = () => loadKatex(document) } = {}) {
  if (!items?.length) return [];
  let katex;
  try {
    katex = await load();
  } catch {
    return [];
  }
  const rendered = [];
  for (const { node, tex, display } of items) {
    const raw = node.textContent;
    try {
      katex.render(tex, node, { ...KATEX_OPTIONS, displayMode: Boolean(display) });
      rendered.push(node);
    } catch {
      node.textContent = raw;
    }
  }
  return rendered;
}
