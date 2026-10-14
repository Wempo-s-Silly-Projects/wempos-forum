import test from "node:test";
import assert from "node:assert/strict";
import { createAvatarVersion, isValidPassword, isValidUsername, SEARCH_USERS_SQL, sniffImageMime } from "../worker.mjs";

test("usernames follow the documented ASCII rules", () => {
  for (const value of ["abc", "ItsWempo", "test_user", "123456789012345678901234"]) {
    assert.equal(isValidUsername(value), true, value);
  }
  for (const value of ["ab", "has space", "with-hyphen", "a".repeat(25), "", null, 123]) {
    assert.equal(isValidUsername(value), false, String(value));
  }
});

test("password length is checked without coercing non-strings", () => {
  assert.equal(isValidPassword("0123456789ab"), true);
  assert.equal(isValidPassword("x".repeat(128)), true);
  assert.equal(isValidPassword("short"), false);
  assert.equal(isValidPassword("x".repeat(129)), false);
  assert.equal(isValidPassword(null), false);
});

test("avatar sniffing accepts supported signatures, not claimed MIME labels", () => {
  assert.equal(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), "image/png");
  assert.equal(sniffImageMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffImageMime(Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0x3e, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8])), null);
  assert.equal(sniffImageMime("not bytes"), null);
});


test("avatar versions are unique, URL-safe cache busters", () => {
  const first = createAvatarVersion();
  const second = createAvatarVersion();
  assert.match(first, /^[A-Za-z0-9_-]{16}$/);
  assert.match(second, /^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(first, second);
});

test("search user rows include avatar_version for cache-busted avatar URLs", () => {
  assert.match(SEARCH_USERS_SQL, /avatar_version/);
  assert.match(SEARCH_USERS_SQL, /LIMIT 20$/);
});
