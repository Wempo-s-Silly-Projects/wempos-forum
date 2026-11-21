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

// Wave i18n: a small JavaScript literal scanner for the no-copy sweep. It
// walks comments, strings, template literals (with nested ${} code) and regex
// literals, and returns each string/template literal with its line number.
// Template interpolations are replaced by "\u0000" in the returned text.

const REGEX_PRECEDERS = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "new", "delete",
  "void", "throw", "yield", "await", "instanceof",
]);

export function scanLiterals(source) {
  const literals = [];
  let index = 0;
  let line = 1;
  const braceStack = []; // one counter per open template expression
  let lastSignificant = "";
  let lastWord = "";

  const advance = () => {
    if (source[index] === "\n") line += 1;
    index += 1;
  };

  const readQuoted = (quote) => {
    const startLine = line;
    advance();
    let text = "";
    while (index < source.length && source[index] !== quote) {
      if (source[index] === "\\") { text += source[index + 1] ?? ""; advance(); advance(); continue; }
      text += source[index];
      advance();
    }
    advance();
    literals.push({ kind: "string", text, line: startLine });
  };

  // Reads template text up to a closing backtick or "${"; returns true on "${".
  const readTemplateChunk = (literal) => {
    while (index < source.length) {
      const char = source[index];
      if (char === "\\") { literal.text += source[index + 1] ?? ""; advance(); advance(); continue; }
      if (char === "`") { advance(); return false; }
      if (char === "$" && source[index + 1] === "{") { advance(); advance(); literal.text += "\u0000"; return true; }
      literal.text += char;
      advance();
    }
    return false;
  };

  const templates = [];

  const readRegex = () => {
    advance();
    let inClass = false;
    while (index < source.length) {
      const char = source[index];
      if (char === "\\") { advance(); advance(); continue; }
      if (char === "\n") break;
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) { advance(); break; }
      advance();
    }
    while (/[a-z]/i.test(source[index] ?? "")) advance();
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") advance();
      continue;
    }
    if (char === "/" && next === "*") {
      advance(); advance();
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) advance();
      advance(); advance();
      continue;
    }
    if (char === '"' || char === "'") {
      readQuoted(char);
      lastSignificant = "a"; lastWord = "";
      continue;
    }
    if (char === "`") {
      const literal = { kind: "template", text: "", line };
      literals.push(literal);
      advance();
      if (readTemplateChunk(literal)) { templates.push(literal); braceStack.push(0); }
      lastSignificant = "a"; lastWord = "";
      continue;
    }
    if (char === "/") {
      if (lastSignificant === "" || REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.has(lastWord)) {
        readRegex();
        lastSignificant = "a"; lastWord = "";
        continue;
      }
    }
    if (braceStack.length > 0) {
      if (char === "{") braceStack[braceStack.length - 1] += 1;
      if (char === "}") {
        if (braceStack[braceStack.length - 1] === 0) {
          braceStack.pop();
          advance();
          const literal = templates.pop();
          if (readTemplateChunk(literal)) { templates.push(literal); braceStack.push(0); }
          lastSignificant = "a"; lastWord = "";
          continue;
        }
        braceStack[braceStack.length - 1] -= 1;
      }
    }
    if (/[A-Za-z_$]/.test(char)) {
      let word = "";
      while (/[\w$]/.test(source[index] ?? "")) { word += source[index]; advance(); }
      lastWord = word;
      lastSignificant = "a";
      continue;
    }
    if (!/\s/.test(char)) { lastSignificant = char; lastWord = ""; }
    advance();
  }
  return literals;
}

// KeyboardEvent.key names and similar platform tokens that look like words.
const PLATFORM_WORDS = new Set([
  "Enter", "Escape", "Tab", "Backspace", "Home", "End", "Shift", "Control",
  "Meta", "Alt", "Accept", "Space", "Spacebar", "Esc",
]);

// True when a literal reads like copy a member would see.
export function looksLikeCopy(literal) {
  const raw = literal.text;
  // eslint-disable-next-line no-control-regex -- strips the NUL placeholder on purpose
  const text = raw.replace(/\u0000/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(text)) return false;
  if (/^(\/|#|\.|\[|:|https?:|data:|mailto:)/.test(text)) return false;
  if (/^\(.*[a-z]{2,}.*\)$/.test(text)) return true;
  if (!/\s/.test(text)) {
    if (PLATFORM_WORDS.has(text)) return false;
    return /^[A-Z][a-z]+[.!?…:]?$/.test(text) || /[a-z][.!?…]$/.test(text) && /^[A-Z]/.test(text);
  }
  if (/[A-Z][a-z]/.test(text)) return true;
  if (/[a-z][.!?…,;:]\s|[a-z][.!?…]$|\w'\w/.test(text)) return true;
  // eslint-disable-next-line no-control-regex -- strips the NUL placeholder on purpose
  if (/^\s|\s$/.test(raw.replace(/\u0000/g, "")) && /[a-z]{2,}/.test(raw)) return true;
  if (literal.kind === "string" && /^[a-z]{2,}( [a-z]{2,})+$/.test(text)) return true;
  if (literal.kind === "template" && raw.includes("\u0000")) {
    const statics = raw.split("\u0000").join(" ");
    return /(^|\s)[a-z]{3,}(\s|$)/.test(statics) && !/[-_]/.test(statics.replace(/\s+/g, ""));
  }
  return false;
}

const SKIP_LINE = /i18n-ignore|console\.|^\s*import\s|\bfrom\s+["']|querySelector|closest\(|\.matches\(|new TypeError|new RangeError/;

export function findCopy(source) {
  const lines = source.split("\n");
  return scanLiterals(source)
    .filter((literal) => !SKIP_LINE.test(lines[literal.line - 1] ?? ""))
    .filter(looksLikeCopy);
}
