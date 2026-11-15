
// v4.0 core leaf: password hashing and credential-length validation — the
// HMAC-peppered PBKDF2 pipeline (capped at the Workers Web Crypto iteration
// ceiling, PBKDF2_ITERATIONS in constants.mjs). Plaintext passwords are
// never persisted; the pepper never leaves this derivation path.
import { PBKDF2_ITERATIONS } from "../../constants.mjs";
import { equalConstantTime, fromHex, hex } from "./crypto.mjs";
import { HttpError } from "./http.mjs";

const encoder = new TextEncoder();

const SALT_BYTES = 16;
const SALT_HEX_LENGTH = SALT_BYTES * 2;
const HASH_BYTES = 32;
const HASH_HEX_LENGTH = HASH_BYTES * 2;

export function isValidPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 128
  );
}

export function isValidPasswordPepper(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 256
  );
}

function isValidSaltHex(saltHex) {
  return (
    typeof saltHex === "string" &&
    saltHex.length === SALT_HEX_LENGTH &&
    /^[0-9a-fA-F]+$/.test(saltHex)
  );
}

function isValidHashHex(hashHex) {
  return (
    typeof hashHex === "string" &&
    hashHex.length === HASH_HEX_LENGTH &&
    /^[0-9a-fA-F]+$/.test(hashHex)
  );
}

export function isValidSetupSecret(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 4096
  );
}

function requirePassword(password) {
  if (!isValidPassword(password)) {
    throw new HttpError(
      400,
      "Password must be between 12 and 128 characters.",
    );
  }
}

function requirePepper(pepper) {
  if (!isValidPasswordPepper(pepper)) {
    throw new HttpError(
      503,
      "Password security is not configured. Set PASSWORD_PEPPER using Wrangler.",
    );
  }
}

function requireSalt(saltHex) {
  if (!isValidSaltHex(saltHex)) {
    throw new HttpError(400, "Stored password credentials are invalid.");
  }
}

function requireExpectedHash(expectedHash) {
  if (!isValidHashHex(expectedHash)) {
    throw new HttpError(400, "Stored password credentials are invalid.");
  }
}

function requireIterations() {
  if (
    !Number.isSafeInteger(PBKDF2_ITERATIONS) ||
    PBKDF2_ITERATIONS < 1 ||
    PBKDF2_ITERATIONS > 1_000_000
  ) {
    throw new HttpError(
      503,
      "Password security has an invalid PBKDF2 configuration.",
    );
  }

  return PBKDF2_ITERATIONS;
}

async function derivePassword(password, saltHex, pepper) {
  requirePassword(password);
  requireSalt(saltHex);
  requirePepper(pepper);

  const iterations = requireIterations();

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
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations,
      hash: "SHA-256",
    },
    key,
    HASH_BYTES * 8,
  );

  return hex(new Uint8Array(bits));
}

export async function hashPassword(password, pepper) {
  requirePassword(password);
  requirePepper(pepper);
  requireIterations();

  const saltHex = hex(
    crypto.getRandomValues(new Uint8Array(SALT_BYTES)),
  );

  return {
    salt: saltHex,
    hash: await derivePassword(password, saltHex, pepper),
  };
}

export async function verifyPassword(
  password,
  salt,
  expectedHash,
  pepper,
) {
  // Invalid user-typed passwords and malformed stored credentials verify as
  // false so callers keep answering with their own generic credential
  // failure (a uniform 401, no oracle); only configuration/infra problems
  // throw.
  if (
    !isValidPassword(password) ||
    !isValidSaltHex(salt) ||
    !isValidHashHex(expectedHash)
  ) {
    return false;
  }

  requirePepper(pepper);
  requireIterations();

  const actualHash = await derivePassword(password, salt, pepper);

  return equalConstantTime(actualHash, expectedHash.toLowerCase());
}
