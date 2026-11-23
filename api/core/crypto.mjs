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

// v4.0 core leaf: the crypto primitives everything else bottoms out on —
// time, hex/base64url codecs, random tokens, SHA-256, constant-time string
// comparison. Imports nothing (Web Crypto + TextEncoder only); every other
// core module may import from here, never the reverse.
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
  if (typeof value !== "string" || value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new TypeError("A valid even-length hexadecimal string is required.");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function randomToken(size = 32) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 65536) {
    throw new RangeError("Token size must be an integer between 1 and 65536 bytes.");
  }

  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function sha256Hex(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

// Both inputs are UTF-8 encoded and zero-padded to one shared length, so the
// comparison always walks the same number of bytes whether or not the
// lengths match; the length difference is folded into the result instead of
// returning early. Workers ship crypto.subtle.timingSafeEqual (equal-length
// buffers only); node --test falls back to the pure-JS XOR loop.
function padded(bytes, size) {
  const result = new Uint8Array(size);
  result.set(bytes);
  return result;
}

function bytesEqual(left, right) {
  const native = globalThis.crypto?.subtle?.timingSafeEqual;
  if (typeof native === "function") return native.call(globalThis.crypto.subtle, left, right);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

export function equalConstantTime(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const size = Math.max(left.length, right.length, 1);
  const same = bytesEqual(padded(left, size), padded(right, size));
  return same && left.length === right.length;
}
