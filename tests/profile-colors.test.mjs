// Profile colors (any hex, v3.0.2): the normalizers are the security boundary —
// nothing user-chosen may reach the client as anything but a strict lowercase
// #rrggbb (or a legacy palette key mapped to its hex, or ""). These tests pin
// that property, plus the write-side accept/convert/reject matrix.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidHexColor,
  normalizeProfileAccent,
  normalizeBannerColor,
  normalizeProfileColorInput,
  PROFILE_ACCENTS,
  PROFILE_BANNER_COLORS,
} from "../api/core/shapers.mjs";

test("isValidHexColor accepts only strict 6-digit hex", () => {
  assert.equal(isValidHexColor("#3f8a63"), true);
  assert.equal(isValidHexColor("#ABCDEF"), true);
  assert.equal(isValidHexColor("#abc"), false); // no 3-digit shorthand
  assert.equal(isValidHexColor("3f8a63"), false); // leading # required
  assert.equal(isValidHexColor("#3f8a6"), false);
  assert.equal(isValidHexColor("#3f8a633"), false);
  assert.equal(isValidHexColor("red"), false); // no named colors
  assert.equal(isValidHexColor("rgb(1,2,3)"), false);
  assert.equal(isValidHexColor("#ff0000; } body { background: url(evil)"), false);
  assert.equal(isValidHexColor(""), false);
  assert.equal(isValidHexColor(null), false);
  assert.equal(isValidHexColor(123), false);
});

test("write side: hex passes through lowercased, legacy keys convert, junk rejects", () => {
  assert.equal(normalizeProfileColorInput("#4D8FC4", PROFILE_ACCENTS), "#4d8fc4");
  assert.equal(normalizeProfileColorInput(" #4d8fc4 ", PROFILE_ACCENTS), "#4d8fc4");
  assert.equal(normalizeProfileColorInput("forest", PROFILE_ACCENTS), "#3f8a63");
  assert.equal(normalizeProfileColorInput("", PROFILE_ACCENTS), "");
  assert.equal(normalizeProfileColorInput("green", PROFILE_BANNER_COLORS), "#397357");
  assert.equal(normalizeProfileColorInput("gold", PROFILE_BANNER_COLORS), "#8d690f"); // banner variant
  // Rejects (null): everything that is not a legacy key or strict hex.
  assert.equal(normalizeProfileColorInput("#abc", PROFILE_ACCENTS), null);
  assert.equal(normalizeProfileColorInput("javascript:alert(1)", PROFILE_ACCENTS), null);
  assert.equal(normalizeProfileColorInput("expression(x)", PROFILE_ACCENTS), null);
  assert.equal(normalizeProfileColorInput(undefined, PROFILE_ACCENTS), null);
  assert.equal(normalizeProfileColorInput(42, PROFILE_ACCENTS), null);
});

test("read side: stored hex, legacy keys, and junk all normalize safely", () => {
  assert.equal(normalizeProfileAccent("#C95F86"), "#c95f86");
  assert.equal(normalizeProfileAccent("teal"), "#3d9aa0"); // legacy key → hex
  assert.equal(normalizeProfileAccent(""), "");
  assert.equal(normalizeProfileAccent(null), "");
  assert.equal(normalizeProfileAccent(undefined), "");
  assert.equal(normalizeProfileAccent("javascript:alert(1)"), ""); // junk → ""
  assert.equal(normalizeBannerColor("plum"), "#7c5480");
  assert.equal(normalizeBannerColor("#000000"), "#000000");
  assert.equal(normalizeBannerColor("not-a-color"), "");
});
