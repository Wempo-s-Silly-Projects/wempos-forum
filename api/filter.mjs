// Post/reply word filter. The word list is PRIVATE: it comes from the
// FILTERED_WORDS secret (a comma-separated string; see
// config/filtered-words-template.txt) and is never imported from a source
// file. This module is the only consumer of that value.
//
// The raw comma-separated string is parsed and compiled per call, memoized by
// the raw string value in a bounded cache (the secret is static per deploy,
// so the cache almost always holds one entry). Matching is done on the
// case-folded body with literal search, but only WHOLE-WORD occurrences are
// masked: an occurrence counts when the characters immediately before and
// after it — checked in the ORIGINAL text — are not [A-Za-z0-9] (or when the
// occurrence touches the start/end of the text). Underscore counts as a
// boundary, so username-style "smart_ass" still matches the entry "ass" —
// deliberate. For multi-word entries the boundary rule applies only to the
// entry's outer edges; internal characters (spaces, punctuation) are matched
// literally as before, because only the two outer neighbors are ever
// inspected. Every accepted match is replaced by "*" translated back into the
// original string, so the filter is length-preserving for ALL inputs (skipped
// occurrences leave their characters untouched; an accepted match never
// changes the stored length).
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

// Whole-word boundary test on one UTF-16 code unit of the ORIGINAL text:
// exactly [A-Za-z0-9] continues a word; anything else (underscore, spaces,
// punctuation, non-ASCII letters) is a boundary. Plain range comparisons are
// exact for these ASCII ranges and deliberately treat every non-ASCII unit
// as a boundary — see tests/filter.test.mjs, which pins that choice.
function isWordUnit(unit) {
  return (unit >= "a" && unit <= "z") || (unit >= "A" && unit <= "Z") || (unit >= "0" && unit <= "9");
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
      // Whole-word check against the ORIGINAL text around the occurrence's
      // original-character span. Checking here (rather than on the folded
      // string) keeps the boundary correct for fold-lengthening characters,
      // and inspecting only the two outer neighbors means multi-word entries
      // match their interiors literally, exactly as before.
      // Tail-fold edge: an entry beginning with U+0307 could match the tail
      // (second folded unit) of a U+0130 'İ' and pass the edge checks as a
      // string-edge match — over-masking only (the safe direction), and
      // unreachable via the curated word-list template.
      const beforeOk = start === 0 || !isWordUnit(text[start - 1]);
      const afterOk = end === text.length || !isWordUnit(text[end]);
      if (beforeOk && afterOk) {
        for (let position = start; position < end; position++) {
          masked[position] = "*";
        }
      }
      index = folded.indexOf(word, index + 1);
    }
  }
  return masked.join("");
}