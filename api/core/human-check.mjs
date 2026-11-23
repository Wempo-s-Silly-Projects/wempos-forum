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

// Batch F: the self-hosted proof-of-work human check (ALTCHA, altcha-lib v1,
// MIT) that replaced Cloudflare Turnstile. The worker signs a SHA-256
// challenge with an HMAC key; the browser finds the number; the worker
// verifies signature + expiry + work, then spends the solution once in D1
// (altcha_spent) so a solved challenge can never be replayed.
//
// The key: ALTCHA_HMAC_KEY when set. Otherwise it is DERIVED (HKDF-SHA-256,
// fixed label) from the existing TURNSTILE_SECRET binding, so a deployment
// that had a human check keeps one with no new secret; the stored secret is
// never used raw. Neither set = no human check at all (self-hosting; the
// rate limits still apply) — the same on/off contract Turnstile had.
import { createChallenge, verifySolution } from "altcha-lib/v1";
import {
  ALTCHA_MAX_NUMBER, ALTCHA_PAYLOAD_MAX_LENGTH, ALTCHA_TTL_SECONDS, DEFAULT_HUMAN_CHECK_MODE, HUMAN_CHECK_MODES,
} from "../../constants.mjs";
import { anubisConfig, hasAnubisPass } from "./anubis-pass.mjs";
import { nowSeconds, sha256Hex } from "./crypto.mjs";
import { HttpError } from "./http.mjs";

const DERIVE_LABEL = "wempos-forum altcha hmac v1";
const KNOWN_MODES = new Set(Object.values(HUMAN_CHECK_MODES));

// The ONE mode resolver (owner order, Nov 22): env HUMAN_CHECK, trimmed and
// case-folded; unset, empty or unrecognised falls back to the default
// (anubis). Every human-check decision (the per-form check, the challenge
// endpoint, the shell's human-check meta, the Anubis gate) reads this.
export function humanCheckMode(env) {
  const raw = env && typeof env.HUMAN_CHECK === "string" ? env.HUMAN_CHECK.trim().toLowerCase() : "";
  return KNOWN_MODES.has(raw) ? raw : DEFAULT_HUMAN_CHECK_MODE;
}

// ALTCHA serves altcha mode, and anubis mode as its fallback (Anubis not
// configured, unreachable, or a visitor without a pass cookie).
const altchaMode = (env) => humanCheckMode(env) !== HUMAN_CHECK_MODES.OFF;
const anubisLive = (env) => humanCheckMode(env) === HUMAN_CHECK_MODES.ANUBIS && Boolean(anubisConfig(env));

// True when the per-form ALTCHA check can run: altcha or anubis mode AND key.
export function humanCheckConfigured(env) {
  return altchaMode(env) && Boolean(nonEmpty(env.ALTCHA_HMAC_KEY) || nonEmpty(env.TURNSTILE_SECRET));
}

// The shell's <meta name="human-check"> for THIS request: "anubis" when the
// visitor already holds a valid Anubis pass (the client shows no widget),
// "altcha" when the per-form ALTCHA check applies, "" for none.
export async function humanCheckMeta(request, env) {
  if (anubisLive(env) && await hasAnubisPass(request, env)) return "anubis";
  return humanCheckConfigured(env) ? "altcha" : "";
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : "";
}

export async function humanCheckKey(env) {
  const explicit = nonEmpty(env.ALTCHA_HMAC_KEY);
  if (explicit) return explicit;
  const legacy = nonEmpty(env.TURNSTILE_SECRET);
  if (!legacy) return null;
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(legacy), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(DERIVE_LABEL) },
    material,
    256,
  );
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A fresh signed challenge, or null when the instance runs without the
// per-form check (another mode, or no key).
export async function createHumanChallenge(env) {
  if (!altchaMode(env)) return null;
  const hmacKey = await humanCheckKey(env);
  if (!hmacKey) return null;
  const challenge = await createChallenge({
    hmacKey,
    maxNumber: ALTCHA_MAX_NUMBER,
    expires: new Date((nowSeconds() + ALTCHA_TTL_SECONDS) * 1000),
  });
  return {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    maxnumber: challenge.maxnumber,
    salt: challenge.salt,
    signature: challenge.signature,
  };
}

function decodePayload(raw) {
  try {
    const parsed = JSON.parse(atob(raw));
    return parsed && typeof parsed === "object" && typeof parsed.signature === "string" ? parsed : null;
  } catch {
    return null;
  }
}

// The salt carries "expires=<seconds>" (signed with the challenge); it bounds
// how long the spent row must be kept.
function payloadExpiry(payload) {
  const match = /[?&]expires=(\d+)/.exec(String(payload.salt || ""));
  return match ? Number(match[1]) : nowSeconds() + ALTCHA_TTL_SECONDS;
}

// off mode asks for nothing; altcha mode is Batch F unchanged. anubis mode
// with Anubis configured passes a valid Anubis pass cookie (verified locally,
// api/core/anubis-pass.mjs) OR a valid ALTCHA payload, else 403: the API is
// exempt from the page gate, so writes must prove it here. anubis mode with
// no Anubis configured behaves as altcha mode.
export async function requireHumanCheck(request, env, body) {
  if (!altchaMode(env)) return;
  const anubis = anubisLive(env);
  if (anubis && await hasAnubisPass(request, env)) return;
  const hmacKey = await humanCheckKey(env);
  if (!hmacKey) {
    if (anubis) throw new HttpError(403, "Human verification is required.");
    return;
  }
  const raw = body && typeof body.altcha === "string" ? body.altcha : "";
  if (!raw || raw.length > ALTCHA_PAYLOAD_MAX_LENGTH) {
    throw new HttpError(403, "Human verification is required.");
  }
  const payload = decodePayload(raw);
  let verified = false;
  if (payload) {
    try {
      verified = await verifySolution(payload, hmacKey, true);
    } catch {
      verified = false;
    }
  }
  if (!verified) throw new HttpError(403, "Human verification failed. Please try again.");
  const db = env.FORUM_DB;
  await db.prepare("DELETE FROM altcha_spent WHERE expires_at <= ?").bind(nowSeconds()).run();
  const spent = await db.prepare(
    "INSERT INTO altcha_spent (signature_hash, expires_at) VALUES (?, ?) ON CONFLICT(signature_hash) DO NOTHING",
  ).bind(await sha256Hex(payload.signature), payloadExpiry(payload)).run();
  if (Number(spent.meta?.changes) !== 1) {
    throw new HttpError(403, "Human verification failed. Please try again.");
  }
}
