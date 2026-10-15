// Post/reply word filter. The word list is PRIVATE: it comes from the
// FILTERED_WORDS secret (a comma-separated string; see
// config/filtered-words-template.txt) and is never imported from a source
// file. This module is the only consumer of that value.
//
// The raw comma-separated string is parsed and compiled per call, memoized by
// the raw string value in a bounded cache (the secret is static per deploy,
// so the cache almost always holds one entry). Matching is done on the
// case-folded body with literal substring search; every matched position is
// replaced by "*" translated back into the original string, so the filter is
// length-preserving for ALL inputs.
//
// Case folding is done per UTF-16 code unit (not via one String#toLowerCase
// call on the whole body) because lowercase folding can lengthen a string
// (e.g. U+0130 "İ" folds to "i" + U+0307). Folding per unit and recording,
// for every folded position, the original index it came from keeps mask
// positions aligned with the original: a match found in the folded string is
// translated back through that index map before any "*" write, so the filter
// can neither misalign, run past the end, nor change the stored length.

const COMPILE_CACHE_LIMIT = 64;
const compileCache = new Map();

function compileWordList(wordsRaw) {
  const compiled = new Set();
  for (const entry of String(wordsRaw).split(",")) {
    const word = entry.trim().toLowerCase();
    if (word) compiled.add(word);
  }
  return [...compiled];
}

function compiledWords(wordsRaw) {
  const cached = compileCache.get(wordsRaw);
  if (cached) return cached;
  const compiled = compileWordList(wordsRaw);
  if (compileCache.size >= COMPILE_CACHE_LIMIT) compileCache.clear();
  compileCache.set(wordsRaw, compiled);
  return compiled;
}

export function applyWordFilter(text, wordsRaw) {
  // Non-string text passes through unchanged by design: in production the
  // only caller hands this the output of requiredText() (always a trimmed,
  // non-empty string), and api/filter.mjs deliberately stays a pure module
  // with no HttpError dependency. The passthrough keeps the module testable
  // and cannot weaken any API validation, which happens before this call.
  // An unset/empty/whitespace-only words secret is likewise a strict no-op.
  if (typeof text !== "string" || typeof wordsRaw !== "string") return text;
  const compiled = compiledWords(wordsRaw);
  if (compiled.length === 0) return text;
  let folded = "";
  const origIndexMap = [];
  for (let i = 0; i < text.length; i++) {
    const unitFolded = text[i].toLowerCase();
    folded += unitFolded;
    for (let k = 0; k < unitFolded.length; k++) origIndexMap.push(i);
  }
  const masked = text.split("");
  for (const word of compiled) {
    let index = folded.indexOf(word);
    while (index !== -1) {
      const start = origIndexMap[index];
      const end = origIndexMap[index + word.length - 1] + 1;
      for (let position = start; position < end; position++) {
        masked[position] = "*";
      }
      index = folded.indexOf(word, index + 1);
    }
  }
  return masked.join("");
}