// Behavioral pin on the verifyPassword contract: user-typed passwords and
// stored-credential shape problems verify as false (callers keep their
// uniform generic 401, no oracle); only configuration problems throw.
import test from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword } from "../api/core/passwords.mjs";
import { HttpError } from "../api/core/http.mjs";

const PEPPER = "test-pepper".repeat(4); // 44 chars, within 32..256
const GOOD_SALT = "a".repeat(32);
const GOOD_HASH = "b".repeat(64);

test("verifyPassword round-trips a valid credential", async () => {
  const { salt, hash } = await hashPassword("correct horse battery staple", PEPPER);
  assert.equal(await verifyPassword("correct horse battery staple", salt, hash, PEPPER), true);
  assert.equal(await verifyPassword("correct horse battery staplE", salt, hash, PEPPER), false);
});

test("invalid typed password verifies as false, not a thrown 400", async () => {
  assert.equal(await verifyPassword("short", GOOD_SALT, GOOD_HASH, PEPPER), false);
  assert.equal(await verifyPassword("x".repeat(129), GOOD_SALT, GOOD_HASH, PEPPER), false);
  assert.equal(await verifyPassword(123456789012, GOOD_SALT, GOOD_HASH, PEPPER), false);
});

test("malformed stored salt or hash verifies as false, not a thrown 400", async () => {
  assert.equal(await verifyPassword("correct horse battery staple", "zz", GOOD_HASH, PEPPER), false);
  assert.equal(await verifyPassword("correct horse battery staple", null, GOOD_HASH, PEPPER), false);
  assert.equal(await verifyPassword("correct horse battery staple", GOOD_SALT, "nothex", PEPPER), false);
  assert.equal(await verifyPassword("correct horse battery staple", GOOD_SALT, null, PEPPER), false);
});

test("missing or invalid pepper still throws the configuration 503", async () => {
  await assert.rejects(
    () => verifyPassword("correct horse battery staple", GOOD_SALT, GOOD_HASH, undefined),
    (error) => error instanceof HttpError && error.status === 503,
  );
});
