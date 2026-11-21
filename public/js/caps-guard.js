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

import { t } from "./i18n.js";
// Caps guard (wave 5.5 F1): when a composer's text is mostly capital letters
// a quiet note under the textarea says it can read as shouting and offers a
// one-click "Lower the caps" rewrite to sentence case, with an Undo until the
// member types again. Links, `code` and @mentions are kept exactly as typed.
// Letters without case (Chinese, Japanese, Arabic...) never count. Nothing is
// stored or sent; the text changes only when the member presses the button.

export const CAPS_GUARD_RATIO = 0.7;
export const CAPS_GUARD_MIN_LETTERS = 12;

// Odd split() slots are the kept-as-typed tokens; `i` so an upper-case
// scheme (HTTPS://...) is a link too (wave 5.8 security review).
const KEPT_TOKENS = /(https?:\/\/\S+|`[^`\n]*`|@[\w-]+)/gi;
const SENTENCE_END = /[.!?\n]/;
const LONE_I = /(^|[^\p{L}\p{N}_])i(?=$|[^\p{L}\p{N}_])/gu;

const hasCase = (ch) => ch.toLowerCase() !== ch.toUpperCase();
const plainParts = (text) => text.split(KEPT_TOKENS).filter((_, index) => index % 2 === 0);

export function isShouting(text) {
  if (typeof text !== "string" || !text) return false;
  let letters = 0;
  let upper = 0;
  for (const ch of plainParts(text).join(" ")) {
    if (!hasCase(ch)) continue;
    letters += 1;
    if (ch === ch.toUpperCase()) upper += 1;
  }
  return letters >= CAPS_GUARD_MIN_LETTERS && upper / letters >= CAPS_GUARD_RATIO;
}

// Lowers a plain run, capitalising the first cased letter of each sentence.
// Returns the new run and whether the next run still starts a sentence.
function sentenceCaseRun(run, startsSentence) {
  let atStart = startsSentence;
  let out = "";
  for (const ch of run.toLowerCase()) {
    if (atStart && hasCase(ch)) {
      out += ch.toUpperCase();
      atStart = false;
    } else {
      out += ch;
      if (SENTENCE_END.test(ch)) atStart = true;
      else if (!/\s/.test(ch)) atStart = false;
    }
  }
  return { text: out.replace(LONE_I, "$1I"), atStart };
}

export function toSentenceCase(text) {
  const parts = String(text ?? "").split(KEPT_TOKENS);
  let atStart = true;
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      atStart = false;
      return part;
    }
    const result = sentenceCaseRun(part, atStart);
    atStart = result.atStart;
    return result.text;
  }).join("");
}

const makeButton = (document, className, label) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
};

export function createCapsGuard(bodyField, document) {
  const note = document.createElement("div");
  note.className = "caps-guard";
  note.setAttribute("role", "status");
  note.hidden = true;
  const text = document.createElement("span");
  text.className = "caps-guard-text";
  const fix = makeButton(document, "button button-quiet caps-guard-fix", t("capsGuard.fix"));
  const undo = makeButton(document, "button button-quiet caps-guard-undo", t("capsGuard.undo"));
  undo.hidden = true;
  note.append(text, fix, undo);

  let undoValue = null;
  let applying = false;

  const paint = () => {
    const lowered = undoValue !== null;
    const loud = !lowered && isShouting(String(bodyField.value ?? ""));
    note.hidden = !lowered && !loud;
    fix.hidden = !loud;
    undo.hidden = !lowered;
    text.textContent = lowered ? t("capsGuard.lowered") : loud ? t("capsGuard.notice") : "";
  };
  // Draft autosave and the character counter listen for input; our own
  // synthetic event must not clear the Undo it is announcing.
  const setValue = (value) => {
    bodyField.value = value;
    applying = true;
    try {
      bodyField.dispatchEvent?.(new Event("input", { bubbles: true }));
    } finally {
      applying = false;
    }
  };

  fix.addEventListener("click", () => {
    const original = String(bodyField.value ?? "");
    setValue(toSentenceCase(original));
    undoValue = original;
    paint();
    bodyField.focus?.();
  });
  undo.addEventListener("click", () => {
    if (undoValue === null) return;
    const original = undoValue;
    undoValue = null;
    setValue(original);
    paint();
    bodyField.focus?.();
  });
  bodyField.addEventListener("input", () => {
    if (applying) return;
    undoValue = null;
    paint();
  });
  paint();
  return note;
}
