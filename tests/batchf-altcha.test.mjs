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

// Batch F (account security), item 5: the self-hosted proof-of-work human
// check (ALTCHA) replaces Cloudflare Turnstile everywhere. Pins: no key = no
// check (self-hosting), a configured key refuses missing/tampered/expired/
// replayed solutions, the key never leaves the worker, Turnstile is gone from
// code and CSP, and the vendored client library is byte-pinned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createChallenge, solveChallenge } from "altcha-lib/v1";
import worker from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { call, forgeSession, makeRequest, seedUser } from "./helpers/seed.mjs";
import { humanCheckKey, requireHumanCheck } from "../api/core/human-check.mjs";
import { solveHumanChallenge } from "../public/js/human-check.js";
import { ALTCHA_MAX_NUMBER } from "../constants.mjs";
import { BATCHF_VENDOR_PINS } from "./helpers/batchf-vendor-pins.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const KEY = "altcha-test-hmac-key-0123456789abcdef";
const request = () => new Request("https://wempos-forum.com/api/posts", { method: "POST" });

async function solvedPayload(env) {
  const res = await call(env, "/api/altcha/challenge");
  assert.equal(res.status, 200);
  return solveHumanChallenge(await res.json());
}

test("no key configured: no human check, and no challenge endpoint", async () => {
  const env = makeEnv();
  await requireHumanCheck(request(), env, {});
  assert.equal(await humanCheckKey(env), null);
  assert.equal((await call(env, "/api/altcha/challenge")).status, 404);
});

test("challenge endpoint: signed SHA-256 challenge, capped work, no key material", async () => {
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY });
  const res = await call(env, "/api/altcha/challenge");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const text = await res.text();
  assert.ok(!text.includes(KEY));
  const challenge = JSON.parse(text);
  assert.deepEqual(Object.keys(challenge).sort(), ["algorithm", "challenge", "maxnumber", "salt", "signature"]);
  assert.equal(challenge.algorithm, "SHA-256");
  assert.equal(challenge.maxnumber, ALTCHA_MAX_NUMBER);
  assert.match(challenge.salt, /expires=\d+/);
});

test("a configured key refuses a missing or oversized payload", async () => {
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY });
  await assert.rejects(requireHumanCheck(request(), env, {}),
    (error) => error.status === 403 && /Human verification is required/.test(error.message));
  await assert.rejects(requireHumanCheck(request(), env, { altcha: "x".repeat(5000) }),
    (error) => error.status === 403);
});

test("a solved challenge passes once; the replay is refused", async () => {
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY });
  const altcha = await solvedPayload(env);
  await requireHumanCheck(request(), env, { altcha });
  await assert.rejects(requireHumanCheck(request(), env, { altcha }),
    (error) => error.status === 403 && /Human verification failed/.test(error.message));
});

test("a tampered number or a foreign signature is refused", async () => {
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY });
  const altcha = await solvedPayload(env);
  const decoded = JSON.parse(atob(altcha));
  const wrongNumber = btoa(JSON.stringify({ ...decoded, number: decoded.number + 1 }));
  await assert.rejects(requireHumanCheck(request(), env, { altcha: wrongNumber }), (error) => error.status === 403);
  const foreign = await createChallenge({ hmacKey: "someone-else", maxNumber: 50 });
  const solution = await solveChallenge(foreign.challenge, foreign.salt, foreign.algorithm, 50).promise;
  const forged = btoa(JSON.stringify({ ...foreign, number: solution.number }));
  await assert.rejects(requireHumanCheck(request(), env, { altcha: forged }), (error) => error.status === 403);
});

test("an expired challenge is refused", async () => {
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY });
  const stale = await createChallenge({ hmacKey: KEY, maxNumber: 50, expires: new Date(Date.now() - 1000) });
  const solution = await solveChallenge(stale.challenge, stale.salt, stale.algorithm, 50).promise;
  const altcha = btoa(JSON.stringify({
    algorithm: stale.algorithm, challenge: stale.challenge, number: solution.number,
    salt: stale.salt, signature: stale.signature,
  }));
  await assert.rejects(requireHumanCheck(request(), env, { altcha }), (error) => error.status === 403);
});

test("existing deployments keep a check with no new secret: the key derives from TURNSTILE_SECRET", async () => {
  const env = makeEnv({ TURNSTILE_SECRET: "legacy-owner-secret" });
  const key = await humanCheckKey(env);
  assert.equal(typeof key, "string");
  assert.notEqual(key, "legacy-owner-secret", "the stored secret is never used raw");
  assert.ok(key.length >= 32);
  assert.equal(key, await humanCheckKey(env), "deterministic across isolates");
  await assert.rejects(requireHumanCheck(request(), env, {}), (error) => error.status === 403);
  const explicit = await humanCheckKey(makeEnv({ TURNSTILE_SECRET: "legacy-owner-secret", ALTCHA_HMAC_KEY: KEY }));
  assert.equal(explicit, KEY, "an explicit ALTCHA_HMAC_KEY wins");
});

test("POST /api/posts and replies: refused without a solution, accepted with one", async () => {
  const env = makeEnv({ ALTCHA_HMAC_KEY: KEY });
  const id = await seedUser(env.__sqlite, { username: "Poster" });
  const session = forgeSession(env.__sqlite, id);
  const refused = await call(env, "/api/posts", { method: "POST", session, body: { body: "no proof", board: "general" } });
  assert.equal(refused.status, 403);
  const ok = await call(env, "/api/posts", {
    method: "POST", session, body: { body: "with proof", board: "general", altcha: await solvedPayload(env) },
  });
  assert.equal(ok.status, 201, await ok.clone().text());
  const { id: postId } = await ok.json();
  const replyRefused = await call(env, "/api/posts/" + postId + "/replies", { method: "POST", session, body: { body: "r" } });
  assert.equal(replyRefused.status, 403);
});

test("the HTML shell announces the human check only when configured; no Turnstile meta", async () => {
  const on = makeEnv({ ALTCHA_HMAC_KEY: KEY, TURNSTILE_SITEKEY: "0xOLD" });
  const html = await (await worker.fetch(makeRequest("/", { headers: { Accept: "text/html" } }), on, {})).text();
  assert.match(html, /<meta name="human-check" content="altcha">/);
  assert.doesNotMatch(html, /turnstile/i);
  const off = makeEnv();
  const plain = await (await worker.fetch(makeRequest("/", { headers: { Accept: "text/html" } }), off, {})).text();
  assert.doesNotMatch(plain, /name="human-check"/);
});

test("CSP: challenges.cloudflare.com is gone from documents and JSON", async () => {
  const env = makeEnv();
  const doc = await worker.fetch(makeRequest("/", { headers: { Accept: "text/html" } }), env, {});
  const api = await call(env, "/api/version");
  for (const res of [doc, api]) {
    const csp = res.headers.get("Content-Security-Policy");
    assert.ok(csp, "CSP present");
    assert.doesNotMatch(csp, /challenges\.cloudflare\.com/);
    assert.doesNotMatch(csp, /frame-src/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /connect-src 'self';/);
  }
});

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "vendor" || name === "locales") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test("Turnstile is gone from first-party code", () => {
  const files = [...walk(new URL("api", ROOT).pathname), ...walk(new URL("public", ROOT).pathname),
    new URL("worker.mjs", ROOT).pathname, new URL("constants.mjs", ROOT).pathname];
  for (const file of files) {
    if (!/\.(mjs|js|css|html)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    // Only human-check.mjs (legacy key derivation) and http.mjs (stripping the
    // origin from the vendor CSP) may still NAME the retired service.
    assert.doesNotMatch(text, /requireTurnstile|cf-turnstile|turnstile-slot|turnstile\.js|TURNSTILE_SITEKEY|TURNSTILE_HOSTNAMES|turnstile\/v0|window\.turnstile/i, file);
    if (!/core\/(human-check|http)\.mjs$/.test(file)) assert.doesNotMatch(text, /turnstile|challenges\.cloudflare\.com/i, file);
  }
});

test("the client solver is the vendored altcha-lib v1, byte for byte, with no added banner", () => {
  for (const path of ["public/js/vendor/altcha-lib/v1/index.js", "public/js/vendor/altcha-lib/v1/helpers.js"]) {
    const bytes = readFileSync(new URL(path, ROOT));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), BATCHF_VENDOR_PINS[path], path);
  }
  assert.match(read("public/js/human-check.js"), /import\("\.\/vendor\/altcha-lib\/v1\/index\.js"\)/);
  const reuse = read("REUSE.toml");
  assert.match(reuse, /public\/js\/vendor\/altcha-lib\/\*\*/);
});
