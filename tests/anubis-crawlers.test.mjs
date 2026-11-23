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

// v5.84.3: Cloudflare hands Anubis the shared Workers address
// (2a06:98c0:3600::103) instead of the visitor's IP on same-zone subrequests,
// so Anubis's IP-based allow rules (Internet Archive, search engines) never
// match. The worker knows the real network (request.cf.asn, derived by
// Cloudflare from the connection, not spoofable) and lets a request skip the
// check only when BOTH the user agent claims a known crawler AND it comes from
// that crawler's own network — the same UA+IP pairing Anubis's
// data/crawlers/_allow-good.yaml uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/d1.mjs";
import { anubisApiGate, anubisGate, isTrustedCrawler } from "../api/core/anubis-gate.mjs";

const hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const env = () => makeEnv({
  HUMAN_CHECK: "anubis", ANUBIS_URL: "https://anubis.test", SITE_ORIGIN: "https://wempos-forum.com",
  ANUBIS_PUBLIC_KEY_HEX: hexOf(await_pub), ANUBIS_ACCESS_CLIENT_ID: "id.access", ANUBIS_ACCESS_CLIENT_SECRET: "s".repeat(24),
  ALTCHA_HMAC_KEY: "k".repeat(32),
});
const await_pub = await crypto.subtle.exportKey("raw", keyPair.publicKey);

const IA_UA = "Mozilla/5.0 (compatible; archive.org_bot +http://archive.org/details/archive.org_bot)";
const GOOGLE_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

function req(path, ua, asn) {
  const request = new Request("https://wempos-forum.com" + path, {
    headers: { "User-Agent": ua, Accept: path.startsWith("/api/") ? "application/json" : "text/html", "CF-Connecting-IP": "203.0.113.7" },
  });
  if (asn !== undefined) Object.defineProperty(request, "cf", { value: { asn } });
  return request;
}

async function anubisCalls(fn) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("", { status: 307, headers: { Location: "https://wempos-forum.com/.within.website/?redir=%2F" } }); };
  try { const result = await fn(); return { calls, result }; } finally { globalThis.fetch = original; }
}

test("a crawler UA from its own network is trusted (IA AS7941, Google AS15169)", () => {
  assert.equal(isTrustedCrawler(req("/", IA_UA, 7941)), true);
  assert.equal(isTrustedCrawler(req("/", GOOGLE_UA, 15169)), true);
});

test("a spoofed crawler UA from another network is NOT trusted", () => {
  assert.equal(isTrustedCrawler(req("/", IA_UA, 13335)), false);
  assert.equal(isTrustedCrawler(req("/", GOOGLE_UA, 7941)), false);
});

test("the right network with a browser UA is NOT trusted; no cf data is NOT trusted", () => {
  assert.equal(isTrustedCrawler(req("/", FIREFOX_UA, 15169)), false);
  assert.equal(isTrustedCrawler(req("/", IA_UA)), false);
});

test("page gate: a trusted crawler never reaches Anubis and is served", async () => {
  const { calls, result } = await anubisCalls(() => anubisGate(req("/posts/1", IA_UA, 7941), env()));
  assert.equal(calls, 0);
  assert.equal(result, null);
});

test("page gate: a spoofed crawler is still sent to Anubis (and challenged)", async () => {
  const { calls, result } = await anubisCalls(() => anubisGate(req("/posts/1", IA_UA, 13335), env()));
  assert.equal(calls, 1);
  assert.ok(result && result.status >= 300 && result.status < 400);
});

test("API gate: a trusted crawler reads without a challenge; a spoofed one gets 401", async () => {
  const trusted = await anubisCalls(() => anubisApiGate(req("/api/posts", GOOGLE_UA, 15169), env()));
  assert.equal(trusted.calls, 0);
  assert.equal(trusted.result, null);
  const spoofed = await anubisCalls(() => anubisApiGate(req("/api/posts", GOOGLE_UA, 4134), env()));
  assert.equal(spoofed.calls, 1);
  assert.equal(spoofed.result.status, 401);
});
