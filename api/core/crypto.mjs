// v4.0 core leaf: the crypto primitives everything else bottoms out on —
// time, hex/base64url codecs, random tokens, SHA-256, constant-time string
// comparison. Imports nothing (Web Crypto + TextEncoder only); every other
// core module and api/shared.mjs may import from here, never the reverse.
const encoder = new TextEncoder();

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function hex(bytes) {
  let result = "";
  for (const value of bytes) result += value.toString(16).padStart(2, "0");
  return result;
}

export function fromHex(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function base64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function randomToken(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function sha256Hex(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function equalConstantTime(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
