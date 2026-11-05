// Post/reply word filter. The word list is PRIVATE: it comes from the
// FILTERED_WORDS secret (a comma-separated string; see
// config/filtered-words-template.txt) and is never imported from a source
// file. This module is the only consumer of that value.
//
// Masking writes "#" over the ORIGINAL characters it accepts, so the filter
// is length-preserving for ALL inputs (skipped occurrences leave their
// characters untouched, an accepted match never changes the stored length).
// Every pass writes into the same buffer; a character can only be masked,
// never revealed.
//
//   1. EXACT pass (v2.5, unchanged): case-folded literal search where only
//      WHOLE-WORD occurrences mask — an occurrence counts when the characters
//      immediately before and after it — checked in the ORIGINAL text — are
//      not [A-Za-z0-9] (or when it touches the text's start/end). Underscore
//      counts as a boundary, so username-style "smart_ass" still matches the
//      entry "ass". Multi-word entries match their interiors literally.
//      ("LMFAO" folds to "lmfao" and masks if listed.)
//
//   2. SKELETON pass (v3.1, bypass hardening): each whitespace-delimited
//      token is reduced to a normalized skeleton — zero-width characters
//      dropped, accents/fullwidth folded via NFKD with combining marks
//      stripped, Latin-lookalike homoglyphs mapped, leet digits/symbols
//      mapped (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b, 9→g, @→a, $→s), every
//      other soft separator (punctuation, hyphens, underscores, unmapped
//      digits) dropped, letters only. Inside a token, an entry matches as a
//      plain SUBSTRING (so "badass", "smartass", "hasss", "ullshi-t" all
//      mask via the entries they contain) OR through an ELONGATION-TOLERANT
//      pattern: each single entry letter matches one-or-more of itself, and
//      a doubled entry letter (the "ss" of "ass", the "gg" of "nigger")
//      matches two-or-more — so "wooord", "bittch", "fucckk", and
//      letter-bomb elongations all match WITHOUT the pattern ever matching
//      something SHORTER than the entry ("as" never matches "ass").
//
//   3. SCRAMBLE tolerance (v3.1): a token with no direct hit is also tested
//      with each single character deleted, against entries of 4+ letters —
//      "fusckers" loses its "s" and contains "fuck", "DIsCK" folds and loses
//      its "s" to "dick". One deletion only; two-character scrambles
//      ("Ponussy") stay a word-list matter.
//
//   4. STITCHING pass (v3.1): consecutive tokens whose skeletons are at most
//      TWO characters ("b a d", "fu c c kk", "fu u c c k k") are
//      concatenated and matched with the same substring + elongation rules,
//      masking only the tokens the match actually spans. Multi-character
//      tokens never stitch, so "the pen is mightier" cannot false-positive —
//      the pen/is boundary is a real word boundary, not obfuscation.
//
// Known deliberate limits (all over-mask-safe, all word-list matters):
// mid-sentence letter-spam spanning longer words ("f u sck ers") is left to
// text auto-mod (api/textmod.mjs) and the human desk; two-character
// scrambles and variant spellings ("fuk", "asf") must be listed to match.
//
// Case folding is done per UTF-16 code unit (not via one String#toLowerCase
// call on the whole body) because lowercase folding can lengthen a string
// (e.g. U+0130 "İ" folds to "i" + U+0307). The exact pass records, for every
// folded position, the original index it came from, keeping mask positions
// aligned with the original. The skeleton passes map every skeleton
// character back to an original-character span the same way.

const COMPILE_CACHE_LIMIT = 64;
const compileCache = new Map();

// Zero-width and invisible characters contribute nothing anywhere — the
// cheapest and most common injection bypass ("w​ord" looks like "word").
const INVISIBLE_UNITS = new Set(["​", "‌", "‍", "⁠", "﻿", "­"]);

// Latin-lookalike homoglyphs NFKD does not fold (Cyrillic/Greek confusables
// — the letters Unicode's own confusables registry lists as most abused).
const HOMOGLYPHS = {
  "а": "a", // Cyrillic а
  "е": "e", // е
  "о": "o", // о
  "р": "p", // р
  "с": "c", // с
  "у": "y", // у
  "х": "x", // х
  "і": "i", // і
  "ѕ": "s", // ѕ
  "ј": "j", // ј
  "ι": "i", // Greek ι
  "ο": "o", // Greek ο
};

// Leet map shared by the skeleton passes and the username normalizer.
const LEET_UNITS = {
  "@": "a", "$": "s",
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
};

// One ORIGINAL UTF-16 unit → the lowercase ASCII letters it contributes to a
// skeleton (possibly zero, possibly several — NFKD folds ligatures like ﬃ
// into multiple letters). Anything that is not [a-z] after the fold maps
// contributes nothing and acts as a soft separator.
function normalizeUnitForSkeleton(unit) {
  if (INVISIBLE_UNITS.has(unit)) return "";
  let lowered = unit.toLowerCase();
  if (lowered.charCodeAt(0) > 0x7f) {
    // NFKD: folds accents (ö → o + U+0308) and fullwidth/compatibility forms
    // (Ａ → A, ﬃ → ffi); the combining-mark strip then removes the residue.
    let decomposed = "";
    for (const part of lowered.normalize("NFKD")) {
      const code = part.charCodeAt(0);
      if (code >= 0x0300 && code <= 0x036f) continue; // combining mark
      decomposed += part;
    }
    decomposed = [...decomposed].map((part) => HOMOGLYPHS[part] || part).join("");
    lowered = decomposed.toLowerCase();
  }
  let mapped = "";
  for (const part of lowered) mapped += LEET_UNITS[part] || part;
  let letters = "";
  for (const part of mapped) {
    if (part >= "a" && part <= "z") letters += part;
  }
  return letters;
}

// The normalized form of one filter-list entry: the same unit pipeline with
// spaces dropped, so a multi-word entry matches its stitched single-token
// form ("bad word" the entry still catches the natural phrase via the exact
// pass and "b_a_d word"/"badword" via the skeleton passes).
function normalizeEntryForSkeleton(entry) {
  let out = "";
  for (const unit of String(entry).toLowerCase()) {
    if (/\s/.test(unit)) continue;
    out += normalizeUnitForSkeleton(unit);
  }
  return out;
}

// Elongation-tolerant pattern for one normalized entry: every single letter
// matches one-or-more of itself ("fuck" matches "fuuuck"), and a run of n≥2
// identical letters matches n-or-more ("ass" matches "asss" but never "as";
// "nigger" matches "niggggger" but never "niger" — the run is the word).
// Letters only, so no regex metacharacters can appear unescaped.
function elongationPattern(skeleton) {
  let pattern = "";
  let index = 0;
  while (index < skeleton.length) {
    const letter = skeleton[index];
    let run = 1;
    while (index + run < skeleton.length && skeleton[index + run] === letter) run += 1;
    pattern += run >= 2 ? letter + "{" + run + ",}" : letter + "+";
    index += run;
  }
  return pattern ? new RegExp(pattern) : null;
}

// REGEX entries (v3.1, owner's ask): an entry wrapped in slashes —
// "/fu\s*(u|c)+k/" — compiles as a pattern instead of a literal word. Each
// regex runs against BOTH the lowercased original text and the normalized
// skeleton (spaces intact, soft separators gone), so patterns can be written
// for whichever space suits them; matched ranges map back to original
// characters and mask like any other hit. The list is comma-separated, so a
// pattern cannot contain a literal comma — write \x2c for one. An invalid or
// catastrophically complex pattern is the owner's risk: compilation errors
// drop the entry (never the whole filter), but a pathological pattern can
// still burn CPU — keep them simple.
function compileRegexEntry(word) {
  const match = word.match(/^\/(.+)\/([a-z]*)$/);
  if (!match) return null;
  try {
    // Always global — every occurrence masks. "g" stripped first so it is
    // never doubled ("gi" + "g" would throw).
    const flags = (match[2] || "").replace(/g/g, "") + "g";
    return new RegExp(match[1], flags);
  } catch {
    return null;
  }
}

function compileFilter(wordsRaw) {
  const words = [];
  const entries = [];
  const regexes = [];
  const seen = new Set();
  for (const entry of String(wordsRaw).split(",")) {
    const word = entry.trim().toLowerCase();
    if (!word) continue;
    const regex = compileRegexEntry(word);
    if (regex) {
      regexes.push(regex);
      continue;
    }
    words.push(word);
    const skeleton = normalizeEntryForSkeleton(word);
    // Substring matching with fewer than two letters would mask half the
    // dictionary ("a" alone); the exact pass still handles 1-letter entries.
    if (skeleton.length < 2 || seen.has(skeleton)) continue;
    seen.add(skeleton);
    entries.push({ skeleton, regex: elongationPattern(skeleton) });
  }
  return { words, entries, regexes };
}

function compiledFilter(wordsRaw) {
  const cached = compileCache.get(wordsRaw);
  if (cached) return cached;
  const compiled = compileFilter(wordsRaw);
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

// The skeleton of the whole text: lowercase ASCII letters only, with original
// WHITESPACE preserved as " " separators (the one boundary the skeleton
// passes respect — soft separators stitch within a token, real words stay
// words). spans[i] is the original-character range [start, end) that
// produced skeleton[i]; a separator position carries null.
function buildSkeleton(text) {
  const chars = [];
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    const unit = text[i];
    if (/\s/.test(unit)) {
      chars.push(" ");
      spans.push(null);
      continue;
    }
    const letters = normalizeUnitForSkeleton(unit);
    if (!letters) continue; // soft separator: stitches within a token
    for (const letter of letters) {
      chars.push(letter);
      spans.push([i, i + 1]);
    }
  }
  return { skeleton: chars.join(""), spans };
}

// Masks every original character from `start` to `end` (exclusive).
function maskSpan(masked, start, end) {
  for (let position = start; position < end; position++) {
    masked[position] = "#";
  }
}

// One entry's hit range inside a skeleton string, or null. Plain substring
// first (compounds: "badass" contains "ass"), then the elongation pattern
// ("wooord" matches "word"). Both run over the SAME skeleton the caller
// built, so the returned range indexes that string.
function findEntryRange(haystack, entry) {
  const direct = haystack.indexOf(entry.skeleton);
  if (direct !== -1) return [direct, direct + entry.skeleton.length];
  const match = entry.regex && entry.regex.exec(haystack);
  if (match) return [match.index, match.index + match[0].length];
  return null;
}

// Scramble tolerance: every delete-one variant of the haystack, against
// entries of 4+ letters. Returns [hitStart, hitEnd, deletedIndex] in
// HAYSTACK index space (the deleted position already re-expanded), or null.
// One deletion catches the single-character insertions people actually use
// ("fusckers", "DIsCK"); two-character scrambles are a word-list matter.
function findScrambledRange(haystack, entries) {
  if (haystack.length < 5) return null; // nothing worth deleting from
  for (let deleted = 0; deleted < haystack.length; deleted++) {
    const variant = haystack.slice(0, deleted) + haystack.slice(deleted + 1);
    for (const entry of entries) {
      if (entry.skeleton.length < 4) continue;
      const range = findEntryRange(variant, entry);
      if (!range) continue;
      const start = Math.min(range[0], deleted);
      // Re-expand the part of the match that sits after the deletion.
      const end = (range[1] > deleted ? range[1] + 1 : range[1]);
      return [start, end, deleted];
    }
  }
  return null;
}

// The skeleton passes over one token. baseIndex is the token's first
// position in the full skeleton; spans is the full skeleton's span map.
function maskTokenMatch(masked, token, entries, spans, baseIndex) {
  for (const entry of entries) {
    const range = findEntryRange(token, entry);
    if (range) {
      maskSpan(masked, spans[baseIndex + range[0]][0], spans[baseIndex + range[1] - 1][1]);
      return;
    }
  }
  const scrambled = findScrambledRange(token, entries);
  if (scrambled) {
    maskSpan(masked, spans[baseIndex + scrambled[0]][0], spans[baseIndex + scrambled[1] - 1][1]);
  }
}

// Passes 2–4: skeleton matching, scramble tolerance, and cross-token
// stitching, all writing into the shared mask buffer. Regex entries also
// run over the skeleton here (they ran over the folded original in
// applyWordFilter).
function applySkeletonPasses(masked, text, entries, regexes) {
  if (entries.length === 0 && regexes.length === 0) return;
  const { skeleton, spans } = buildSkeleton(text);
  if (!skeleton) return;

  // Regex entries against the normalized skeleton — the space where "fu c c
  // kk"-style spacing still exists but leet/soft separators are gone, so a
  // pattern like /fu\s*(u|c)+k/ spans both shapes.
  for (const pattern of regexes) {
    let match = pattern.exec(skeleton);
    while (match) {
      maskSpan(masked, spans[match.index][0], spans[match.index + match[0].length - 1][1]);
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1; // no zero-length loops
      match = pattern.exec(skeleton);
    }
  }

  // Token walk: [start, end) skeleton indexes of each whitespace-delimited
  // token, in order. Short tokens (≤2 skeleton chars) also feed the
  // stitching runs.
  const tokens = [];
  let index = 0;
  while (index < skeleton.length) {
    while (index < skeleton.length && skeleton[index] === " ") index++;
    if (index >= skeleton.length) break;
    const start = index;
    while (index < skeleton.length && skeleton[index] !== " ") index++;
    tokens.push({ start, end: index });
  }

  for (const token of tokens) {
    maskTokenMatch(masked, skeleton.slice(token.start, token.end), entries, spans, token.start);
  }

  // Stitching: runs of consecutive short tokens concatenate ("b a d" →
  // "bad"; "fu u c c k k" → "fuucckk", whose elongation pattern for "fuck"
  // matches). A multi-character token breaks the run — "pen is" can never
  // become "penis" because "pen" is three skeleton characters of real word.
  let runStart = 0;
  while (runStart < tokens.length) {
    let runEnd = runStart;
    while (runEnd < tokens.length && tokens[runEnd].end - tokens[runEnd].start <= 2) runEnd += 1;
    if (runEnd - runStart >= 2) {
      const run = tokens.slice(runStart, runEnd);
      const stitched = run.map((token) => skeleton.slice(token.start, token.end)).join("");
      for (const entry of entries) {
        const range = findEntryRange(stitched, entry);
        if (!range) continue;
        // Only the tokens the match actually spans get masked — "i am b a d"
        // masks "b a d", never the innocent words before it.
        const prefixLengths = run.map((token) => token.end - token.start);
        let cursor = 0;
        let tokenAt = 0;
        while (tokenAt < run.length && cursor + prefixLengths[tokenAt] <= range[0]) {
          cursor += prefixLengths[tokenAt];
          tokenAt += 1;
        }
        let endAt = tokenAt;
        let endCursor = cursor;
        while (endAt < run.length && endCursor < range[1]) {
          endCursor += prefixLengths[endAt];
          endAt += 1;
        }
        maskSpan(masked,
          spans[run[tokenAt].start][0],
          spans[run[Math.min(endAt, run.length) - 1].end - 1][1]);
        break;
      }
    }
    runStart = Math.max(runEnd, runStart + 1);
  }
}

export function applyWordFilter(text, wordsRaw) {
  // Non-string text passes through unchanged by design: in production the
  // only caller hands this the output of requiredText() (always a trimmed,
  // non-empty string), and api/filter.mjs deliberately stays a pure module
  // with no HttpError dependency. The passthrough keeps the module testable
  // and cannot weaken any API validation, which happens before this call.
  // An unset/empty/whitespace-only words secret is likewise a strict no-op.
  if (typeof text !== "string" || typeof wordsRaw !== "string") return text;
  const compiled = compiledFilter(wordsRaw);
  if (compiled.words.length === 0) return text;
  let folded = "";
  const origIndexMap = [];
  for (let i = 0; i < text.length; i++) {
    const unitFolded = text[i].toLowerCase();
    folded += unitFolded;
    for (let k = 0; k < unitFolded.length; k++) origIndexMap.push(i);
  }
  const masked = text.split("");
  // Pass 1 — exact whole-word masking (v2.5 behavior, byte for byte).
  for (const word of compiled.words) {
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
          masked[position] = "#";
        }
      }
      index = folded.indexOf(word, index + 1);
    }
  }
  // Regex entries against the lowercased original text (the same folded
  // string the exact pass reads, with the same original-index map, so
  // pattern matches mask exactly the characters they matched). A pattern
  // author controls word boundaries with \b — the exact pass's whole-word
  // rule never applies here.
  for (const pattern of compiled.regexes) {
    let match = pattern.exec(folded);
    while (match) {
      const start = origIndexMap[match.index];
      const end = origIndexMap[match.index + match[0].length - 1] + 1;
      maskSpan(masked, start, end);
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1; // no zero-length loops
      match = pattern.exec(folded);
    }
  }
  // Passes 2–4 — bypass hardening (v3.1), plus the regex entries' skeleton
  // run.
  applySkeletonPasses(masked, text, compiled.entries, compiled.regexes);
  return masked.join("");
}

// Username-filter hardening (v2.5, extended in v3.1): usernames and social
// handles are identity, not prose — their check is stricter than masking: the
// register flow rejects when the masked form does not survive intact OR this
// normalized form contains an entry. This normalizer runs the full skeleton
// pipeline (zero-width, NFKD accent/fullwidth folds, homoglyphs, leet) and
// strips every remaining non-letter, so "p_e_n_i_s", "pen1s", "pеnis"
// (Cyrillic е) and "p​enis" all normalize to the same thing. The companion
// containsFilteredWord also runs each entry's elongation pattern, so
// "thebittch" in a handle matches the entry "bitch".
export function normalizeUsernameForFilter(value) {
  let out = "";
  for (const unit of String(value ?? "").toLowerCase()) {
    if (INVISIBLE_UNITS.has(unit)) continue;
    out += normalizeUnitForSkeleton(unit);
  }
  return out;
}

export function containsFilteredWord(text, wordsRaw) {
  if (typeof wordsRaw !== "string" || !wordsRaw.trim()) return false;
  const lowered = String(text ?? "").toLowerCase();
  const compiled = compiledFilter(wordsRaw);
  // Raw entries against the (already-normalized) input, then normalized
  // entries — an owner who lists a leet form ("p3nis") still matches the
  // fully-normalized username ("penis") — then each entry's elongation
  // pattern ("thebittch" matches "bitch").
  for (const piece of compiled.words) {
    if (lowered.includes(piece)) return true;
  }
  for (const entry of compiled.entries) {
    if (lowered.includes(entry.skeleton)) return true;
    if (entry.regex && entry.regex.test(lowered)) return true;
  }
  for (const pattern of compiled.regexes) {
    // Global regexes carry lastIndex state between calls — reset before every
    // test so a hit earlier in one string can never hide a hit later.
    pattern.lastIndex = 0;
    if (pattern.test(lowered)) return true;
  }
  return false;
}
