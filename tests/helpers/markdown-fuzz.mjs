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

// Wave 23 F1: an adversarial body generator and property checks for the
// inline parser, written independently of the wave-19 self-fuzz. Seeded, so
// a failing case reproduces from its seed.

export const BODY_CAP = 4750; // MAX_COMPOSER_BODY_CHARS (api/posts-write.mjs)

// Secret characters: each occurs at most once per body, so "this char left
// a rendered spoiler" is an exact test, not a heuristic.
const SECRET_BASE = 0x4e00;
const SECRET_SPAN = 0x5000;
export const isSecret = (ch) => {
  const code = ch.codePointAt(0);
  return code >= SECRET_BASE && code < SECRET_BASE + SECRET_SPAN;
};

const MARKERS = ["**", "__", "||", "`", "*", "~~", "[", "]", "(", ")", "![", "@", "_", "|", "~"];
const LINE_LEADS = ["\n", "\n- ", "\n> ", "\n# ", "\n```", "\n```\n", "\n  - ", "\n>  "];
const LINKS = [
  "[ok](https://example.com/p)", "[up](HTTPS://EXAMPLE.COM)", "[in](/posts/1)", "[sp]( /posts/2 )",
  "[js](javascript:alert(1))", "[jt](JaVaScRiPt:x)", "[nw](//evil.example)", "[da](data:text/html,x)",
  "[tb](ht\ttps://x)", "[bs](/a\\b)", "[](https://empty.example)", "![img](https://img.example/x.png)",
  "[a [b] c](/x)", "[x](/p(q))", "[x] (/gap)", "[x](", "[[x](/y)](/z)",
];
const MENTIONS = ["@bob", "@a_1", " @Zed", "x@mail", "(@paren)", "@@double", "**@b**", "@"];
const UNICODE = [
  "\u{1F600}", "\u{1F469}‍\u{1F4BB}", "‏", "‮", "⁦", "\uD83D", "\uDE00",
  "é", "ß", "ال", "א", "﻿", " ", "　", "\t",
];
const WORDS = ["a", "word", "Hi", "x1", " ", "  ", ".", ",", "-", "#", ">"];

export function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function makeSecrets() {
  let next = 0;
  return () => String.fromCodePoint(SECRET_BASE + (next++ % SECRET_SPAN));
}

// One token; `depth` bounds the wrapped (nested/overlapping) constructions.
function token(rng, secret, depth) {
  const roll = rng();
  if (roll < 0.22) return pick(rng, MARKERS);
  if (roll < 0.3) return pick(rng, LINE_LEADS);
  if (roll < 0.38) return pick(rng, LINKS);
  if (roll < 0.44) return pick(rng, MENTIONS);
  if (roll < 0.52) return pick(rng, UNICODE);
  if (roll < 0.72) return secret();
  if (roll < 0.86 || depth > 3) return pick(rng, WORDS);
  // Wrapped run: a marker pair around a short run, sometimes left open or
  // closed with a DIFFERENT marker (overlap: "**a ||b** c||").
  const open = pick(rng, ["**", "__", "||", "`", "*", "~~"]);
  const inner = run(rng, secret, 1 + Math.floor(rng() * 5), depth + 1);
  const closeRoll = rng();
  const close = closeRoll < 0.7 ? open : closeRoll < 0.85 ? pick(rng, MARKERS) : "";
  return open + inner + close;
}

function run(rng, secret, count, depth) {
  let out = "";
  for (let i = 0; i < count; i += 1) out += token(rng, secret, depth);
  return out;
}

// A body: short most of the time, capped-length 1 in 6 (sliced to the cap,
// which may itself split a surrogate pair — also adversarial).
export function generateBody(rng) {
  const secret = makeSecrets();
  const capped = rng() < 1 / 6;
  if (!capped) return run(rng, secret, 1 + Math.floor(rng() * 60), 0);
  let out = "";
  while (out.length < BODY_CAP) out += run(rng, secret, 50, 0);
  return out.slice(0, BODY_CAP);
}

// Pathological capped bodies: one marker shape repeated to the cap.
export const PATHOLOGICAL_UNITS = [
  "*", "**", "`", "[", "~", "~~", "|", "||", "@a ", "[](", "[a](", "*`[~", "**a", "||a", "![",
  "_", "@", " @", "a@", "]", ")", "(", "[a]", "\u{1F600}", "*a", "`a", "||\n", "- ||",
];
export const pathologicalBody = (unit, length = BODY_CAP) => ("||s|| " + unit.repeat(length)).slice(0, length);

const WRAP = { CODE: "`", STRONG: "**", DEL: "~~", EM: "*", SPAN: "||" };
const SAFE_LINK = /^(https?:\/\/|\/(?!\/))/i;

// Property 1 + 2: walking the rendered nodes in order must rebuild the run
// exactly, each element adding back only its own markers; every href comes
// from an allowed scheme (or is a word-only /users/ mention path).
// Returns null when the run holds, else a description of the first fault.
export function checkConservation(input, nodes) {
  let cursor = 0;
  const expect = (piece, what) => {
    if (input.startsWith(piece, cursor)) {
      cursor += piece.length;
      return null;
    }
    return `${what} at ${cursor}: expected ${JSON.stringify(piece)}`;
  };
  for (const node of nodes) {
    let fault;
    if (node.nodeType === 3) {
      fault = expect(node.textContent, "text");
    } else if (node.tagName in WRAP) {
      const mark = WRAP[node.tagName];
      fault = expect(mark + node.textContent + mark, node.tagName);
    } else if (node.tagName === "A" && node.className === "mention") {
      const handle = node.textContent.slice(1);
      if (!/^[A-Za-z0-9_]+$/.test(handle) || node.href !== "/users/" + handle) return `bad mention ${node.href}`;
      if (cursor > 0 && /[A-Za-z0-9_]/.test(input[cursor - 1])) return `mention glued to a word at ${cursor}`;
      fault = expect(node.textContent, "mention");
    } else if (node.tagName === "A") {
      const href = String(node.href);
      if (!SAFE_LINK.test(href) || /[\t\n\r\\]/.test(href)) return `unsafe href ${JSON.stringify(href)}`;
      fault = expect("[" + node.textContent + "](", "link");
      if (!fault) {
        const close = input.indexOf(")", cursor);
        if (close === -1 || input.slice(cursor, close).trim() !== href) return `href drift at ${cursor}`;
        cursor = close + 1;
      }
    } else {
      return `unexpected node ${node.tagName}`;
    }
    if (fault) return fault;
  }
  return cursor === input.length ? null : `lost tail from ${cursor} of ${input.length}`;
}

// The post page's inline runs (render.js renderBodyBlocks): paragraphs and
// headings join their lines; list items and quote lines run alone; code
// fences never parse.
export function inlineRunsOf(blocks) {
  const runs = [];
  for (const block of blocks) {
    if (block.kind === "code") continue;
    if (block.kind === "list" || block.kind === "quote") runs.push(...block.text);
    else runs.push(block.text.join("\n"));
  }
  return runs;
}

// Secret characters that render inside a spoiler span of these nodes.
export function spoilerSecrets(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.tagName === "SPAN" && /\bspoiler\b/.test(node.className)) {
      for (const ch of node.textContent) if (isSecret(ch)) out.push(ch);
    }
  }
  return out;
}

// A comparable shape of rendered nodes (for old-vs-new equivalence).
export const shapeOf = (nodes) => nodes.map((node) => (node.nodeType === 3
  ? ["#text", node.textContent]
  : [node.tagName, node.textContent, node.href ?? null, node.className, node.getAttribute("rel"), node.getAttribute("target")]));
