// v4.0 core leaf: TOTP (RFC 6238) — the two-factor primitives everything
// 2FA bottoms out on. Web Crypto carries the HMAC (SHA-1 is what every
// authenticator app expects for TOTP); no dependency, no re-derivation of
// anything else. Imports nothing (crypto.getRandomValues only). The 2FA
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

export function generateTotpSecret() {
  // 160 bits — the default secret size from RFC 4226 (same length Google
  // Authenticator's key URI guide asks for).
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

// HMAC-based one-time password at a given counter (RFC 4226, dynamic
// truncation). digits 8 lets the RFC 6238 test vectors be asserted verbatim.
export async function hotpAt(keyBytes, counter, digits = TOTP_DIGITS) {
  const key = await crypto.subtle.importKey(
    "raw", new Uint8Array(keyBytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
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
export async function totpAt(base32Secret, time, digits = TOTP_DIGITS) {
  return hotpAt(base32Decode(base32Secret), Math.floor(time / TOTP_STEP), digits);
}

// The ±1-step verifying window authenticators and servers share: a drifted
// clock on one side never locks the member out. Comparison uses the
// constant-time comparator (equality, not order) per candidate step.
export async function verifyTotpCode(base32Secret, code, time) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const keyBytes = base32Decode(base32Secret);
  const counter = Math.floor(time / TOTP_STEP);
  for (const drift of [-1, 0, 1]) {
    const candidate = await hotpAt(keyBytes, counter + drift);
    let difference = 0;
    for (let i = 0; i < 6; i++) {
      difference |= candidate.charCodeAt(i) ^ code.charCodeAt(i);
    }
    if (difference === 0) return true;
  }
  return false;
}

// The provisioning URI authenticator apps scan or paste. PCT-encoded
// account/issuer keep colons from splitting the label.
export function otpauthUri(base32Secret, issuer, accountName) {
  const encode = (value) => encodeURIComponent(value ?? "");
  return (
    "otpauth://totp/" + encode(issuer) + ":" + encode(accountName) +
    "?secret=" + base32Secret +
    "&issuer=" + encode(issuer) +
    "&algorithm=SHA1&digits=" + TOTP_DIGITS + "&period=" + TOTP_STEP
  );
}
