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

// HUMAN_CHECK=anubis with a real Anubis (v1.28.2, subrequest/forward-auth
// mode) behind ANUBIS_URL. Every Anubis call goes through a stubbed fetch;
// test JWTs are signed with a throwaway Ed25519 key generated here (never the
// production key). Pins: the check request (true client IP only), the gate's
// 200/403/30x/fail-open answers, the same-origin /.within.website/ proxy,
// the local pass-cookie validator on writes, and the per-request shell meta.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, makeRequest } from "./helpers/seed.mjs";
import { ANUBIS_CHECK_TIMEOUT_MS } from "../constants.mjs";
import { requireHumanCheck } from "../api/core/human-check.mjs";
import { anubisConfig, hasAnubisPass, verifyAnubisToken } from "../api/core/anubis-pass.mjs";
import { humanCheckEnabled, solveHumanChallenge } from "../public/js/human-check.js";

const KEY = "altcha-test-hmac-key-0123456789abcdef";
const ANUBIS_URL = "https://anubis.test";
const CHECK_URL = ANUBIS_URL + "/.within.website/x/cmd/anubis/api/check";
const COOKIE_NAME = "techaro.lol-anubis-auth-5ab17f3c";
const CLIENT_IP = "207.241.229.1";
const encoder = new TextEncoder();

const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const otherPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const hexOf = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const PUBLIC_HEX = hexOf(await crypto.subtle.exportKey("raw", keyPair.publicKey));
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const sha256 = async (text) => hexOf(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
const now = () => Math.floor(Date.now() / 1000);

async function passClaims(overrides = {}) {
  return {
    challenge: "019ab1c2-0000-7000-8000-000000000001",
    method: "fast",
    policyRule: "a1b2c3d4e5f60718",
    action: "CHALLENGE",
    restriction: await sha256(CLIENT_IP),
    iat: now(),
    nbf: now() - 60,
    exp: now() + 7 * 24 * 3600,
    ...overrides,
  };
}

async function signToken(claims, { header = { alg: "EdDSA", typ: "JWT" }, privateKey = keyPair.privateKey } = {}) {
  const input = b64url(encoder.encode(JSON.stringify(header))) + "." + b64url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("Ed25519", privateKey, encoder.encode(input));
  return input + "." + b64url(new Uint8Array(signature));
}

const validToken = async (overrides) => signToken(await passClaims(overrides));

// Fake Cloudflare Access service-token values (test only, never real ones).
const ACCESS_ID = "test-client-id.access";
const ACCESS_SECRET = "test-access-secret-0123456789";
const ANUBIS_ENV = {
  HUMAN_CHECK: "anubis", ANUBIS_URL, ANUBIS_PUBLIC_KEY_HEX: PUBLIC_HEX, SITE_ORIGIN: "https://wempos-forum.com",
  ANUBIS_ACCESS_CLIENT_ID: ACCESS_ID, ANUBIS_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
};
const ANUBIS_DENY_PAGE = '<html><link rel="stylesheet" href="/.within.website/x/xess/xess.min.css">Access Denied: rule abc</html>';
const anubisEnv = (extra = {}) => makeEnv({ ALTCHA_HMAC_KEY: KEY, ...ANUBIS_ENV, ...extra });

// Replaces globalThis.fetch for one test; every call is recorded as a Request.
async function withFetch(handler, body) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({ request, init: init || {} });
    return handler(request, init || {});
  };
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const page = (path, headers = {}) => makeRequest(path, { headers: { Accept: "text/html", "CF-Connecting-IP": CLIENT_IP, ...headers } });
const write = (cookie, ip = CLIENT_IP) => new Request("https://wempos-forum.com/api/posts", {
  method: "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(ip ? { "CF-Connecting-IP": ip } : {}) },
});
const required = (error) => error.status === 403 && /Human verification/.test(error.message);

async function solvedPayload(env) {
  const res = await call(env, "/api/altcha/challenge");
  assert.equal(res.status, 200, "the ALTCHA fallback challenge is served in anubis mode");
  return solveHumanChallenge(await res.json());
}

test("anubisConfig: both vars valid, https origin only, 64-hex key", () => {
  const full = { origin: ANUBIS_URL, publicKeyHex: PUBLIC_HEX, access: { clientId: ACCESS_ID, clientSecret: ACCESS_SECRET } };
  assert.deepEqual(anubisConfig(ANUBIS_ENV), full);
  assert.deepEqual(anubisConfig({ ...ANUBIS_ENV, ANUBIS_URL: "https://anubis.test/" }), full);
  assert.equal(anubisConfig({ ...ANUBIS_ENV, ANUBIS_PUBLIC_KEY_HEX: PUBLIC_HEX.toUpperCase() }).publicKeyHex, PUBLIC_HEX);
  for (const url of [undefined, "", "http://anubis.test", "https://anubis.test/x", "https://u:p@anubis.test",
    "https://anubis.test/?q=1", "https://anubis.test/#h", "not a url", "ftp://anubis.test", 7]) {
    assert.equal(anubisConfig({ ...ANUBIS_ENV, ANUBIS_URL: url }), null, String(url));
  }
  for (const key of [undefined, "", PUBLIC_HEX.slice(1), PUBLIC_HEX + "0", "z".repeat(64), 64]) {
    assert.equal(anubisConfig({ ...ANUBIS_ENV, ANUBIS_PUBLIC_KEY_HEX: key }), null, String(key));
  }
  assert.equal(anubisConfig(undefined), null);
});

test("anubisConfig: both Access secrets are required unless ANUBIS_ACCESS=none opts out", () => {
  for (const extra of [{ ANUBIS_ACCESS_CLIENT_ID: undefined }, { ANUBIS_ACCESS_CLIENT_SECRET: undefined },
    { ANUBIS_ACCESS_CLIENT_ID: "", ANUBIS_ACCESS_CLIENT_SECRET: "" }, { ANUBIS_ACCESS_CLIENT_SECRET: 7 }]) {
    assert.equal(anubisConfig({ ...ANUBIS_ENV, ...extra }), null, JSON.stringify(extra));
  }
  const open = { ...ANUBIS_ENV, ANUBIS_ACCESS_CLIENT_ID: undefined, ANUBIS_ACCESS_CLIENT_SECRET: undefined, ANUBIS_ACCESS: "none" };
  assert.deepEqual(anubisConfig(open), { origin: ANUBIS_URL, publicKeyHex: PUBLIC_HEX, access: null });
});

test("missing Access secrets: unconfigured, no Anubis call, ALTCHA stands in", async () => {
  await withFetch(() => { throw new Error("Anubis must not be called"); }, async (calls) => {
    const env = anubisEnv({ ANUBIS_ACCESS_CLIENT_SECRET: undefined });
    assert.match(await (await worker.fetch(page("/"), env, {})).text(), /<meta name="human-check" content="altcha">/);
    await assert.rejects(requireHumanCheck(write(`${COOKIE_NAME}=${await validToken()}`), env, {}), required);
    assert.equal(calls.length, 0);
  });
});

test("Access service-token headers ride both the check and the proxy; client CF-Access-* never forwarded", async () => {
  await withFetch(() => new Response("", { status: 200 }), async (calls) => {
    const spoof = { "CF-Access-Client-Id": "evil", "CF-Access-Client-Secret": "evil", "CF-Access-Jwt-Assertion": "evil" };
    await worker.fetch(page("/", spoof), anubisEnv(), {});
    await worker.fetch(makeRequest("/.within.website/?redir=%2F", { headers: spoof }), anubisEnv(), {});
    assert.equal(calls.length, 2);
    for (const { request } of calls) {
      assert.equal(request.headers.get("CF-Access-Client-Id"), ACCESS_ID);
      assert.equal(request.headers.get("CF-Access-Client-Secret"), ACCESS_SECRET);
      assert.equal(request.headers.get("CF-Access-Jwt-Assertion"), null);
    }
  });
  await withFetch(() => new Response("", { status: 200 }), async (calls) => {
    const open = anubisEnv({ ANUBIS_ACCESS_CLIENT_ID: undefined, ANUBIS_ACCESS_CLIENT_SECRET: undefined, ANUBIS_ACCESS: "none" });
    await worker.fetch(page("/", { "CF-Access-Client-Id": "evil" }), open, {});
    assert.equal(calls[0].request.headers.get("CF-Access-Client-Id"), null, "no Access: no service-token headers at all");
    assert.equal(calls[0].request.headers.get("X-Wempo-Client-Ip"), CLIENT_IP, "the client IP is still overwritten");
  });
});

test("Access answering instead of Anubis: the gate fails open to ALTCHA, the proxy is a 503", async () => {
  const accessLogin = "https://wempo.cloudflareaccess.com/cdn-cgi/access/login/anubis-origin.wempos-forum.com?redirect_url=%2F";
  for (const handler of [
    () => new Response(null, { status: 302, headers: { Location: accessLogin } }),
    () => new Response("Unauthorized", { status: 401 }),
    () => new Response("<html>Forbidden. Cloudflare Access</html>", { status: 403, headers: { "Content-Type": "text/html" } }),
  ]) {
    await withFetch(handler, async () => {
      const res = await worker.fetch(page("/"), anubisEnv(), {});
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<meta name="human-check" content="altcha">/);
      const proxied = await worker.fetch(makeRequest("/.within.website/?redir=%2F"), anubisEnv(), {});
      assert.equal(proxied.status, 503);
      assert.equal(proxied.headers.get("Location"), null);
    });
  }
});

test("CF_Authorization never reaches the browser and is never forwarded", async () => {
  await withFetch(() => {
    const headers = new Headers({ "Content-Type": "text/html" });
    headers.append("Set-Cookie", "CF_Authorization=eyJ.secret.jwt; Path=/; Secure; HttpOnly");
    headers.append("Set-Cookie", "techaro.lol-anubis-cookie-verification-5ab17f3c=1; Path=/");
    return new Response("<html>/.within.website/</html>", { status: 200, headers });
  }, async (calls) => {
    const res = await worker.fetch(makeRequest("/.within.website/?redir=%2F", { headers: { Cookie: "CF_Authorization=x; c=1; techaro.lol-anubis-auth-5ab17f3c=t" } }), anubisEnv(), {});
    assert.deepEqual(res.headers.getSetCookie(), ["techaro.lol-anubis-cookie-verification-5ab17f3c=1; Path=/"]);
    assert.equal(calls[0].request.headers.get("Cookie"), "techaro.lol-anubis-auth-5ab17f3c=t");
  });
});

test("check request: forward-auth headers, client IP only from CF-Connecting-IP, spoofed value stripped", async () => {
  await withFetch(() => new Response("", { status: 200 }), async (calls) => {
    const res = await worker.fetch(page("/posts/12?x=1", {
      Cookie: "__Host-wempo_session=forumsecret; techaro.lol-anubis-auth-5ab17f3c=tok; a=b", "User-Agent": "UA/1", "X-Wempo-Client-Ip": "6.6.6.6", "X-Forwarded-For": "6.6.6.6", "X-Real-IP": "6.6.6.6",
    }), anubisEnv(), {});
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    const { request, init } = calls[0];
    assert.equal(request.url, CHECK_URL);
    assert.equal(request.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal, "the check carries a timeout signal");
    const h = request.headers;
    assert.equal(h.get("X-Wempo-Client-Ip"), CLIENT_IP);
    assert.equal(h.get("X-Forwarded-Host"), "wempos-forum.com");
    assert.equal(h.get("X-Forwarded-Proto"), "https");
    assert.equal(h.get("X-Forwarded-Uri"), "/posts/12?x=1");
    assert.equal(h.get("X-Forwarded-Method"), "GET");
    assert.equal(h.get("User-Agent"), "UA/1");
    assert.equal(h.get("Accept"), "text/html");
    assert.equal(h.get("Cookie"), "techaro.lol-anubis-auth-5ab17f3c=tok", "only Anubis cookies, never the forum session");
    assert.equal(h.get("X-Forwarded-For"), null);
    // v5.84.2: Anubis's check refuses without X-Real-IP ("[misconfiguration]
    // X-Real-IP header is not set" seen live), so the worker sets it — always
    // from CF-Connecting-IP, never the client's forged 6.6.6.6.
    assert.equal(h.get("X-Real-IP"), CLIENT_IP);
  });
  await withFetch(() => new Response("", { status: 200 }), async (calls) => {
    await worker.fetch(makeRequest("/", { headers: { Accept: "text/html", "X-Wempo-Client-Ip": "6.6.6.6" } }), anubisEnv(), {});
    assert.equal(calls[0].request.headers.get("X-Wempo-Client-Ip"), null, "no CF-Connecting-IP: no client IP at all");
  });
});

test("gate 200: the page is served", async () => {
  await withFetch(() => new Response("OK", { status: 200 }), async () => {
    const res = await worker.fetch(page("/"), anubisEnv(), {});
    assert.equal(res.status, 200);
    assert.match(await res.text(), /shell/);
  });
});

test("gate 403: Anubis's deny answer, no-store", async () => {
  await withFetch(() => new Response(ANUBIS_DENY_PAGE, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }), async () => {
    const res = await worker.fetch(page("/c/general"), anubisEnv(), {});
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.match(await res.text(), /Access Denied/);
  });
});

test("gate 307: a same-origin /.within.website/ Location is honoured", async () => {
  const location = "https://wempos-forum.com/.within.website/?redir=https%3A%2F%2Fwempos-forum.com%2Fposts%2F12";
  await withFetch(() => new Response(null, { status: 307, headers: { Location: location } }), async () => {
    const res = await worker.fetch(page("/posts/12"), anubisEnv(), {});
    assert.ok([303, 307].includes(res.status), String(res.status));
    assert.equal(res.headers.get("Location"), location);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });
});

test("gate 30x to a foreign or non-Anubis Location is refused: fail open to ALTCHA", async () => {
  for (const location of [
    "https://evil.example/.within.website/?redir=x",
    "http://wempos-forum.com/.within.website/?redir=x",
    "https://wempos-forum.com/login",
    "https://wempos-forum.com.evil.example/.within.website/",
    "//evil.example/.within.website/",
    "not a url",
  ]) {
    await withFetch(() => new Response(null, { status: 307, headers: { Location: location } }), async () => {
      const res = await worker.fetch(page("/"), anubisEnv(), {});
      assert.equal(res.status, 200, location);
      assert.match(await res.text(), /<meta name="human-check" content="altcha">/, location);
    });
  }
});

test("gate network error, 5xx or unexpected status: the page with the ALTCHA meta", async () => {
  for (const handler of [
    () => { throw new TypeError("connect failed"); },
    () => new Response("bad gateway", { status: 502 }),
    () => new Response("teapot", { status: 418 }),
    () => new Response(null, { status: 307 }),
  ]) {
    await withFetch(handler, async () => {
      const res = await worker.fetch(page("/"), anubisEnv(), {});
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<meta name="human-check" content="altcha">/);
    });
  }
});

test("gate timeout: aborted after ANUBIS_CHECK_TIMEOUT_MS, the page is served with the ALTCHA meta", async () => {
  assert.ok(ANUBIS_CHECK_TIMEOUT_MS >= 500 && ANUBIS_CHECK_TIMEOUT_MS <= 3000);
  await withFetch((request, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  }), async () => {
    // AbortSignal.timeout's timer is unref'd in Node: hold the loop open.
    const keepAlive = setTimeout(() => {}, ANUBIS_CHECK_TIMEOUT_MS + 2000);
    const started = Date.now();
    const res = await worker.fetch(page("/"), anubisEnv(), {}).finally(() => clearTimeout(keepAlive));
    assert.ok(Date.now() - started < ANUBIS_CHECK_TIMEOUT_MS + 1000);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<meta name="human-check" content="altcha">/);
  });
});

test("proxy: /.within.website/** goes to ANUBIS_URL with path, query, cookie and true client IP; Set-Cookie comes back", async () => {
  await withFetch(() => {
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=600", "Report-To": "{}", "Server-Timing": "x" });
    headers.append("Set-Cookie", "techaro.lol-anubis-cookie-verification-5ab17f3c=1; Path=/; Secure");
    headers.append("Set-Cookie", "techaro.lol-anubis-original-referer=x; Path=/; Secure");
    headers.append("Set-Cookie", "__cf_bm=zone; Path=/; Secure");
    headers.append("Set-Cookie", "__cflb=lb; Path=/");
    return new Response("<html>challenge</html>", { status: 200, headers });
  }, async (calls) => {
    const res = await worker.fetch(makeRequest("/.within.website/?redir=https%3A%2F%2Fwempos-forum.com%2F", {
      headers: { Accept: "text/html", Cookie: "c=1; __Host-wempo_session=s; techaro.lol-anubis-cookie-verification-5ab17f3c=v", "CF-Connecting-IP": CLIENT_IP, "X-Wempo-Client-Ip": "6.6.6.6", "User-Agent": "UA/2" },
    }), anubisEnv(), {});
    assert.equal(calls.length, 1);
    const { request, init } = calls[0];
    assert.equal(request.url, ANUBIS_URL + "/.within.website/?redir=https%3A%2F%2Fwempos-forum.com%2F");
    assert.equal(request.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(request.headers.get("Cookie"), "techaro.lol-anubis-cookie-verification-5ab17f3c=v");
    assert.equal(request.headers.get("X-Wempo-Client-Ip"), CLIENT_IP);
    assert.equal(request.headers.get("User-Agent"), "UA/2");
    assert.equal(request.headers.get("X-Forwarded-Host"), "wempos-forum.com");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html>challenge</html>");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert.deepEqual(res.headers.getSetCookie(), [
      "techaro.lol-anubis-cookie-verification-5ab17f3c=1; Path=/; Secure",
      "techaro.lol-anubis-original-referer=x; Path=/; Secure",
    ]);
    assert.equal(res.headers.get("Report-To"), null, "the tunnel zone's own headers are not passed on");
    assert.match(res.headers.get("Content-Security-Policy") || "", /default-src 'self'/, "a strict CSP when Anubis sends none");
    assert.match(res.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  });
});

test("proxy: an Anubis-sent CSP is kept; POST forwards method and body; deep asset paths keep their query", async () => {
  await withFetch(async (request) => new Response(request.method === "POST" ? await request.text() : "js", {
    status: 200, headers: { "Content-Type": "text/javascript", "Content-Security-Policy": "default-src 'none'" },
  }), async (calls) => {
    const asset = await worker.fetch(makeRequest("/.within.website/x/cmd/anubis/static/js/main.mjs?cacheBuster=v1.28.2"), anubisEnv(), {});
    assert.equal(calls[0].request.url, ANUBIS_URL + "/.within.website/x/cmd/anubis/static/js/main.mjs?cacheBuster=v1.28.2");
    assert.equal(asset.headers.get("Content-Security-Policy"), "default-src 'none'");
    const posted = await worker.fetch(makeRequest("/.within.website/x/cmd/anubis/api/pass-challenge?id=1", {
      method: "POST", body: "response=abc&nonce=1", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }), anubisEnv(), {});
    assert.equal(calls[1].request.method, "POST");
    assert.equal(calls[1].request.headers.get("Content-Type"), "application/x-www-form-urlencoded");
    assert.equal(await posted.text(), "response=abc&nonce=1");
  });
});

test("proxy: redirects stay on our origin (Anubis's own origin is rewritten, foreign refused)", async () => {
  for (const [upstream, expected] of [
    ["https://wempos-forum.com/posts/12", "https://wempos-forum.com/posts/12"],
    ["/posts/12", "https://wempos-forum.com/posts/12"],
    [ANUBIS_URL + "/.within.website/?redir=%2F", "https://wempos-forum.com/.within.website/?redir=%2F"],
  ]) {
    await withFetch(() => new Response(null, { status: 302, headers: { Location: upstream } }), async () => {
      const res = await worker.fetch(makeRequest("/.within.website/x/cmd/anubis/api/pass-challenge?redir=x"), anubisEnv(), {});
      assert.equal(res.status, 302, upstream);
      assert.equal(res.headers.get("Location"), expected);
    });
  }
  await withFetch(() => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }), async () => {
    const res = await worker.fetch(makeRequest("/.within.website/x/cmd/anubis/api/pass-challenge?redir=x"), anubisEnv(), {});
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("Location"), null);
  });
});

test("proxy: Anubis unreachable is a small no-store 503", async () => {
  await withFetch(() => { throw new TypeError("connect failed"); }, async () => {
    const res = await worker.fetch(makeRequest("/.within.website/?redir=%2F", { headers: { Accept: "text/html" } }), anubisEnv(), {});
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });
});

test("exempt paths and the API never call Anubis; only the gate and the proxy do", async () => {
  await withFetch(() => { throw new Error("Anubis must not be called"); }, async (calls) => {
    const env = anubisEnv();
    for (const path of ["/js/app.js", "/robots.txt", "/feed.xml", "/locales/en.json", "/styles.css", "/offline.html"]) {
      await worker.fetch(page(path), env, {});
    }
    await worker.fetch(makeRequest("/api/version"), env, {});
    await worker.fetch(makeRequest("/", { method: "POST", headers: { Accept: "text/html" } }), env, {});
    await worker.fetch(makeRequest("/", { headers: { Accept: "application/json" } }), env, {});
    assert.equal(calls.length, 0);
  });
});

test("unconfigured anubis mode: no Anubis call, no proxy, ALTCHA stands in", async () => {
  await withFetch(() => { throw new Error("Anubis must not be called"); }, async (calls) => {
    for (const extra of [{ ANUBIS_URL: undefined }, { ANUBIS_PUBLIC_KEY_HEX: undefined }, { ANUBIS_URL: "http://anubis.test" }]) {
      const env = anubisEnv(extra);
      const res = await worker.fetch(page("/"), env, {});
      assert.match(await res.text(), /<meta name="human-check" content="altcha">/);
      await assert.rejects(requireHumanCheck(write(), env, {}), required);
      const proxied = await worker.fetch(makeRequest("/.within.website/?redir=%2F"), env, {});
      assert.notEqual(proxied.status, 503);
    }
    assert.equal(calls.length, 0);
  });
});

test("verifyAnubisToken: a valid pass token verifies", async () => {
  assert.equal(await verifyAnubisToken(await validToken(), PUBLIC_HEX, CLIENT_IP), true);
});

test("verifyAnubisToken: wrong key, tampered, bad alg, malformed are refused", async () => {
  const good = await validToken();
  const [h, p, s] = good.split(".");
  const otherSigned = await signToken(await passClaims(), { privateKey: otherPair.privateKey });
  const tamperedPayload = b64url(encoder.encode(JSON.stringify({ ...(await passClaims()), policyRule: "zzzz" })));
  const flip = (text) => text.slice(0, 10) + (text[10] === "A" ? "B" : "A") + text.slice(11);
  const cases = {
    wrongKey: otherSigned,
    tamperedPayload: [h, tamperedPayload, s].join("."),
    tamperedSignature: [h, p, flip(s)].join("."),
    algNone: [b64url(encoder.encode(JSON.stringify({ alg: "none", typ: "JWT" }))), p, ""].join("."),
    algHs512: await signToken(await passClaims(), { header: { alg: "HS512", typ: "JWT" } }),
    padded: [h, p, s + "="].join("."),
    twoParts: [h, p].join("."),
    empty: "",
    garbage: "not.a.jwt",
  };
  for (const [name, token] of Object.entries(cases)) {
    assert.equal(await verifyAnubisToken(token, PUBLIC_HEX, CLIENT_IP), false, name);
  }
});

test("verifyAnubisToken: expired, missing exp, not-yet-valid, deny/other action, missing policyRule, other IP are refused", async () => {
  const cases = {
    expired: await validToken({ exp: now() - 1 }),
    missingExp: await validToken({ exp: undefined }),
    stringExp: await validToken({ exp: String(now() + 3600) }),
    notYetValid: await validToken({ nbf: now() + 600 }),
    denyAction: await validToken({ action: "DENY" }),
    allowAction: await validToken({ action: "ALLOW" }),
    noAction: await validToken({ action: undefined }),
    noPolicyRule: await validToken({ policyRule: undefined }),
    numericPolicyRule: await validToken({ policyRule: 7 }),
    otherIp: await validToken({ restriction: await sha256("198.51.100.9") }),
    noRestriction: await validToken({ restriction: undefined }),
    arrayPayload: await signToken([1, 2]),
  };
  for (const [name, token] of Object.entries(cases)) {
    assert.equal(await verifyAnubisToken(token, PUBLIC_HEX, CLIENT_IP), false, name);
  }
});

test("hasAnubisPass: reads the auth cookie (any prefix, optional suffix) and binds it to CF-Connecting-IP", async () => {
  const env = anubisEnv();
  const token = await validToken();
  assert.equal(await hasAnubisPass(write(`${COOKIE_NAME}=${token}`), env), true);
  assert.equal(await hasAnubisPass(write(`session=x; techaro.lol-anubis-auth=${token}`), env), true);
  assert.equal(await hasAnubisPass(write(`${COOKIE_NAME}=${token}`, "198.51.100.9"), env), false, "replayed from another IP");
  assert.equal(await hasAnubisPass(write(`${COOKIE_NAME}=`), env), false, "the deny/clear cookie");
  assert.equal(await hasAnubisPass(write(`techaro.lol-anubis-cookie-verification-5ab17f3c=${token}`), env), false);
  assert.equal(await hasAnubisPass(write(null), env), false);
  assert.equal(await hasAnubisPass(write(`${COOKIE_NAME}=${token}`), anubisEnv({ ANUBIS_URL: undefined })), false, "unconfigured");
});

test("writes in anubis mode: valid pass cookie ok; deny, expired, wrong key, tampered refused", async () => {
  const env = anubisEnv();
  await requireHumanCheck(write(`${COOKIE_NAME}=${await validToken()}`), env, {});
  const otherSigned = await signToken(await passClaims(), { privateKey: otherPair.privateKey });
  const good = await validToken();
  const cut = good.lastIndexOf(".") + 10;
  const tampered = good.slice(0, cut) + (good[cut] === "A" ? "B" : "A") + good.slice(cut + 1);
  for (const cookie of [
    `${COOKIE_NAME}=`,
    `${COOKIE_NAME}=${await validToken({ action: "DENY" })}`,
    `${COOKIE_NAME}=${await validToken({ exp: now() - 5 })}`,
    `${COOKIE_NAME}=${otherSigned}`,
    `${COOKIE_NAME}=${tampered}`,
  ]) {
    await assert.rejects(requireHumanCheck(write(cookie), env, {}), required, cookie.slice(0, 60));
  }
});

test("writes in anubis mode: no cookie + valid ALTCHA ok; nothing at all is 403 required", async () => {
  const env = anubisEnv();
  await requireHumanCheck(write(), env, { altcha: await solvedPayload(env) });
  await assert.rejects(requireHumanCheck(write(), env, {}),
    (error) => error.status === 403 && /Human verification is required/.test(error.message));
  const noAltchaKey = makeEnv({ ...ANUBIS_ENV });
  await assert.rejects(requireHumanCheck(write(), noAltchaKey, {}), required, "configured Anubis, no ALTCHA key: still refused");
  await requireHumanCheck(write(`${COOKIE_NAME}=${await validToken()}`), noAltchaKey, {});
});

test("shell meta per request: anubis with a valid pass cookie, altcha otherwise", async () => {
  await withFetch(() => new Response("", { status: 200 }), async () => {
    const env = anubisEnv();
    const passed = await (await worker.fetch(page("/", { Cookie: `${COOKIE_NAME}=${await validToken()}` }), env, {})).text();
    assert.match(passed, /<meta name="human-check" content="anubis">/);
    const fresh = await (await worker.fetch(page("/"), env, {})).text();
    assert.match(fresh, /<meta name="human-check" content="altcha">/);
    const denied = await (await worker.fetch(page("/", { Cookie: `${COOKIE_NAME}=${await validToken({ action: "DENY" })}` }), env, {})).text();
    assert.match(denied, /<meta name="human-check" content="altcha">/);
  });
});

test("altcha and off modes ignore Anubis entirely, even when it is configured", async () => {
  await withFetch(() => { throw new Error("Anubis must not be called"); }, async (calls) => {
    const altcha = anubisEnv({ HUMAN_CHECK: "altcha" });
    await assert.rejects(requireHumanCheck(write(`${COOKIE_NAME}=${await validToken()}`), altcha, {}), required,
      "altcha mode never accepts an Anubis cookie in place of ALTCHA");
    assert.match(await (await worker.fetch(page("/"), altcha, {})).text(), /<meta name="human-check" content="altcha">/);
    const off = anubisEnv({ HUMAN_CHECK: "off" });
    await requireHumanCheck(write(), off, {});
    assert.doesNotMatch(await (await worker.fetch(page("/"), off, {})).text(), /name="human-check"/);
    for (const env of [altcha, off]) {
      const res = await worker.fetch(makeRequest("/.within.website/?redir=%2F"), env, {});
      assert.notEqual(res.status, 503);
    }
    assert.equal(calls.length, 0);
  });
});

test("client: only content=altcha renders the widget; anubis and unknown mean no widget", () => {
  const original = globalThis.document;
  try {
    for (const [content, expected] of [["altcha", true], ["anubis", false], ["", false], ["other", false]]) {
      globalThis.document = { querySelector: () => ({ content }) };
      assert.equal(humanCheckEnabled(), expected, content);
    }
  } finally {
    globalThis.document = original;
  }
});

// Speed fix (perf seat): a page navigation holding a VALID pass skips the
// Anubis server round-trip (the tunnel to it is slow or asleep), exactly as
// the API gate does; a forged, expired, wrong-IP or deny cookie still asks.
test("page gate: a valid pass cookie makes zero Anubis calls; forged/expired/other-IP/deny still check", async () => {
  await withFetch(() => new Response("", { status: 200 }), async (calls) => {
    const env = anubisEnv();
    const res = await worker.fetch(page("/posts/1", { Cookie: `${COOKIE_NAME}=${await validToken()}` }), env, {});
    assert.equal(res.status, 200);
    assert.equal(calls.length, 0, "a verified pass needs no Anubis round-trip");
    const forged = await signToken(await passClaims(), { privateKey: otherPair.privateKey });
    const refused = [
      page("/", { Cookie: `${COOKIE_NAME}=${forged}` }),
      page("/", { Cookie: `${COOKIE_NAME}=${await validToken({ exp: now() - 10 })}` }),
      page("/", { Cookie: `${COOKIE_NAME}=${await validToken({ action: "DENY" })}` }),
      page("/", { Cookie: `${COOKIE_NAME}=${await validToken()}`, "CF-Connecting-IP": "198.51.100.9" }),
      page("/"),
    ];
    for (const request of refused) await worker.fetch(request, env, {});
    assert.equal(calls.length, refused.length, "every request without a verified pass is checked");
  });
});

test("page gate: a forged pass cookie is still challenged (Anubis's redirect stands)", async () => {
  const forged = await signToken(await passClaims(), { privateKey: otherPair.privateKey });
  const challenge = () => new Response(null, { status: 307, headers: { Location: "https://wempos-forum.com/.within.website/?redir=%2F" } });
  await withFetch(challenge, async () => {
    const res = await worker.fetch(page("/", { Cookie: `${COOKIE_NAME}=${forged}` }), anubisEnv(), {});
    assert.equal(res.status, 307);
    assert.match(res.headers.get("Location"), /\/\.within\.website\//);
  });
});
