// TOTP core primitives (RFC 6238): the RFC's SHA-1 test vectors, base32
// round-trips, the verifying window, and the otpauth URI shape. These are
// the acceptance pins for 2FA-only (no recovery) sign-in.
import test from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  hotpAt,
  totpAt,
  verifyTotpCode,
  otpauthUri,
  TOTP_STEP,
} from "../api/core/totp.mjs";

// RFC 4231/6238 SHA-1 seed "12345678901234567890" in base32 (no padding).
const RFC_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const RFC6238_SHA1_VECTORS = [
  // [unixTime, 8-digit expected from the RFC]
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("base32 decode matches the RFC seed's raw bytes", () => {
  assert.deepEqual(base32Decode(RFC_SEED), new TextEncoder().encode("12345678901234567890"));
});

test("base32 encode/decode round-trip and reject invalid input", () => {
  for (const length of [10, 16, 20, 32]) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
  assert.throws(() => base32Decode("abc1")); // '1' is not in the RFC 4648 alphabet
  assert.throws(() => base32Decode("A")); // dangling group
});

test("HOTP/TOTP match the RFC 6238 SHA-1 vectors", async () => {
  const seed = base32Decode(RFC_SEED);
  for (const [time, expected8] of RFC6238_SHA1_VECTORS) {
    assert.equal(await hotpAt(seed, Math.floor(time / TOTP_STEP), 8), expected8, "8-digit at t=" + time);
    assert.equal(await totpAt(RFC_SEED, time, 8), expected8, "8-digit totpAt at t=" + time);
  }
});

test("totpAt(6 digits) equals the last 6 digits of the 8-digit RFC value", async () => {
  for (const [time, expected8] of RFC6238_SHA1_VECTORS) {
    assert.equal(await totpAt(RFC_SEED, time, 6), expected8.slice(2));
  }
});

test("verifyTotpCode accepts the current code and a ±1-step neighbor, rejects the rest", async () => {
  const time = 59; // RFC vector instant
  const current = await totpAt(RFC_SEED, time);
  const before = await totpAt(RFC_SEED, time - TOTP_STEP);
  const after = await totpAt(RFC_SEED, time + TOTP_STEP);
  const far = await totpAt(RFC_SEED, time + 5 * TOTP_STEP);
  assert.equal(await verifyTotpCode(RFC_SEED, current, time), true);
  assert.equal(await verifyTotpCode(RFC_SEED, before, time), true);
  assert.equal(await verifyTotpCode(RFC_SEED, after, time), true);
  assert.equal(await verifyTotpCode(RFC_SEED, far, time), false);
  assert.equal(await verifyTotpCode(RFC_SEED, "000000", time), false);
  assert.equal(await verifyTotpCode(RFC_SEED, "12345", time), false); // wrong shape
  assert.equal(await verifyTotpCode("JBSWY3DPEHPK3PXP", current, time), false); // wrong secret
});

test("generateTotpSecret yields 160-bit secrets in unpadded base32", () => {
  for (let i = 0; i < 20; i++) {
    const secret = generateTotpSecret();
    assert.match(secret, /^[A-Z2-7]{32}$/); // 20 bytes -> 32 base32 chars, no '='
    assert.ok(base32Decode(secret).length === 20);
  }
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(generateTotpSecret());
  assert.equal(seen.size, 20);
});

test("otpauthUri carries the issuer, account, and secret", () => {
  const uri = otpauthUri("JBSWY3DPEHPK3PXP", "wempo", "someone@example.com");
  assert.equal(
    uri,
    // encodeURIComponent pct-encodes the @ (RFC 6238's own examples do not,
    // but every major authenticator parses the pct form; colons must never
    // split the label into a second key/value).
    "otpauth://totp/wempo:someone%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=wempo&algorithm=SHA1&digits=6&period=30",
  );
});
