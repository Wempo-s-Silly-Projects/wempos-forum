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

// Security review of the Anubis forward-auth wave (before the production
// flip): M1 proxy redirects parsed against our origin; M2 unauthenticated
// /api GET/HEAD gated (pass cookie, signed-in session or agent token, else
// Anubis); M3/L1 only Anubis cookies cross the proxy either way; M4 CSP on
// every proxied Anubis page and HttpOnly forum cookies; L2 proxy body cap.
// Anubis is a stubbed fetch; the Ed25519 key is a throwaway test key.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { forgeSession, makeRequest, seedUser } from "./helpers/seed.mjs";
import { ANUBIS_PAGE_CSP, ANUBIS_PROXY_MAX_BODY_BYTES } from "../constants.mjs";
import { createSession } from "../api/core/auth.mjs";

const KEY = "altcha-test-hmac-key-0123456789abcdef";
const ANUBIS_URL = "https://anubis.test";
const CHECK_URL = ANUBIS_URL + "/.within.website/x/cmd/anubis/api/check";
const COOKIE_NAME = "techaro.lol-anubis-auth-5ab17f3c";
const CLIENT_IP = "198.51.100.23";
const encoder = new TextEncoder();
const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const hexOf = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const PUBLIC_HEX = hexOf(await crypto.subtle.exportKey("raw", keyPair.publicKey));
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const sha256 = async (text) => hexOf(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
const now = () => Math.floor(Date.now() / 1000);

async function passToken() {
  const claims = {
    challenge: "c1", method: "fast", policyRule: "r1", action: "CHALLENGE",
    restriction: await sha256(CLIENT_IP), iat: now(), nbf: now() - 60, exp: now() + 3600,
  };
  const input = b64url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }))) + "." +
    b64url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, encoder.encode(input));
  return input + "." + b64url(new Uint8Array(signature));
}

const ANUBIS_ENV = {
  HUMAN_CHECK: "anubis", ANUBIS_URL, ANUBIS_PUBLIC_KEY_HEX: PUBLIC_HEX, SITE_ORIGIN: "https://wempos-forum.com",
  ANUBIS_ACCESS_CLIENT_ID: "test-client-id.access", ANUBIS_ACCESS_CLIENT_SECRET: "test-access-secret",
};
const anubisEnv = (extra = {}) => makeEnv({ ALTCHA_HMAC_KEY: KEY, ...ANUBIS_ENV, ...extra });

async function withFetch(handler, body) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    return handler(request);
  };
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const apiGet = (path, { headers = {}, session, method = "GET" } = {}) =>
  makeRequest(path, { method, session, headers: { Accept: "application/json", "CF-Connecting-IP": CLIENT_IP, ...headers } });
const anubisChallenge = () => new Response(null, {
  status: 307, headers: { Location: "https://wempos-forum.com/.within.website/?redir=x" },
});

// M1
test("proxy redirect: backslash, whitespace and control-character tricks are refused", async () => {
  for (const location of ["/\\evil.com", "/\\/evil.com", "\\\\evil.com", "/\tevil.com", "/ evil.com", "https://wempos-forum.com\\@evil.com/"]) {
    await withFetch(() => new Response(null, { status: 302, headers: { Location: location } }), async () => {
      const res = await worker.fetch(makeRequest("/.within.website/x/cmd/anubis/api/pass-challenge?r=1"), anubisEnv(), {});
      assert.equal(res.status, 502, JSON.stringify(location));
      assert.equal(res.headers.get("Location"), null);
    });
  }
});

// M2
test("api gate: an anonymous GET without a pass is asked of Anubis; a challenge is a 401 JSON, never a redirect", async () => {
  await withFetch(() => anubisChallenge(), async (calls) => {
    const res = await worker.fetch(apiGet("/api/posts?limit=5"), anubisEnv(), {});
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("Location"), null);
    assert.deepEqual(await res.json(), { error: "human check required" });
    assert.equal(calls.length, 1);
    const h = calls[0].headers;
    assert.equal(calls[0].url, CHECK_URL);
    assert.equal(h.get("X-Forwarded-Uri"), "/api/posts?limit=5");
    assert.equal(h.get("X-Forwarded-Method"), "GET");
    assert.equal(h.get("X-Wempo-Client-Ip"), CLIENT_IP);
    assert.equal(h.get("CF-Access-Client-Id"), "test-client-id.access");
  });
});

test("api gate: Anubis 200 passes, 403 is a 403 JSON, unreachable fails open; HEAD is gated too", async () => {
  await withFetch(() => new Response("", { status: 200 }), async () => {
    assert.equal((await worker.fetch(apiGet("/api/posts"), anubisEnv(), {})).status, 200);
  });
  await withFetch(() => new Response("<html>/.within.website/ denied</html>", { status: 403 }), async () => {
    const res = await worker.fetch(apiGet("/api/posts"), anubisEnv(), {});
    assert.equal(res.status, 403);
    assert.match(res.headers.get("Content-Type"), /application\/json/);
  });
  await withFetch(() => { throw new TypeError("down"); }, async () => {
    assert.equal((await worker.fetch(apiGet("/api/posts"), anubisEnv(), {})).status, 200);
  });
  await withFetch(() => anubisChallenge(), async () => {
    assert.equal((await worker.fetch(apiGet("/api/posts", { method: "HEAD" }), anubisEnv(), {})).status, 401);
  });
});

test("api gate: a valid pass cookie, a signed-in session or an agent token skip Anubis", async () => {
  await withFetch(() => { throw new Error("Anubis must not be called"); }, async (calls) => {
    const env = anubisEnv();
    const pass = await worker.fetch(apiGet("/api/posts", { headers: { Cookie: `${COOKIE_NAME}=${await passToken()}` } }), env, {});
    assert.equal(pass.status, 200);
    const userId = await seedUser(env.__sqlite, { username: "Member" });
    const session = forgeSession(env.__sqlite, userId);
    assert.equal((await worker.fetch(apiGet("/api/posts", { session }), env, {})).status, 200);
    const token = "agent-token-0123456789abcdef";
    const agentId = await seedUser(env.__sqlite, { username: "Agent" });
    const agentEnv = { ...env, AGENT_TOKENS: JSON.stringify({ [await sha256(token)]: agentId }) };
    const agent = await worker.fetch(apiGet("/api/posts", { headers: { Authorization: "Bearer " + token } }), agentEnv, {});
    assert.equal(agent.status, 200);
    assert.equal(calls.length, 0);
  });
});

test("api gate: a guest session, a forged cookie or a wrong bearer token do not skip Anubis", async () => {
  await withFetch(() => anubisChallenge(), async (calls) => {
    const env = anubisEnv();
    const guest = await createSession(makeRequest("/api/session"), env, null);
    const guestCookie = guest.setCookie.split(";")[0];
    for (const headers of [
      { Cookie: guestCookie },
      { Cookie: `${COOKIE_NAME}=forged` },
      { Authorization: "Bearer not-a-real-agent-token-xyz" },
    ]) {
      assert.equal((await worker.fetch(apiGet("/api/posts", { headers }), env, {})).status, 401, JSON.stringify(headers));
    }
    assert.equal(calls.length, 3);
  });
});

test("api gate: exempt endpoints and writes never ask Anubis", async () => {
  await withFetch(() => { throw new Error("Anubis must not be called"); }, async (calls) => {
    const env = anubisEnv();
    for (const path of ["/api/version", "/api/altcha/challenge", "/api/session", "/api/setup/status", "/api/automod/queue", "/api/relay/password-verify"]) {
      await worker.fetch(apiGet(path), env, {});
    }
    await worker.fetch(makeRequest("/api/posts", { method: "POST", body: { body: "x" } }), env, {});
    assert.equal(calls.length, 0);
  });
});

test("api gate: altcha, off and unconfigured anubis modes never ask Anubis", async () => {
  await withFetch(() => { throw new Error("Anubis must not be called"); }, async (calls) => {
    for (const extra of [{ HUMAN_CHECK: "altcha" }, { HUMAN_CHECK: "off" }, { ANUBIS_URL: undefined }]) {
      assert.equal((await worker.fetch(apiGet("/api/posts"), anubisEnv(extra), {})).status, 200);
    }
    assert.equal(calls.length, 0);
  });
});

// M4
test("every proxied Anubis page carries a CSP: Anubis's own, else ANUBIS_PAGE_CSP; the gate's deny page too", async () => {
  await withFetch(() => new Response("<html>/.within.website/</html>", { status: 200, headers: { "Content-Type": "text/html" } }), async () => {
    const res = await worker.fetch(makeRequest("/.within.website/?redir=%2F"), anubisEnv(), {});
    assert.equal(res.headers.get("Content-Security-Policy"), ANUBIS_PAGE_CSP);
  });
  await withFetch(() => new Response("x", { status: 200, headers: { "Content-Security-Policy": "default-src 'none'" } }), async () => {
    const res = await worker.fetch(makeRequest("/.within.website/x/a.js"), anubisEnv(), {});
    assert.equal(res.headers.get("Content-Security-Policy"), "default-src 'none'");
  });
  await withFetch(() => new Response("<html>/.within.website/ denied</html>", { status: 403 }), async () => {
    const res = await worker.fetch(makeRequest("/", { headers: { Accept: "text/html" } }), anubisEnv(), {});
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Content-Security-Policy"), ANUBIS_PAGE_CSP);
  });
  assert.match(ANUBIS_PAGE_CSP, /frame-ancestors 'none'/);
  assert.match(ANUBIS_PAGE_CSP, /object-src 'none'/);
});

test("the forum's session cookies are HttpOnly, Secure, SameSite=Lax and __Host- prefixed", async () => {
  const env = makeEnv({});
  const created = await createSession(makeRequest("/api/session"), env, null);
  const guest = (await worker.fetch(makeRequest("/api/session"), env, {})).headers.getSetCookie();
  for (const line of [created.setCookie, ...guest]) {
    assert.match(line, /^__Host-wempo_session=/, line);
    assert.match(line, /;\s*HttpOnly/, line);
    assert.match(line, /;\s*Secure/, line);
    assert.match(line, /;\s*SameSite=Lax/, line);
    assert.match(line, /;\s*Path=\//, line);
  }
  assert.ok(guest.length >= 1);
});

// L2
test("proxy body cap: a declared or streamed body over the limit is a 413 and never reaches Anubis", async () => {
  assert.equal(ANUBIS_PROXY_MAX_BODY_BYTES, 64 * 1024);
  await withFetch(() => new Response("ok"), async (calls) => {
    const declared = new Request("https://wempos-forum.com/.within.website/x/cmd/anubis/api/pass-challenge", {
      method: "POST", headers: { "Content-Length": String(ANUBIS_PROXY_MAX_BODY_BYTES + 1) }, body: "small",
    });
    assert.equal((await worker.fetch(declared, anubisEnv(), {})).status, 413);
    const big = new Uint8Array(ANUBIS_PROXY_MAX_BODY_BYTES + 10);
    const streamed = new Request("https://wempos-forum.com/.within.website/x/cmd/anubis/api/pass-challenge", {
      method: "POST", duplex: "half",
      body: new ReadableStream({ start(controller) { controller.enqueue(big.subarray(0, 40000)); controller.enqueue(big.subarray(40000)); controller.close(); } }),
    });
    assert.equal((await worker.fetch(streamed, anubisEnv(), {})).status, 413);
    const fine = new Request("https://wempos-forum.com/.within.website/x/cmd/anubis/api/pass-challenge", {
      method: "POST", body: "a=1",
    });
    assert.equal((await worker.fetch(fine, anubisEnv(), {})).status, 200);
    assert.equal(calls.length, 1);
  });
});
