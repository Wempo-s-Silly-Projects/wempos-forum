// Unit tests for applyWordFilter (api/filter.mjs), the post/reply word mask.
// The word list arrives as the raw comma-separated FILTERED_WORDS secret
// string (e.g. "bad, ugly"); an unset or empty secret is a no-op.
import test from "node:test";
import assert from "node:assert/strict";
import { applyWordFilter } from "../api/filter.mjs";

test("masks words case-insensitively anywhere in the body", () => {
  assert.equal(applyWordFilter("the badword strikes", "badword"), "the ******* strikes");
  assert.equal(applyWordFilter("the BadWord strikes", "badword"), "the ******* strikes");
  assert.equal(applyWordFilter("the BaDwOrD strikes", "badword"), "the ******* strikes");
  assert.equal(applyWordFilter("a bad word here", "bad word"), "a ******** here");
});

test("masks repeated occurrences of the same word", () => {
  assert.equal(applyWordFilter("bad bad bad", "bad"), "*** *** ***");
  assert.equal(applyWordFilter("BAd and bad and baD", "bad"), "*** and *** and ***");
});

test("preserves length exactly for every match and non-match", () => {
  const inputs = [
    "plain text with nothing to mask here",
    "bad at the start",
    "end with bad",
    "surrounded ***bad*** by stars",
    "b-ad-b",
  ];
  for (const input of inputs) {
    const output = applyWordFilter(input, "bad");
    assert.equal(output.length, input.length);
  }
  assert.equal(applyWordFilter("end with bad", "bad"), "end with ***");
  assert.equal(applyWordFilter("bad at the start", "bad"), "*** at the start");
  assert.equal(applyWordFilter("surrounded ***bad*** by stars", "bad"), "surrounded ********* by stars");
});

test("does not match inside longer words (whole-word rule)", () => {
  // Updated from the old substring semantics: since whole-word matching, an
  // occurrence embedded inside a longer word ("badword") is left alone, so
  // innocent words like "badword", "class", "passage" or "bass" survive.
  assert.equal(applyWordFilter("that was badword of him", "bad"), "that was badword of him");
  assert.equal(applyWordFilter("badword", "bad"), "badword");
});

test("whole-word: stand-alone occurrences are still masked in every position", () => {
  assert.equal(applyWordFilter("that ass", "ass"), "that ***");
  assert.equal(applyWordFilter("ass that", "ass"), "*** that");
  assert.equal(applyWordFilter("Ass", "ass"), "***");
});

test("whole-word: innocent words containing the entry survive untouched", () => {
  assert.equal(applyWordFilter("in class today", "ass"), "in class today");
  assert.equal(applyWordFilter("a passage of time", "ass"), "a passage of time");
  assert.equal(applyWordFilter("bass guitar", "ass"), "bass guitar");
});

test("whole-word: punctuation and underscore neighbors count as boundaries", () => {
  assert.equal(applyWordFilter("what an ass.", "ass"), "what an ***.");
  assert.equal(applyWordFilter("the (ass) plan", "ass"), "the (***) plan");
  // Deliberate: underscore counts as a boundary (it is not [A-Za-z0-9]), so
  // username-style "smart_ass" still matches the entry "ass".
  assert.equal(applyWordFilter("smart_ass", "ass"), "smart_***");
});

test("whole-word: mixed capitalization of a whole match is masked", () => {
  assert.equal(applyWordFilter("nice Ass", "ass"), "nice ***");
  assert.equal(applyWordFilter("NiceAsS", "ass"), "NiceAsS");
});

test("whole-word: multi-word entries take boundaries only at their outer edges", () => {
  // The boundary rule applies to the entry's outer edges only; the internal
  // characters of the phrase (here the space) are matched literally as before.
  assert.equal(applyWordFilter("that is a bad word", "bad word"), "that is a ********");
  assert.equal(applyWordFilter("bad wording got in", "bad word"), "bad wording got in");
  assert.equal(applyWordFilter("the badwording list", "bad word"), "the badwording list");
});

test("whole-word: non-ASCII neighbors are boundaries (only [A-Za-z0-9] continues a word)", () => {
  // Chosen behavior: the boundary set is exactly [A-Za-z0-9], so a non-ASCII
  // letter like é counts as a boundary and the occurrence is masked.
  assert.equal(applyWordFilter("caféass", "ass"), "café***");
  assert.equal(applyWordFilter("assé", "ass"), "***é");
});

test("an unset or empty words secret still leaves filter-adjacent text untouched", () => {
  assert.equal(applyWordFilter("ass class passage", undefined), "ass class passage");
  assert.equal(applyWordFilter("ass class passage", ""), "ass class passage");
});

test("masks the word when it sits at the body end and start", () => {
  assert.equal(applyWordFilter("terrible bad", "bad"), "terrible ***");
  assert.equal(applyWordFilter("bad start", "bad"), "*** start");
  assert.equal(applyWordFilter("bad", "bad"), "***");
});

test("applies every comma-separated entry in one pass", () => {
  assert.equal(applyWordFilter("alpha says omega and ALPHA again", "alpha,omega"),
    "***** says ***** and ***** again");
});

test("comma parsing ignores spaces around entries", () => {
  assert.equal(applyWordFilter("bad ugly stuff", "bad, ugly"), "*** **** stuff");
  assert.equal(applyWordFilter("bad ugly stuff", " bad ,ugly "), "*** **** stuff");
});

test("entries that are empty or whitespace-only after trimming are dropped", () => {
  assert.equal(applyWordFilter("a , b body", ",, ,"), "a , b body");
});

test("an unset, empty, or whitespace-only words secret is a strict no-op", () => {
  const samples = [
    "",
    "anything at all, including b a d spaced letters",
    "line one\nline two\ttabbed",
    "unicode: café 中文 🚀",
    "*** already starred ***",
    "BADWORD badword bad-word",
  ];
  for (const sample of samples) {
    assert.equal(applyWordFilter(sample), sample);
    assert.equal(applyWordFilter(sample, undefined), sample);
    assert.equal(applyWordFilter(sample, ""), sample);
    assert.equal(applyWordFilter(sample, "   "), sample);
    assert.equal(applyWordFilter(sample, ", ,, ,"), sample);
  }
});

test("a lengthening character (U+0130) cannot bypass masking or change length", () => {
  const output = applyWordFilter("İbad", "bad");
  assert.equal(output, "İ***");
  assert.equal(output.length, "İbad".length);
});

test("a fold-lengthening prefix cannot defeat masking of a trailing word", () => {
  const input = "İ".repeat(9) + "bad";
  const output = applyWordFilter(input, "bad");
  assert.equal(output, "İ".repeat(9) + "***");
  assert.equal(output.length, input.length);
});