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

// Batch H: the formatting actions behind the composer toolbar, as pure plans
// ({ start, end, text, selectStart, selectEnd }: replace value[start, end)
// with text, then select) so tests own the math. Only markup the post
// renderer supports (markdown.js, listed in format-help.js) is offered.
// applyFormat carries a plan out through field-edit.js (native undo).
import { replaceFieldRange } from "./field-edit.js";

// glyph: a language-neutral marker shape (the same shapes Formatting help
// shows); labelKey: the existing format.* string that names the action.
export const FORMAT_KINDS = Object.freeze([
  { kind: "bold", glyph: "**", labelKey: "format.bold", wrap: "**", key: "b" },
  { kind: "italic", glyph: "*", labelKey: "format.italic", wrap: "*", key: "i" },
  { kind: "strike", glyph: "~~", labelKey: "format.strike", wrap: "~~" },
  { kind: "code", glyph: "`", labelKey: "format.code", wrap: "`" },
  { kind: "spoiler", glyph: "||", labelKey: "format.spoiler", wrap: "||" },
  { kind: "link", glyph: "[ ]( )", labelKey: "format.link", key: "k" },
  { kind: "quote", glyph: ">", labelKey: "format.quote", prefix: "> " },
  { kind: "list", glyph: "-", labelKey: "format.list", prefix: "- " },
  { kind: "heading", glyph: "#", labelKey: "format.heading", prefix: "# " },
  { kind: "codeBlock", glyph: "```", labelKey: "format.codeBlock" },
]);

const LINK_URL_SLOT = "https://";
const CODE_FENCE = "```";
const byKind = new Map(FORMAT_KINDS.map((entry) => [entry.kind, entry]));

function planWrap(value, start, end, wrap) {
  const selected = value.slice(start, end);
  const wrapped = value.slice(start - wrap.length, start) === wrap && value.slice(end, end + wrap.length) === wrap;
  if (wrapped && start >= wrap.length) {
    const from = start - wrap.length;
    return { start: from, end: end + wrap.length, text: selected, selectStart: from, selectEnd: from + selected.length };
  }
  const inner = start + wrap.length;
  return { start, end, text: wrap + selected + wrap, selectStart: inner, selectEnd: inner + selected.length };
}

function planPrefix(value, start, end, prefix) {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const text = value.slice(lineStart, lineEnd).split("\n").map((line) => prefix + line).join("\n");
  return { start: lineStart, end: lineEnd, text, selectStart: lineStart, selectEnd: lineStart + text.length };
}

function planLink(value, start, end) {
  const label = value.slice(start, end);
  const text = "[" + label + "](" + LINK_URL_SLOT + ")";
  if (!label) return { start, end, text, selectStart: start + 1, selectEnd: start + 1 };
  const urlStart = start + label.length + 3;
  return { start, end, text, selectStart: urlStart, selectEnd: urlStart + LINK_URL_SLOT.length };
}

function planCodeBlock(value, start, end) {
  const selected = value.slice(start, end);
  const lead = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const trail = end < value.length && value[end] !== "\n" ? "\n" : "";
  const opening = lead + CODE_FENCE + "\n";
  const text = opening + selected + "\n" + CODE_FENCE + trail;
  const inner = start + opening.length;
  return { start, end, text, selectStart: inner, selectEnd: inner + selected.length };
}

export function planFormat(value, start, end, kind) {
  const text = String(value ?? "");
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.min(text.length, Math.max(start, end));
  const entry = byKind.get(kind);
  if (!entry) return null;
  if (entry.wrap) return planWrap(text, from, to, entry.wrap);
  if (entry.prefix) return planPrefix(text, from, to, entry.prefix);
  if (kind === "link") return planLink(text, from, to);
  return planCodeBlock(text, from, to);
}

export function applyFormat(field, kind) {
  if (!field) return;
  const value = String(field.value ?? "");
  const start = Number.isInteger(field.selectionStart) ? field.selectionStart : value.length;
  const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;
  const plan = planFormat(value, start, end, kind);
  if (!plan) return;
  replaceFieldRange(field, plan.start, plan.end, plan.text, { start: plan.selectStart, end: plan.selectEnd });
}
