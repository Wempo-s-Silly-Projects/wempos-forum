
// v4.0 core leaf: the crypto primitives everything else bottoms out on —
// time, hex/base64url codecs, random tokens, SHA-256, constant-time string
// comparison. Imports nothing (Web Crypto + TextEncoder only); every other
// core module may import from here, never the reverse.
const encoder = new TextEncoder();

const MAX_RANDOM_BYTES = 65_536;

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function hex(bytes) {
  if (
    bytes == null ||
    typeof bytes.length !== "number" ||
    !Number.isSafeInteger(bytes.length) ||
    bytes.length < 0
  ) {
    throw new TypeError("Expected a byte-like value.");
  }

  let result = "";

  for (const value of bytes) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new TypeError("Expected values in the byte range 0–255.");
    }

    result += value.toString(16).padStart(2, "0");
  }

  return result;
}

export function fromHex(value) {
  if (typeof value !== "string") {
    throw new TypeError("Hex input must be a string.");
  }

  if (value.length % 2 !== 0 || !/^(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TypeError("Hex input must contain complete hexadecimal bytes.");
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

function base64Url(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Base64url input must be a Uint8Array.");
  }

  let binary = "";

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function randomToken(size = 32) {
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_RANDOM_BYTES
  ) {
    throw new RangeError(
      `Token size must be an integer between 1 and ${MAX_RANDOM_BYTES} bytes.`,
    );
  }

  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function sha256Hex(value) {
  if (typeof value !== "string") {
    throw new TypeError("SHA-256 input must be a string.");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );

  return hex(new Uint8Array(digest));
}

// Compares equal-length strings without exiting early on differing
// characters. Length is checked separately, so unequal-length inputs
// are not compared in constant time.
export function equalConstantTime(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;

  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}
