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

// Batch K item 1: the one api() wrapper retries idempotent requests with
// backoff on network errors and 5xx, never a plain POST, and a small limiter
// caps concurrency for batched reads. p-retry/p-limit import bare package
// names (is-network-error, yocto-queue) that a no-bundler page cannot resolve
// without an inline import map (CSP forbids inline script), so the same
// behaviour lives in a small first-party module, public/js/request-retry.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as constants from "../constants.mjs";
import { api, apiBatch, setRetrySleep } from "../public/js/api.js";
import {
  API_BATCH_CONCURRENCY, API_RETRY_ATTEMPTS, API_RETRY_BASE_DELAY_MS, API_RETRY_FACTOR,
  backoffDelay, createLimit, isRetryableMethod,
} from "../public/js/request-retry.js";

const sleeps = [];
setRetrySleep(async (ms) => { sleeps.push(ms); });

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function scriptFetch(steps) {
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init.method });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step();
  };
  sleeps.length = 0;
  return calls;
}

test("client retry constants mirror constants.mjs", () => {
  assert.equal(API_RETRY_ATTEMPTS, constants.API_RETRY_ATTEMPTS);
  assert.equal(API_RETRY_BASE_DELAY_MS, constants.API_RETRY_BASE_DELAY_MS);
  assert.equal(API_RETRY_FACTOR, constants.API_RETRY_FACTOR);
  assert.equal(API_BATCH_CONCURRENCY, constants.API_BATCH_CONCURRENCY);
  assert.ok(API_RETRY_ATTEMPTS >= 1 && API_RETRY_ATTEMPTS <= 3);
  assert.deepEqual([backoffDelay(0), backoffDelay(1)],
    [API_RETRY_BASE_DELAY_MS, API_RETRY_BASE_DELAY_MS * API_RETRY_FACTOR]);
});

test("only GET/HEAD/OPTIONS, an idempotency key or an explicit idempotent flag are retryable", () => {
  assert.equal(isRetryableMethod("GET"), true);
  assert.equal(isRetryableMethod("head"), true);
  assert.equal(isRetryableMethod("POST"), false);
  assert.equal(isRetryableMethod("DELETE"), false);
  assert.equal(isRetryableMethod("POST", { idempotencyKey: "k-1" }), true);
  assert.equal(isRetryableMethod("PUT", { idempotent: true }), true);
  assert.equal(isRetryableMethod("POST", { idempotencyKey: "" }), false);
  assert.equal(isRetryableMethod("POST", { idempotent: "yes" }), false);
});

test("a GET that hits a network error is retried with backoff and then succeeds", async () => {
  const calls = scriptFetch([new TypeError("Failed to fetch"), () => jsonResponse(200, { ok: 1 })]);
  assert.deepEqual(await api("/api/posts"), { ok: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [API_RETRY_BASE_DELAY_MS]);
});

test("a GET that keeps answering 5xx stops after the retry budget and surfaces the server error", async () => {
  const calls = scriptFetch([() => jsonResponse(503, { error: "Busy" })]);
  await assert.rejects(api("/api/posts"), (error) => error.status === 503 && /Busy/.test(error.message));
  assert.equal(calls.length, API_RETRY_ATTEMPTS + 1);
  assert.deepEqual(sleeps, Array.from({ length: API_RETRY_ATTEMPTS }, (_, attempt) => backoffDelay(attempt)));
});

test("a plain POST is never retried, on a network error or on a 5xx", async () => {
  let calls = scriptFetch([new TypeError("Failed to fetch"), () => jsonResponse(200, {})]);
  await assert.rejects(api("/api/posts", { method: "POST", body: { body: "hi" } }), /Failed to fetch/);
  assert.equal(calls.length, 1);
  calls = scriptFetch([() => jsonResponse(502, { error: "Bad gateway" }), () => jsonResponse(200, {})]);
  await assert.rejects(api("/api/posts", { method: "POST", body: {} }), (error) => error.status === 502);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test("a POST carrying an idempotency key, or marked idempotent, is retried", async () => {
  let calls = scriptFetch([() => jsonResponse(503, {}), () => jsonResponse(200, { id: 9 })]);
  assert.deepEqual(await api("/api/posts", { method: "POST", body: {}, idempotencyKey: "k-1" }), { id: 9 });
  assert.equal(calls.length, 2);
  calls = scriptFetch([new TypeError("offline"), () => jsonResponse(200, { done: true })]);
  assert.deepEqual(await api("/api/me/read-all", { method: "POST", idempotent: true }), { done: true });
  assert.equal(calls.length, 2);
});

test("4xx answers, aborted requests and retry:false are never retried", async () => {
  let calls = scriptFetch([() => jsonResponse(404, { error: "Missing" })]);
  await assert.rejects(api("/api/posts/1"), (error) => error.status === 404);
  assert.equal(calls.length, 1);
  calls = scriptFetch([new DOMException("aborted", "AbortError"), () => jsonResponse(200, {})]);
  await assert.rejects(api("/api/posts"), (error) => error.name === "AbortError");
  assert.equal(calls.length, 1);
  calls = scriptFetch([new TypeError("Failed to fetch"), () => jsonResponse(200, {})]);
  await assert.rejects(api("/api/version", { retry: false }), /Failed to fetch/);
  assert.equal(calls.length, 1);
});

test("as: 'blob' hands back the body as a Blob for image downloads", async () => {
  scriptFetch([() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } })]);
  const blob = await api("/api/avatars/1", { as: "blob" });
  assert.ok(blob instanceof Blob);
  assert.equal(blob.size, 3);
});

test("createLimit never runs more than its concurrency at once and keeps results in order", async () => {
  const limit = createLimit(2);
  let active = 0;
  let peak = 0;
  const job = (value) => limit(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return value;
  });
  assert.deepEqual(await Promise.all([1, 2, 3, 4, 5].map(job)), [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  await assert.rejects(limit(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await job(6), 6, "a rejected job frees its slot");
});

test("apiBatch settles every request through the limiter, in order", async () => {
  let active = 0;
  let peak = 0;
  globalThis.fetch = async (path) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return path.endsWith("/bad") ? jsonResponse(404, { error: "nope" }) : jsonResponse(200, { path });
  };
  const paths = Array.from({ length: 9 }, (_, index) => `/api/x/${index}`).concat("/api/x/bad");
  const results = await apiBatch(paths.map((path) => [path]));
  assert.equal(results.length, paths.length);
  assert.deepEqual(results[0], { status: "fulfilled", value: { path: "/api/x/0" } });
  assert.equal(results.at(-1).status, "rejected");
  assert.ok(peak <= API_BATCH_CONCURRENCY, `peak ${peak}`);
});
