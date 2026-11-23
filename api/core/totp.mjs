// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// v4.0 core leaf: TOTP (RFC 6238) — the two-factor primitives everything
// 2FA bottoms out on. Web Crypto carries the HMAC (SHA-1 is what every
// authenticator app expects for TOTP and stays the default; v5.20.0 adds
// an opt-in per-member SHA-256, RFC 6238's HMAC-SHA-256 mode); no
// dependency, no re-derivation of anything else. Imports nothing (crypto.getRandomValues only). The 2FA
// feature is verification-only: no recovery codes, no email fallback (per
// the feature spec) — losing the secret is losing the account until the
// owner intervenes, which is exactly why confirmation requires a real code.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 4648 base32 without padding (TOTP secrets are always shared bare).
export function base32Encode(bytes) {
  let output = "";
  let bits = 0;
  let buffer = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  if (typeof text !== "string" || text.length === 0 || /[^A-Z2-7]/i.test(text)) {
    throw new Error("invalid base32");
  }
  // Unpadded canonical lengths only: 5-bit groups must tile whole bytes, so
  // length mod 8 of {1,3,6} leaves bits that cannot exist in unpadded input.
  const dangling = [1, 3, 6];
  if (dangling.includes(text.length % 8)) throw new Error("invalid base32");
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of text.toUpperCase()) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
  }
  // A non-zero remainder means dangling bits — truncated secret, refuse.
  if (bits > 0 && (buffer << (8 - bits)) & 255) throw new Error("invalid base32");
  return new Uint8Array(bytes);
}

export const TOTP_STEP = 30;
export const TOTP_DIGITS = 6;

// The two algorithms a member can enroll with, mapped to their Web Crypto
// hash names. SHA1 is the default and the meaning of a missing
// totp_algorithms row (every pre-v5.20 enrollment).
const TOTP_HASHES = { SHA1: "SHA-1", SHA256: "SHA-256" };
export const TOTP_DEFAULT_ALGORITHM = "SHA1";

// Exactly "SHA256" opts in; anything else (null, a missing row, junk input)
// is SHA1 — so an unknown value can never move a member off the algorithm
// their authenticator already uses.
export function normalizeTotpAlgorithm(value) {
  return value === "SHA256" ? "SHA256" : TOTP_DEFAULT_ALGORITHM;
}

export function generateTotpSecret() {
  // 160 bits — the default secret size from RFC 4226 (same length Google
  // Authenticator's key URI guide asks for).
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

// HMAC-based one-time password at a given counter (RFC 4226, dynamic
// truncation). digits 8 lets the RFC 6238 test vectors be asserted verbatim.
export async function hotpAt(keyBytes, counter, digits = TOTP_DIGITS, algorithm = TOTP_DEFAULT_ALGORITHM) {
  if (
  !Number.isSafeInteger(counter) ||
  counter < 0 ||
  !Number.isInteger(digits) ||
  digits < 6 ||
  digits > 8
) {
  throw new RangeError("invalid HOTP parameters");
}
  const hash = TOTP_HASHES[normalizeTotpAlgorithm(algorithm)];
  const key = await crypto.subtle.importKey(
    "raw", new Uint8Array(keyBytes), { name: "HMAC", hash }, false, ["sign"],
  );
  const claim = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    claim[i] = counter & 255;
    counter = Math.floor(counter / 256);
  }
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, claim));
  const offset = digest[digest.length - 1] & 15;
  const value =
    ((digest[offset] & 127) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  const code = (value % 10 ** digits).toString();
  return code.padStart(digits, "0");
}

// The time-based code a given secret shows at `time` (seconds since epoch).
export async function totpAt(base32Secret, time, digits = TOTP_DIGITS, algorithm = TOTP_DEFAULT_ALGORITHM) {
  return hotpAt(base32Decode(base32Secret), Math.floor(time / TOTP_STEP), digits, algorithm);
}

// The ±1-step verifying window authenticators and servers share: a drifted
// clock on one side never locks the member out. Comparison uses the
// constant-time comparator (equality, not order) per candidate step.
// Batch F: returns the matched time-step counter (or null) so the caller can
// spend it exactly once — the replay refusal lives in twofa.mjs's claim.
export async function totpMatchStep(base32Secret, code, time, algorithm = TOTP_DEFAULT_ALGORITHM) {
  if (
    typeof code !== "string" ||
    code.length !== TOTP_DIGITS ||
    !/^[0-9]{6}/.test(code) ||
    !Number.isFinite(time) ||
    time < 0
  ) {
    return null;
  }

  const keyBytes = base32Decode(base32Secret);
  const counter = Math.floor(time / TOTP_STEP);

  if (!Number.isSafeInteger(counter)) return null;

  for (const drift of [-1, 0, 1]) {
    const candidate = await hotpAt(
      keyBytes,
      counter + drift,
      TOTP_DIGITS,
      algorithm,
    );

    let difference = 0;
    for (let i = 0; i < TOTP_DIGITS; i++) {
      difference |= candidate.charCodeAt(i) ^ code.charCodeAt(i);
    }

    if (difference === 0) return counter + drift;
  }

  return null;
}

export async function verifyTotpCode(base32Secret, code, time, algorithm = TOTP_DEFAULT_ALGORITHM) {
  return (await totpMatchStep(base32Secret, code, time, algorithm)) !== null;
}

// The provisioning URI authenticator apps scan or paste. PCT-encoded
// account/issuer keep colons from splitting the label.
export function otpauthUri(base32Secret, issuer, accountName, algorithm = TOTP_DEFAULT_ALGORITHM) {
  const encode = (value) => encodeURIComponent(value ?? "");
  return (
    "otpauth://totp/" + encode(issuer) + ":" + encode(accountName) +
    "?secret=" + base32Secret +
    "&issuer=" + encode(issuer) +
    "&algorithm=" + normalizeTotpAlgorithm(algorithm) + "&digits=" + TOTP_DIGITS + "&period=" + TOTP_STEP
  );
}
