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

// Anubis configuration and the local check of its pass cookie (owner order,
// Nov 22). The forum never trusts cookie presence: Anubis also sets (clears)
// the cookie on a DENY. A pass is a JWT that Anubis signed with its Ed25519
// key; only the PUBLIC key (ANUBIS_PUBLIC_KEY_HEX, not a secret) lives here.
//
// The checks mirror upstream TecharoHQ/anubis v1.28.2, lib/anubis.go,
// (*Server).maybeReverseProxy: jwt.ParseWithClaims(..., getTokenKeyfunc(),
// jwt.WithExpirationRequired(), jwt.WithStrictDecoding()) — the keyfunc hands
// an ed25519.PublicKey, so only alg EdDSA can verify; exp required (now <
// exp), nbf honoured (now >= nbf); claims must be an object with a string
// "policyRule"; with the default -jwt-restriction-header X-Real-IP (fed from
// CUSTOM_REAL_IP_HEADER=X-Wempo-Client-Ip), "restriction" must equal
// SHA256sum(client IP) (internal/hash.go: hex sha256). Claims come from
// (*Server).PassChallenge + lib/http.go signJWT. Two deliberate differences:
// upstream also compares policyRule to the hash of the rule that matched THIS
// request (needs the policy engine; not reproducible here — any rule Anubis
// signed is accepted), and the forum additionally requires action ==
// "CHALLENGE", the only rule PassChallenge ever signs.
import {
  ANUBIS_AUTH_COOKIE_PATTERN, ANUBIS_COOKIE_MAX_CANDIDATES, ANUBIS_COOKIE_MAX_LENGTH, ANUBIS_PASS_ACTION,
} from "../../constants.mjs";
import { fromHex, sha256Hex } from "./crypto.mjs";

const HEX_KEY = /^[0-9a-f]{64}$/i;
const B64URL_PART = /^[A-Za-z0-9_-]+$/;
const ED25519_SIGNATURE_BYTES = 64;
const ACCESS_OPT_OUT = "none";

const nonEmptyString = (value) => (typeof value === "string" && value.length > 0 ? value : "");

// ANUBIS_URL -> "https://host[:port]" when it is a bare https origin, else "".
function anubisOrigin(value) {
  if (typeof value !== "string" || !value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  if (url.pathname !== "/" || url.search || url.hash || /[?#]/.test(value)) return "";
  return url.origin;
}

// The Cloudflare Access service token in front of the Anubis origin: both
// secrets, or an explicit ANUBIS_ACCESS=none for an origin without Access.
// Returns { clientId, clientSecret }, null (opted out), or undefined (broken).
function accessToken(env) {
  const clientId = nonEmptyString(env.ANUBIS_ACCESS_CLIENT_ID);
  const clientSecret = nonEmptyString(env.ANUBIS_ACCESS_CLIENT_SECRET);
  if (clientId && clientSecret) return { clientId, clientSecret };
  if (!clientId && !clientSecret && String(env.ANUBIS_ACCESS ?? "").trim().toLowerCase() === ACCESS_OPT_OUT) return null;
  return undefined;
}

// anubisConfig(env) -> { origin, publicKeyHex, access } when Anubis is fully
// configured, else null (the caller falls back to ALTCHA).
export function anubisConfig(env) {
  if (!env) return null;
  const origin = anubisOrigin(env.ANUBIS_URL);
  const key = typeof env.ANUBIS_PUBLIC_KEY_HEX === "string" ? env.ANUBIS_PUBLIC_KEY_HEX.trim() : "";
  const access = accessToken(env);
  if (!origin || !HEX_KEY.test(key) || access === undefined) return null;
  return { origin, publicKeyHex: key.toLowerCase(), access };
}

// Strict raw base64url (jwt.WithStrictDecoding): no padding, and the decoded
// bytes must re-encode to the same text (no non-canonical trailing bits).
function strictB64url(part) {
  if (!B64URL_PART.test(part)) return null;
  let binary;
  try {
    binary = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const again = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return again === part ? bytes : null;
}

function jsonObject(bytes) {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const isNumericDate = (value) => typeof value === "number" && Number.isFinite(value);

async function claimsAccepted(claims, clientIp, nowSec) {
  if (typeof clientIp !== "string" || clientIp === "") return false;
  if (!isNumericDate(claims.exp) || !(nowSec < claims.exp)) return false;
  if (claims.nbf !== undefined && (!isNumericDate(claims.nbf) || nowSec < claims.nbf)) return false;
  if (typeof claims.policyRule !== "string" || !claims.policyRule) return false;
  if (claims.action !== ANUBIS_PASS_ACTION) return false;
  return claims.restriction === await sha256Hex(clientIp);
}

async function signatureValid(input, signature, publicKeyHex) {
  if (signature.length !== ED25519_SIGNATURE_BYTES) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromHex(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, signature, new TextEncoder().encode(input));
  } catch {
    return false;
  }
}

// verifyAnubisToken(token, publicKeyHex, clientIp[, nowSec]) -> true only for
// an Anubis pass JWT (see the header comment for the mirrored checks).
export async function verifyAnubisToken(token, publicKeyHex, clientIp, nowSec = Date.now() / 1000) {
  if (typeof token !== "string" || !token || token.length > ANUBIS_COOKIE_MAX_LENGTH) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerBytes, payloadBytes, signature] = parts.map(strictB64url);
  if (!headerBytes || !payloadBytes || !signature) return false;
  const header = jsonObject(headerBytes);
  const claims = jsonObject(payloadBytes);
  if (!header || header.alg !== "EdDSA" || !claims) return false;
  if (!(await signatureValid(parts[0] + "." + parts[1], signature, publicKeyHex))) return false;
  return claimsAccepted(claims, typeof clientIp === "string" ? clientIp : "", nowSec);
}

function authCookieValues(request) {
  const header = request.headers.get("Cookie") || "";
  const values = [];
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at < 1) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (ANUBIS_AUTH_COOKIE_PATTERN.test(name) && value) values.push(value);
    if (values.length >= ANUBIS_COOKIE_MAX_CANDIDATES) break;
  }
  return values;
}

// hasAnubisPass(request, env) -> true when Anubis is configured and the
// request carries a pass cookie bound to its CF-Connecting-IP.
export async function hasAnubisPass(request, env) {
  const config = anubisConfig(env);
  if (!config) return false;
  const clientIp = request.headers.get("CF-Connecting-IP") || "";
  for (const value of authCookieValues(request)) {
    if (await verifyAnubisToken(value, config.publicKeyHex, clientIp)) return true;
  }
  return false;
}
