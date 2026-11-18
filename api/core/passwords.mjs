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
// see <https://www.gnu.org/licenses/>

// v4.0 core leaf: password hashing and credential-length validation — the
// HMAC-peppered PBKDF2 pipeline (capped at the Workers Web Crypto iteration
// ceiling, PBKDF2_ITERATIONS in constants.mjs). Plaintext passwords are
// never persisted; the pepper never leaves this derivation path.
import { PBKDF2_ITERATIONS } from "../../constants.mjs";
import { equalConstantTime, fromHex, hex } from "./crypto.mjs";
import { HttpError } from "./http.mjs";

const encoder = new TextEncoder();

// Stored credential shapes (restored after the conciseness pass): a malformed
// row (corrupted salt/hash, a legacy NULL, binary bytes) must verify as
// FALSE — never throw, so one bad row is a failed login, not a server error.
const SALT_BYTES = 16;
const SALT_HEX_LENGTH = SALT_BYTES * 2;
const HASH_BYTES = 32;
const HASH_HEX_LENGTH = HASH_BYTES * 2;

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
  // Malformed stored values (and non-hex junk) answer invalid instead of
  // throwing — the login route's 401 copy is the correct UX for a bad row.
  if (!isValidSaltHex(salt) || !isValidHashHex(expectedHash)) return false;
  return equalConstantTime(await derivePassword(password, salt, pepper), expectedHash);
}
