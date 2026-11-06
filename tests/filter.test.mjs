// Word-filter bypass hardening (v3.1): pins the exact pass (v2.5 semantics)
// plus the skeleton, scramble, stitching, and regex passes. Every mechanism
// is exercised with SYNTHETIC words only — the real FILTERED_WORDS value is
// private and never lives in this repo, and no committed file carries real
// filtered vocabulary.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWordFilter,
  containsFilteredWord,
  normalizeUsernameForFilter,
} from "../api/filter.mjs";

// Synthetic stand-ins: badword (main entry), heck, darn, apple (doubled p —
// pins run-holding), scrub, and a multi-word entry.
const LIST = "badword,heck,darn,apple,scrub,bad word";
// A second list carrying regex entries (and one malformed one to pin that a
// bad pattern never breaks the filter).
const REGEX_LIST = "badword,/sc\\s*u\\s*b+/,/[/";

test("exact pass: case folds, whole words mask, length preserved", () => {
  assert.equal(applyWordFilter("this is badword!", LIST), "this is #######!");
  assert.equal(applyWordFilter("HeCk yeah", LIST), "#### yeah");
  assert.equal(applyWordFilter("darn DARN DaRn", LIST), "#### #### ####");
  // Multi-word entries match their interiors literally.
  assert.equal(applyWordFilter("a bad word here", LIST), "a ######## here");
});

test("exact pass: unset or empty secret is a strict no-op", () => {
  assert.equal(applyWordFilter("badword", ""), "badword");
  assert.equal(applyWordFilter("badword", "   "), "badword");
  assert.equal(applyWordFilter("badword", null), "badword");
});

test("skeleton pass: leet digits and symbols mask", () => {
  assert.equal(applyWordFilter("badw0rd", LIST), "#######");
  assert.equal(applyWordFilter("d@rn it", LIST), "#### it");
  assert.equal(applyWordFilter("5crub", LIST), "#####");
});

test("skeleton pass: soft separators stitch within a token", () => {
  assert.equal(applyWordFilter("bad_w0rd", LIST), "########");
  assert.equal(applyWordFilter("b.a.d.w.o.r.d", LIST), "#############");
  // The hyphen drops out of the skeleton, so "he-ck" reads "heck".
  assert.equal(applyWordFilter("ullhe-ck", LIST), "ull#####");
});

test("skeleton pass: zero-width and homoglyph injections mask", () => {
  // The zero-width char sits inside the matched span, so it masks too.
  assert.equal(applyWordFilter("badw​ord", LIST).slice(0, 4), "####");
  assert.equal(applyWordFilter("badw​ord", LIST).length, "badw​ord".length);
  assert.equal(applyWordFilter("badwôrd", LIST), "#######");
  // Cyrillic homoglyph 'о' (U+043E) reads as a Latin o.
  assert.equal(applyWordFilter("badwоrd", LIST), "#######");
});

test("skeleton pass: elongation matches, doubled entry letters are held", () => {
  assert.equal(applyWordFilter("scruuub", LIST), "#######");
  assert.equal(applyWordFilter("daaarn", LIST), "######");
  // The doubled p is the word: three-or-more p mask, "aple" never does.
  assert.equal(applyWordFilter("appple", LIST), "######");
  assert.equal(applyWordFilter("apple", LIST), "#####");
  assert.equal(applyWordFilter("aple pie", LIST), "aple pie");
});

test("skeleton pass: compounds mask via substring (aggressive by design)", () => {
  assert.equal(applyWordFilter("coolscrub", LIST), "cool#####");
  assert.equal(applyWordFilter("badwords", LIST), "#######s");
  // The documented trade-off the owner accepted: innocent carriers mask too.
  assert.equal(applyWordFilter("applesauce", LIST), "#####sauce");
});

test("scramble pass: one deleted character still matches 4+ letter entries", () => {
  // "badsword" loses its "s" and contains "badword".
  assert.equal(applyWordFilter("badsword", LIST), "########");
  // Delete-1 can chain with elongation: "badsdword" drops a "d" to
  // "baddword", whose double d the elongation pattern absorbs.
  assert.equal(applyWordFilter("badsdword", LIST), "#########");
  // Two deletions needed ("apxsple" vs "apple") stay a word-list matter.
  assert.equal(applyWordFilter("apxsple", LIST), "apxsple");
  assert.equal(applyWordFilter("password", LIST), "password");
});

test("stitching pass: letter-per-word runs mask, real words break runs", () => {
  assert.equal(applyWordFilter("b a d w o r d", LIST), "#############");
  // Elongation inside a stitched run: "a pp l e" → "appple" → "apple".
  assert.equal(applyWordFilter("a pp l e", LIST), "########");
  // Only the tokens the match actually spans — never the words before it.
  assert.equal(applyWordFilter("i am b a d w o r d", LIST), "i am #############");
  // A multi-letter real word breaks the run: "land" keeps "is land" from
  // ever stitching into "island".
  assert.equal(applyWordFilter("the is land there", LIST), "the is land there");
  // Documented trade: two-letter words DO stitch, so "i am ok" masks via an
  // "amok" entry if the owner lists one (over-mask direction, accepted).
  assert.equal(applyWordFilter("i am ok", LIST + ",amok"), "i #####");
});

test("regex pass: slash-wrapped entries run against original and skeleton", () => {
  // Against the lowercased original: the pattern spans spaces as written.
  assert.equal(applyWordFilter("sc u b today", REGEX_LIST), "###### today");
  // Against the normalized skeleton: the leet "5" folds to "s" there, so
  // the SAME pattern catches what the folded original cannot.
  assert.equal(applyWordFilter("5c u b today", REGEX_LIST), "###### today");
  // A malformed pattern is dropped, and the literal entries still work.
  assert.equal(applyWordFilter("plain badword here", REGEX_LIST), "plain ####### here");
  // And a word that is neither a literal nor a pattern hit stays visible.
  assert.equal(applyWordFilter("scrub", REGEX_LIST), "scrub");
});

test("identity checks: usernames and handles normalize through the same pipeline", () => {
  assert.equal(normalizeUsernameForFilter("b_a_d_w_o_r_d"), "badword");
  assert.equal(normalizeUsernameForFilter("badw0rd"), "badword");
  assert.equal(normalizeUsernameForFilter("badwоrd"), "badword"); // Cyrillic о
  assert.equal(normalizeUsernameForFilter("badw​ord"), "badword"); // zero-width
  // Elongation patterns run on handles: "theapplee" matches "apple".
  assert.equal(containsFilteredWord(normalizeUsernameForFilter("cool_theapplee"), LIST), true);
  assert.equal(containsFilteredWord(normalizeUsernameForFilter("helloworld"), LIST), false);
});

test("regex entries compile exactly as written (case preserved)", () => {
  // A capital-bearing pattern previously degraded to lowercase before
  // compile; now the body reaches RegExp verbatim and matching stays
  // case-insensitive, so explicit caps still mask the folded original.
  const CAPS_LIST = "/SC\\s*u\\s*b+/";
  assert.equal(applyWordFilter("sc u b today", CAPS_LIST), "###### today");
  // Pattern-level capitals cannot be mangled: an explicit character range
  // keeps its bounds.
  const RANGE_LIST = "/[Q-Z]ug/";
  assert.equal(applyWordFilter("a tug today", RANGE_LIST), "a ### today");
  // Identity fields run the same compiled patterns (case-insensitively), so
  // a handle built from a pattern hit is rejected too.
  assert.equal(containsFilteredWord("cool_scub123", CAPS_LIST), true);
  assert.equal(containsFilteredWord("innocent", CAPS_LIST), false);
});

test("bare regex entries (no slashes) compile as patterns", () => {
  // A lookaround-bearing entry — previously an inert literal — now masks.
  const BARE_LIST = "(?<!x)zab";
  assert.equal(applyWordFilter("say zab now", BARE_LIST), "say ### now");
  assert.equal(applyWordFilter("say xzab now", BARE_LIST), "say xzab now");
  // Character classes and quantifiers ride along unmodified.
  assert.equal(applyWordFilter("zebra", "ze\\w+ra"), "#####");
});

test("glob entries: plain * wildcards, everything else literal", () => {
  const GLOB_LIST = "*zippet*,bibi*,*igga";
  // Wildcards become \S* — they never span whitespace, so only the matched
  // run masks, never the sentence it sits in.
  assert.equal(applyWordFilter("go zippet dot com now", GLOB_LIST), "go ###### dot com now");
  assert.equal(applyWordFilter("bibilove now", GLOB_LIST), "######## now");
  // Dots are literal in globs: only the real site name matches (16 chars).
  assert.equal(applyWordFilter("visit docs.example.com today", "*docs.example.com*"),
    "visit ################ today");
  assert.equal(applyWordFilter("visit docsAexampleBcom today", "*docs.example.com*"),
    "visit docsAexampleBcom today");
  // A literal asterisk via \* never acts as a wildcard: "zab" alone survives.
  const ESCAPED = "/zab\\*/";
  assert.equal(applyWordFilter("cute zaba now", ESCAPED), "cute zaba now");
  assert.equal(applyWordFilter("cute zab* now", ESCAPED), "cute #### now");
});

test("newlines separate entries; escaped commas survive", () => {
  const MIX = "zab\napple,apple\nbanana,qu\\,x";
  // Newline-separated entry is its own word (not folded into a comma blob).
  assert.equal(applyWordFilter("a banana ripens", MIX), "a ###### ripens");
  // \, keeps a literal comma inside the entry (4 characters).
  assert.equal(applyWordFilter("hey qu,x now", MIX), "hey #### now");
  assert.equal(applyWordFilter("hey quux now", MIX), "hey #### now");
});

test("astral escapes normalize to the u-flag brace form", () => {
  // \u + five hex digits was unencodable in JS before; the compiler
  // rewrites it to \u{1F600} and adds the u flag. Synthetic emoji (grin).
  const EMOJI_LIST = "\\u1F600";
  assert.equal(applyWordFilter("hi \u{1F600}", EMOJI_LIST), "hi ##");
});

test("masked output always keeps the original length", () => {
  for (const body of [
    "b a d w o r d", "badw0rd", "badsword", "badw​ord", "daaarn",
    "coolscrub", "ullhe-ck", "the is land there", "HeCk", "5c u b today",
  ]) {
    assert.equal(applyWordFilter(body, LIST).length, body.length);
    assert.equal(applyWordFilter(body, REGEX_LIST).length, body.length);
  }
});
