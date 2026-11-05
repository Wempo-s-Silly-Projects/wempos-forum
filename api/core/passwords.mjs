// v4.0 core leaf: password hashing and credential-length validation — the
// HMAC-peppered PBKDF2 pipeline (capped at the Workers Web Crypto iteration
// ceiling, PBKDF2_ITERATIONS in constants.mjs). Plaintext passwords are
// never persisted; the pepper never leaves this derivation path.
import { PBKDF2_ITERATIONS } from "../../constants.mjs";
import { equalConstantTime, fromHex, hex } from "./crypto.mjs";
import { HttpError } from "./http.mjs";

const encoder = new TextEncoder();

export function isValidPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

export function isValidPasswordPepper(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 256;
}

export function isValidSetupSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4096;
}

async function derivePassword(password, saltHex, pepper) {
  if (!isValidPasswordPepper(pepper)) {
    throw new HttpError(503, "Password security is not configured. Set PASSWORD_PEPPER using Wrangler.");
  }

  const pepperKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const pepperedPassword = await crypto.subtle.sign(
    "HMAC",
    pepperKey,
    encoder.encode(password),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    pepperedPassword,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}

export async function hashPassword(password, pepper) {
  const saltHex = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt: saltHex, hash: await derivePassword(password, saltHex, pepper) };
}

export async function verifyPassword(password, salt, expectedHash, pepper) {
  return equalConstantTime(await derivePassword(password, salt, pepper), expectedHash);
}
