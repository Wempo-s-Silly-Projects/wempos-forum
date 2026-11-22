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

// Hide strong language (batch L item 1): a per-reader device preference,
// off by default, that blurs matching words in rendered posts and chat
// messages. Each blurred word is a button: click, Enter or Space shows it.
// Only the rendered DOM changes — the stored text, the composer, quotes,
// copy and search never see it, and nothing is ever blocked from posting.
// The word lists are bad-words-next's own (vendored verbatim, MIT, nine
// lists); the matcher below is ours: one token at a time, the list's
// look-alike digits/symbols folded first, "*" a wildcard and "+" a repeat.
import { t } from "./i18n.js";

export const STRONG_LANGUAGE_STORAGE_KEY = "forum-hide-strong-language";
const PREF_ON = "on";
const PREF_OFF = "off";

export const STRONG_LANGUAGE_LIST_IDS = Object.freeze(["en", "es", "fr", "de", "pl", "ru", "ru_lat", "ua", "ch"]);
// Chinese has no spaces between words, so its patterns match inside a run.
const SPACELESS_LISTS = new Set(["ch"]);

const BLUR_CLASS = "strong-language";
const REVEALED_CLASS = "is-revealed";
const SKIP_TAGS = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA", "INPUT", "BUTTON"]);
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function readHideStrongLanguage(storage) {
  try {
    return storage?.getItem(STRONG_LANGUAGE_STORAGE_KEY) === PREF_ON;
  } catch {
    return false;
  }
}

export function createStrongLanguageToggle(doc, storage) {
  const wrapper = doc.createElement("label");
  wrapper.className = "strong-language-pref";
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.checked = readHideStrongLanguage(storage);
  box.addEventListener("change", () => {
    try {
      storage?.setItem(STRONG_LANGUAGE_STORAGE_KEY, box.checked ? PREF_ON : PREF_OFF);
    } catch {
      // Blocked storage: the choice applies to posts rendered from now on
      // only while this page stays open (nothing to persist it in).
    }
  });
  wrapper.append(box, doc.createTextNode(" " + t("safety.hideStrongLanguage")));
  return wrapper;
}

const escapeLiteral = (text) => text.replace(/[.?^${}()|[\]\\/]/g, "\\$&");

// One list pattern → regex source: "*" any run of non-space, "+" repeat
// (kept as the regex quantifier), everything else literal. Multi-word
// patterns ("_" stands for a space) cannot match a single token: skipped.
function patternSource(word) {
  const trimmed = String(word ?? "").trim().toLowerCase();
  if (!trimmed || trimmed.includes("_")) return null;
  return trimmed.split("*").map(escapeLiteral).join("\\S*");
}

function compileList(data) {
  const sources = (Array.isArray(data?.words) ? data.words : []).map(patternSource).filter(Boolean);
  if (!sources.length) return null;
  const spaceless = SPACELESS_LISTS.has(data.id);
  const body = sources.map((source) => (spaceless ? source.replace(/^\\S\*|\\S\*$/g, "") : source)).join("|");
  const lookalike = data.lookalike && typeof data.lookalike === "object" ? data.lookalike : {};
  return {
    spaceless,
    lookalike,
    whole: new RegExp(`^(?:${body})$`, "iu"),
    inner: spaceless ? new RegExp(`(?:${body})`, "giu") : null,
  };
}

const foldLookalikes = (text, lookalike) =>
  Array.from(text.toLowerCase()).map((character) => lookalike[character] ?? character).join("");

// A matcher over every list: ranges(text) → [[start, end], ...] of the
// words to blur, in order, never overlapping.
export function compileStrongLanguage(lists) {
  const compiled = lists.map(compileList).filter(Boolean);
  const spaced = compiled.filter((list) => !list.spaceless);
  const spaceless = compiled.filter((list) => list.spaceless);
  return {
    ranges(text) {
      const source = String(text ?? "");
      const found = [];
      for (const token of source.matchAll(/\S+/gu)) {
        const core = token[0].replace(EDGE_PUNCTUATION, "");
        if (!core) continue;
        const start = token.index + token[0].indexOf(core);
        if (spaced.some((list) => list.whole.test(core) || list.whole.test(foldLookalikes(core, list.lookalike)))) {
          found.push([start, start + core.length]);
          continue;
        }
        for (const list of spaceless) {
          for (const hit of core.matchAll(list.inner)) {
            if (hit[0]) found.push([start + hit.index, start + hit.index + hit[0].length]);
          }
        }
      }
      return found.sort((a, b) => a[0] - b[0]).filter((range, index, all) => index === 0 || range[0] >= all[index - 1][1]);
    },
  };
}

let loading = null;

// The lists are fetched (same-origin module imports) only the first time a
// reader with the preference on renders something.
export function loadStrongLanguage() {
  loading ??= Promise.all(STRONG_LANGUAGE_LIST_IDS.map((id) => import(`./vendor/bad-words-next/${id}.mjs`)))
    .then((modules) => compileStrongLanguage(modules.map((module) => module.default)));
  return loading;
}

function reveal(span) {
  span.classList.add(REVEALED_CLASS);
  span.removeAttribute("role");
  span.removeAttribute("tabindex");
  span.removeAttribute("aria-label");
  span.firstChild?.removeAttribute?.("aria-hidden");
}

function blurredWord(document, word) {
  const span = document.createElement("span");
  span.className = BLUR_CLASS;
  span.setAttribute("role", "button");
  span.setAttribute("tabindex", "0");
  span.setAttribute("aria-label", t("safety.hiddenWord"));
  const inner = document.createElement("span");
  inner.setAttribute("aria-hidden", "true");
  inner.textContent = word;
  span.append(inner);
  span.addEventListener("click", (event) => {
    if (span.classList.contains(REVEALED_CLASS)) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    reveal(span);
  });
  span.addEventListener("keydown", (event) => {
    if (span.classList.contains(REVEALED_CLASS) || (event?.key !== "Enter" && event?.key !== " ")) return;
    event.preventDefault?.();
    reveal(span);
  });
  return span;
}

const skipped = (node) =>
  node.nodeType === ELEMENT_NODE && (SKIP_TAGS.has(node.tagName) || String(node.className ?? "").split(/\s+/).includes(BLUR_CLASS));

function textNodesUnder(root) {
  const found = [];
  const walk = (node) => {
    for (const child of Array.from(node.childNodes ?? [])) {
      if (child.nodeType === TEXT_NODE) found.push(child);
      else if (child.nodeType === ELEMENT_NODE && !skipped(child)) walk(child);
    }
  };
  walk(root);
  return found;
}

function replaceText(document, parent, textNode, text, ranges) {
  let cursor = 0;
  const pieces = [];
  for (const [start, end] of ranges) {
    if (start > cursor) pieces.push(document.createTextNode(text.slice(cursor, start)));
    pieces.push(blurredWord(document, text.slice(start, end)));
    cursor = end;
  }
  if (cursor < text.length) pieces.push(document.createTextNode(text.slice(cursor)));
  for (const piece of pieces) parent.insertBefore(piece, textNode);
  parent.removeChild(textNode);
}

// Wraps every matched word under `root` (code and already-blurred words
// skipped). Returns how many words it blurred; running it twice blurs none.
export function blurStrongLanguage(document, root, matcher) {
  if (!root || !matcher) return 0;
  // An element whose text was set directly (no child nodes yet in a test
  // DOM) gets one real text node first.
  if (!root.childNodes?.length && root.textContent) {
    const text = root.textContent;
    root.textContent = "";
    root.append(document.createTextNode(text));
  }
  let count = 0;
  for (const node of textNodesUnder(root)) {
    const text = String(node.textContent ?? "");
    const ranges = matcher.ranges(text);
    if (!ranges.length || !node.parentNode) continue;
    replaceText(document, node.parentNode, node, text, ranges);
    count += ranges.length;
  }
  return count;
}

const readerStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

// The render/chat hook: does nothing unless this reader turned the
// preference on; otherwise loads the lists once and blurs `root`.
export async function applyStrongLanguageBlur(root, { document = root?.ownerDocument, storage = readerStorage() } = {}) {
  if (!root || !document || !readHideStrongLanguage(storage)) return 0;
  try {
    return blurStrongLanguage(document, root, await loadStrongLanguage());
  } catch {
    return 0;
  }
}
