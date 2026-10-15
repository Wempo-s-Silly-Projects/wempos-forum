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

test("does substring matching inside longer words", () => {
  assert.equal(applyWordFilter("that was badword of him", "bad"), "that was ***word of him");
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