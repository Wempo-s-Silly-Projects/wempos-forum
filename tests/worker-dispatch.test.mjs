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

// Phase-2 Kitskey migration pin: worker.mjs stopped carrying its second copy
// of the error mapping. The ONE classifier (errorReply) and the ONE dispatch
// chain (dispatch) come from the vendored framework; this file holds the line
// on the public behavior that must NOT have moved in the swap — the two 404
// copies, the shared 500 for a non-HttpError, and the console label.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";

const WORKER_SOURCE = readFileSync(new URL("../worker.mjs", import.meta.url), "utf8");

// A db stub that answers every read nothing and every run a change — enough
// for the dispatch tier (filter priming reads site_settings, catches nothing
// found) to reach the route chain.
function stubDb() {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      };
    },
  };
}

const okEnv = (overrides = {}) => ({
  FORUM_DB: stubDb(),
  READ_RATE_LIMITER: { limit: async () => ({ success: true }) },
  WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ...overrides,
});

// --- structural: the copy is gone, the vendor is consumed ----------------------

test("worker.mjs no longer carries its own apiError — the classifier is the vendor's", () => {
  assert.ok(!/function apiError/.test(WORKER_SOURCE), "the inline second copy is gone");
  assert.match(WORKER_SOURCE, /import \{ dispatch, errorReply \} from "\.\/api\/vendor\/http\.mjs"/);
  assert.match(WORKER_SOURCE, /errorReply\(error, "Forum request failed:"\)/,
    "the console label keeps the pair's literal");
});

test("the not-found tail stays THROWN 404s classified through the chain, not a rival shape", () => {
  const tail = WORKER_SOURCE.slice(WORKER_SOURCE.indexOf("function notFound"));
  assert.match(tail, /That API endpoint does not exist\./);
  assert.match(tail, /Not found\./, "the tail keeps BOTH the api copy and the bare copy");
  assert.match(WORKER_SOURCE, /dispatch\(API_HANDLERS, notFound\)/,
    "the chain is the vendor dispatch, not an inlined handlers-for-loop");
});

// --- behavior: the swap cannot answer differently than the inline twin did ----

test("an unknown /api/ path answers the api 404 copy WITH the security header set", async () => {
  const response = await worker.fetch(new Request("https://forum.test/api/no-such-lane"), okEnv(), undefined);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "That API endpoint does not exist." });
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
});

test("a non-HttpError inside the chain takes the shared 500 and never echoes the error", async () => {
  const captured = [];
  const original = console.error;
  console.error = (...args) => captured.push(args);
  try {
    const response = await worker.fetch(
      new Request("https://forum.test/api/no-such-lane", { method: "POST" }),
      okEnv({ WRITE_RATE_LIMITER: { limit: async () => { throw new Error("limiter exploded"); } } }),
      undefined,
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Something went wrong. Please try again." });
    assert.deepEqual(captured[0][0], "Forum request failed:", "the console label survived the swap verbatim");
  } finally {
    console.error = original;
  }
});

// --- phase 4 (Kitskey migration): the static leg rides the vendor ---------------

test("worker.mjs stops carrying the static-leg twins — they come from the core leaf now", () => {
  assert.ok(!/function secureResponse/.test(WORKER_SOURCE), "the re-wrap comes from core via makeHttp");
  assert.ok(!/isDocumentRequest|CONDITIONAL_HEADERS/.test(WORKER_SOURCE), "the conditional-get trade is the framework verbatim");
  assert.match(WORKER_SOURCE, /import \{ HttpError, json, rateLimit, secureResponse, unconditional \} from "\.\/api\/core\/http\.mjs"/,
    "the static leg comes from the core leaf via the worker's import");
  // The build stamp STAYS app-side: the injection is this app's document.
  assert.match(WORKER_SOURCE, /async function stampedAssetResponse/);
  assert.match(WORKER_SOURCE, /secureResponse\(await stampedAssetResponse\(await env\.ASSETS\.fetch\(unconditional\(request\)\), env\)\)/);
});

// Behavior through the static leg (a recording ASSETS stub): the re-wrap
// carries the framework-default policy — which IS the forum's set byte-for-
// byte, so core binds no securityHeaders override (the divergence wiring is
// GC's, not ours) — and the conditional-get trade applies to documents only,
// now decided by the vendored unconditional.
test("the forum core binds NO securityHeaders override — the vendor default is already ours", async () => {
  const { readFileSync } = await import("node:fs");
  const coreSource = readFileSync(new URL("../api/core/http.mjs", import.meta.url), "utf8");
  assert.ok(!/securityHeaders,\s*\n/.test(coreSource),
    "no override config: the framework default set is the forum's set");
  const core = await import("../api/core/http.mjs");
  const response = core.secureResponse(new Response("x", { headers: { "ETag": '"v1"' } }));
  assert.equal(response.headers.get("ETag"), '"v1"', "upstream validators ride through the re-wrap");
  assert.equal(
    response.headers.get("Permissions-Policy"),
    "camera=(), microphone=(), geolocation=()",
    "the framework default policy IS the forum's policy",
  );
});

test("a document request drops conditionals and re-wraps with the security set", async () => {
  const seen = [];
  const env = {
    ASSETS: {
      fetch(request) {
        seen.push(request.headers);
        return new Response("<html><head></head></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", "ETag": '"v1"' },
        });
      },
    },
  };
  const response = await worker.fetch(
    new Request("https://forum.test/", {
      headers: { "If-None-Match": '"v1"', "If-Modified-Since": "yesterday" },
    }),
    env,
    undefined,
  );
  assert.equal(response.status, 200);
  const arriving = seen[0];
  assert.equal(arriving.get("If-None-Match"), null, "the document's conditionals were dropped upstream");
  assert.equal(arriving.get("If-Modified-Since"), null);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("a script asset keeps its conditionals (the 304 revalidation path survives)", async () => {
  const seen = [];
  const env = {
    ASSETS: {
      fetch(request) {
        seen.push(request.headers);
        return new Response("module.exports = {}", {
          status: 200,
          headers: { "Content-Type": "text/javascript; charset=utf-8" },
        });
      },
    },
  };
  const response = await worker.fetch(
    new Request("https://forum.test/app.js", {
      headers: { "Sec-Fetch-Dest": "script", "If-None-Match": '"v1"' },
    }),
    env,
    undefined,
  );
  assert.equal(response.status, 200);
  assert.equal(seen[0].get("If-None-Match"), '"v1"', "the conditionals were NOT dropped for a script");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY", "the re-wrap still applies");
});
