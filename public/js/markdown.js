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

// Markdown rendering (v2.5): a small, deliberate subset — bold, italics,
// inline code, fenced code blocks, headings, bullet lists, blockquotes (the
// pre-existing "> " convention), and LINKS. HTML is never interpreted (every
// character lands via textContent — "<b>" renders literally, a restriction
// the owner asked for), external images/embeds are never rendered ("![…](…)"
// stays literal text), and link URLs must pass a scheme check before they
// ever reach an href. No dependencies: the parser is plain string walking.
import { t } from "./i18n.js";

const SAFE_PREFIXES = ["http://", "https://", "/"];
const SPOILER_MARK = "||";
export const SPOILER_MASK = "\u2592\u2592\u2592";
const REVEAL_KEYS = new Set(["Enter", " "]);

// A link target is safe only when it starts with a known-safe scheme or is a
// same-origin absolute path. "javascript:", "data:", "vbscript:", malformed
// URLs and any other scheme are refused by the caller (literal text instead).
export function isSafeLinkUrl(raw) {
  const value = String(raw ?? "").trim();
  if (value === "") return false;
  // Control characters and escapes can slip a scheme past the prefix test
  // ("ht\ntps://", backslash tricks in some URL parsers). Refuse before any
  // prefix work (review finding).
  if (/[\t\n\r\\]/.test(value)) return false;
  if (value.startsWith("//")) {
    // Network-path reference ("//evil.com") resolves scheme-relative against
    // the page — external navigation wearing the "internal" label. Not a
    // safe same-origin value.
    return false;
  }
  const lower = value.toLowerCase();
  for (const prefix of SAFE_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

// Inline scan of ONE text run: `code`, **bold**, *italic*, ~~strike~~,
// ||spoiler|| (wave 2026-11-21-3), [text](url). Markers are CONSUMED or REFUSED:
// - consumed → the pre-marker text run emits, then the element; start walks
//   past the close.
// - refused (unterminated marker, refused image, unsafe/malformed link) →
//   NO run emits; start stays, and the scan walks past the marker so its
//   span rides the final text run exactly once.
// A mention is an "@" preceded by the text start or a non-word character,
// then a word-only handle — the exact token shape the API's notify scan uses
// (api/mentions.mjs). Renders as a same-origin /users/<name> anchor. The
// handle is regex-restricted to [A-Za-z0-9_], so it can never escape its href
// segment; hrefs stay relative, and internal anchors (unlike links) get no
// target attribute — they ride the SPA router like profile links.
const MENTION_PATTERN = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]+)/g;
const MENTION_LOOKBEHIND = 1; // the non-word char MENTION_PATTERN consumes before "@"

// The next mention token at or after `from`; -1 when there is none.
function nextMentionOpen(value, from) {
  MENTION_PATTERN.lastIndex = from;
  let match;
  while ((match = MENTION_PATTERN.exec(value)) !== null) {
    return match.index + (match[0].length - match[1].length) - 1; // "@" position
  }
  return -1;
}

// The handle that starts at an "@" position (after the "@").
function mentionHandleAt(value, at) {
  const match = /^@([a-zA-Z0-9_]+)/.exec(value.slice(at));
  return match ? match[1] : null;
}

// Wave 19: parseInline only ever scans forward, so the next occurrence of a
// marker at or after `from` stays valid until the scan passes it, and a miss
// stays a miss. Caching each marker's last answer keeps marker-heavy bodies
// (a capped post of "**…" or "[…") linear instead of rescanning to the end on
// every step — this parser runs on the worker's spoiler-masked output paths.
// `lookbehind` is how many chars before a hit its match consumed (the mention
// pattern eats the char before "@"): a hit is reusable only while that whole
// match still starts at or after `from`, so results never change.
function forwardFinder(search, lookbehind = 0) {
  let lastFrom = -1;
  let lastAt = -1;
  return (from) => {
    const reusable = lastFrom !== -1 && from >= lastFrom && (lastAt === -1 || lastAt - lookbehind >= from);
    if (reusable) return lastAt;
    lastFrom = from;
    lastAt = search(from);
    return lastAt;
  };
}

function inlineFinders(value) {
  const seek = (needle) => forwardFinder((from) => value.indexOf(needle, from));
  return {
    code: seek("`"),
    bold: seek("**"),
    strike: seek("~~"),
    spoiler: seek(SPOILER_MARK),
    link: seek("["),
    star: seek("*"),
    closeBracket: seek("]"),
    closeParen: seek(")"),
    em: forwardFinder((from) => nextItalicOpen(value, from)),
    mention: forwardFinder((from) => nextMentionOpen(value, from), MENTION_LOOKBEHIND),
  };
}

// `spoilerRanges` (optional): each consumed spoiler's [start, end) span in
// `text` is pushed onto it, so maskSpoilers hides exactly what renders hidden.
export function parseInline(document, text, spoilerRanges = null) {
  const value = String(text ?? "");
  const find = inlineFinders(value);
  const nodes = [];
  let start = 0;
  let index = 0;
  while (index < value.length) {
    const codeOpen = find.code(index);
    const boldOpen = find.bold(index);
    const strikeOpen = find.strike(index);
    const spoilerOpen = find.spoiler(index);
    const linkOpen = find.link(index);
    const emOpen = find.em(index);
    const mentionOpen = find.mention(index);
    const next = pickFirst([codeOpen, boldOpen, strikeOpen, spoilerOpen, emOpen, linkOpen, mentionOpen]);
    if (next === -1 || next >= value.length) break;
    const emitPre = () => {
      if (next > start) nodes.push(makeText(document, value.slice(start, next)));
    };

    if (next === codeOpen) {
      const close = find.code(next + 1);
      if (close === -1 || close === next + 1) {
        emitPre();
        start = next;
        index = next + 1;
        continue;
      }
      emitPre();
      nodes.push(makeInline(document, "code", value.slice(next + 1, close)));
      start = index = close + 1;
      continue;
    }
    if (next === boldOpen) {
      const close = find.bold(next + 2);
      if (close === -1 || close === next + 2) {
        emitPre();
        start = next;
        index = next + 2;
        continue;
      }
      emitPre();
      nodes.push(makeInline(document, "strong", value.slice(next + 2, close)));
      start = index = close + 2;
      continue;
    }
    if (next === strikeOpen) {
      const close = find.strike(next + 2);
      if (close === -1 || close === next + 2) {
        emitPre();
        start = next;
        index = next + 2;
        continue;
      }
      emitPre();
      nodes.push(makeInline(document, "del", value.slice(next + 2, close)));
      start = index = close + 2;
      continue;
    }
    if (next === spoilerOpen) {
      const close = find.spoiler(next + 2);
      if (close === -1 || close === next + 2) {
        emitPre();
        start = next;
        index = next + 2;
        continue;
      }
      emitPre();
      spoilerRanges?.push([next, close + 2]);
      nodes.push(makeSpoiler(document, value.slice(next + 2, close)));
      start = index = close + 2;
      continue;
    }
    if (next === emOpen) {
      const close = find.star(next + 1);
      const emBody = close === -1 ? "" : value.slice(next + 1, close);
      if (close === -1 || emBody.length === 0 || emBody.startsWith("*") || emBody.endsWith("*")) {
        emitPre();
        start = next;
        index = next + 1;
        continue;
      }
      emitPre();
      nodes.push(makeInline(document, "em", emBody));
      start = index = close + 1;
      continue;
    }
    // Mention token (C2): "@handle" → a same-origin /users/<handle> anchor.
    const handle = mentionHandleAt(value, next);
    if (handle) {
      emitPre();
      const anchor = document.createElement("a");
      anchor.textContent = "@" + handle;
      anchor.href = "/users/" + handle;
      anchor.setAttribute("class", "mention");
      nodes.push(anchor);
      start = index = next + 1 + handle.length;
      continue;
    }
    // linkOpen: [text](url) — images ("![") are always refused.
    const isImage = next > 0 && value[next - 1] === "!";
    const closeBracket = find.closeBracket(next + 1);
    const parenOpen = closeBracket === -1 ? -1 : value.indexOf("(", closeBracket + 1);
    const parenClose = closeBracket === -1 ? -1 : find.closeParen(closeBracket + 1);
    const wellFormed = closeBracket !== -1 && parenOpen === closeBracket + 1 && parenClose !== -1;
    const label = wellFormed ? value.slice(next + 1, closeBracket) : null;
    const url = wellFormed ? value.slice(parenOpen + 1, parenClose) : null;
    if (isImage || !wellFormed || label === "" || !isSafeLinkUrl(url)) {
      // Refused: no pre-text run; the bracket and URL stay literal.
      index = next + 1;
      continue;
    }
    emitPre();
    const anchor = document.createElement("a");
    anchor.textContent = label;
    anchor.href = url.trim();
    if (url.startsWith("/")) {
      anchor.setAttribute("rel", "internal");
    } else {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer"); // i18n-ignore
    }
    nodes.push(anchor);
    start = index = parenClose + 1;
  }
  if (start < value.length) nodes.push(makeText(document, value.slice(start)));
  return nodes;
}

// An italic opener is a "*" not doubled and not followed by whitespace.
function nextItalicOpen(value, from) {
  let at = value.indexOf("*", from);
  while (at !== -1) {
    if (value[at + 1] !== undefined && value[at + 1] !== " " && value.slice(at, at + 2) !== "**") {
      return at;
    }
    at = value.indexOf("*", at + 1);
  }
  return -1;
}

function pickFirst(indices) {
  let best = -1;
  for (const at of indices) {
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  return best;
}

function makeText(document, text) {
  return document.createTextNode(text);
}

function makeInline(document, tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

// Spoiler (wave 2026-11-21-3): blacked-out text behind a focusable button;
// screen readers hear the label, not the hidden text, until it is revealed.
function makeSpoiler(document, text) {
  const spoiler = makeInline(document, "span", text);
  spoiler.className = "spoiler";
  spoiler.setAttribute("role", "button");
  spoiler.setAttribute("tabindex", "0");
  spoiler.setAttribute("aria-expanded", "false");
  spoiler.setAttribute("aria-label", t("markdown.spoiler"));
  spoiler.addEventListener("click", (event) => {
    if (spoiler.getAttribute("role") !== "button") return;
    event.preventDefault();
    event.stopPropagation?.();
    revealSpoiler(spoiler);
  });
  spoiler.addEventListener("keydown", (event) => {
    if (!REVEAL_KEYS.has(event.key) || spoiler.getAttribute("role") !== "button") return;
    event.preventDefault();
    revealSpoiler(spoiler);
  });
  return spoiler;
}

// Reveal for this reader only: the text stays, the button semantics go.
export function revealSpoiler(spoiler) {
  if (/\bspoiler-revealed\b/.test(spoiler.className)) return;
  spoiler.className = `${spoiler.className} spoiler-revealed`;
  spoiler.removeAttribute("role");
  // tabindex -1 (not removed) so a keyboard reveal keeps focus in place;
  // aria-expanded goes with the button role (invalid on a plain span).
  spoiler.setAttribute("tabindex", "-1");
  spoiler.removeAttribute("aria-label");
  spoiler.removeAttribute("aria-expanded");
}

// Raw-text surfaces (preview snippets, reply context, search hits) never
// give a spoiler away.
// The mask follows the renderer, not a standalone regex: every inline run the
// post page parses (paragraph/heading text, each quote line, each list item;
// never code fences) goes through parseInline, and only the spans it turns
// into spoilers are masked. A "||" inside code or bold can then never pair
// with a real spoiler's opener and leave the spoiler's words bare (wave 15).
const MASK_DOCUMENT = {
  createTextNode: (text) => ({ text }),
  createElement: () => ({ setAttribute() {}, addEventListener() {} }),
};

const inlineRuns = (block) => {
  if (block.kind === "code") return [];
  const lines = block.text.map((line, i) => ({ line, at: block.at[i] }));
  if (block.kind === "list" || block.kind === "quote") return lines.map((entry) => [entry]);
  return [lines];
};

// Raw [start, end) spans of the spoilers one run renders.
function runSpoilerSpans(run) {
  const offsets = [];
  run.forEach(({ line, at }, i) => {
    for (let k = 0; k < line.length; k += 1) offsets.push(at + k);
    if (i < run.length - 1) offsets.push(at + line.length);
  });
  const ranges = [];
  parseInline(MASK_DOCUMENT, run.map(({ line }) => line).join("\n"), ranges);
  return ranges.map(([start, end]) => [offsets[start], offsets[end - 1] + 1]);
}

export function maskSpoilers(text) {
  const value = String(text ?? "");
  if (!value.includes(SPOILER_MARK)) return value;
  const spans = scanBlocks(value).flatMap(inlineRuns).flatMap(runSpoilerSpans)
    .sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start < cursor) continue;
    out += value.slice(cursor, start) + SPOILER_MASK;
    cursor = end;
  }
  return out + value.slice(cursor);
}

// A cut-down preview that can never give a spoiler away: mask FIRST, then
// cut, so a spoiler split by the cut is already ▒▒▒ (wave 17). Shared by the
// client and the server (api/core/spoilers.mjs) — one implementation.
const ELLIPSIS = "\u2026";
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

export function maskedExcerpt(text, max) {
  const masked = maskSpoilers(text);
  if (masked.length <= max) return masked;
  // Wave 19: never cut between an emoji's two UTF-16 halves.
  const lead = masked.charCodeAt(max - 1);
  const cut = lead >= HIGH_SURROGATE_MIN && lead <= HIGH_SURROGATE_MAX ? max - 1 : max;
  return masked.slice(0, cut) + ELLIPSIS;
}

// Block shape of a body: fenced code (```…```), "# " headings (1–3 hashes —
// the post page's own h1/h2 hierarchy is not for post bodies), "- " lists,
// and quote/paragraph runs (the pre-existing convention). Blocks keep their
// RAW text (inline rendering happens at build time).
export function parseBlocks(body) {
  // eslint-disable-next-line no-unused-vars -- `at` is destructured only to omit it from the rest copy
  return scanBlocks(body).map(({ at, ...block }) => block);
}

// parseBlocks plus `at`: each text entry's raw offset in the body (internal,
// for maskSpoilers).
function scanBlocks(body) {
  const lines = String(body ?? "").split("\n");
  const blocks = [];
  let fence = null;
  let list = null;
  let lineStart = 0;
  for (const line of lines) {
    const at = lineStart;
    lineStart += line.length + 1;
    const trimmed = line.trim();
    const lead = at + line.length - line.trimStart().length;
    const fenceMark = trimmed.startsWith("```");
    if (fence !== null) {
      if (fenceMark) {
        blocks.push(fence);
        fence = null;
      } else {
        fence.text.push(line);
      }
      continue;
    }
    if (fenceMark) {
      flushList(blocks, () => list);
      list = null;
      fence = { kind: "code", text: [], at: [] };
      continue;
    }
    const heading = /^#{1,6} /.exec(trimmed);
    if (heading) {
      flushList(blocks, () => list);
      list = null;
      // Level = the HASH count (the match includes the separating space).
      blocks.push({
        kind: "heading", text: [trimmed.slice(heading[0].length)], at: [lead + heading[0].length],
        level: heading[0].length - 1,
      });
      continue;
    }
    if (trimmed.startsWith("- ")) {
      if (!list) list = { kind: "list", text: [], at: [] };
      list.text.push(trimmed.slice(2));
      list.at.push(lead + 2);
      continue;
    }
    flushList(blocks, () => list);
    list = null;
    const isQuote = trimmed.startsWith("> ");
    const content = isQuote ? trimmed.slice(2) : line;
    const contentAt = isQuote ? lead + 2 : at;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === (isQuote ? "quote" : "paragraph")) {
      last.text.push(content);
      last.at.push(contentAt);
    } else {
      blocks.push({ kind: isQuote ? "quote" : "paragraph", text: [content], at: [contentAt] });
    }
  }
  flushList(blocks, () => list);
  if (fence) blocks.push(fence);
  return blocks;
}

function flushList(blocks, getList) {
  const list = getList();
  if (list && list.text.length) blocks.push(list);
}
