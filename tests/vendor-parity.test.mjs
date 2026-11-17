// The Kitskey vendor pin (phase 1 of the framework migration): api/vendor/
// is NOT an app-owned copy of the framework — each vendored file must be
// byte-identical to the Project Kitskey source it vendors, in the sibling
// checkout at /Users/itswempo/project-designer. A drift in EITHER direction
// fails here: copy a framework change in deliberately (vendor the file, run
// the suite), or copy an app-side fix upstream to the framework — never edit
// the vendored file in place.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_HTTP = path.resolve(HERE, "..", "..", "project-designer", "experience", "http.mjs");
const VENDORED_HTTP = path.resolve(HERE, "..", "api", "vendor", "http.mjs");

test("api/vendor/http.mjs is byte-identical to the Kitskey framework source", () => {
  assert.equal(readFileSync(VENDORED_HTTP, "utf8"), readFileSync(FRAMEWORK_HTTP, "utf8"));
});

// The vendored module's HttpError must be THE HttpError the app throws and
// classifies: core/http.mjs re-exports the vendor class, and worker.mjs's
// apiError does `instanceof HttpError` against the core import — so the
// re-export chain, not a second class, is what keeps the 500/4xx
// classification alive after the migration.
test("core/http.mjs re-exports the vendored HttpError (one class, not a twin)", async () => {
  const vendor = await import("../api/vendor/http.mjs");
  const core = await import("../api/core/http.mjs");
  assert.equal(core.HttpError, vendor.HttpError);
  const error = new core.HttpError(418, "teapot");
  assert.equal(core.errorReply(error).status, 418, "the vendor classifier classifies the re-exported class");
});

// The vendor surface's behavior through the re-exports: the config-bound
// half carries the forum's limiter map (scope -> binding name), and the
// error/response vocabulary behaves exactly as before the migration — a
// failed limiter lookup is the hard 503, a non-HttpError is the shared 500.
test("the migrated core leaf answers through the vendor vocabulary", async () => {
  const core = await import("../api/core/http.mjs");
  const response = core.json({ ok: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");

  const limiterless = { RATE_LIMITS: undefined };
  await assert.rejects(
    core.rateLimit(new Request("https://wempos-forum.itswempo.workers.dev/"), limiterless, "login"),
    (error) => error instanceof core.HttpError && error.status === 503,
    "a missing limiter stays the hard 503, never a silently unlimited route",
  );

  const fallback = core.errorReply(new Error("boom"), "Test:");
  assert.equal(fallback.status, 500, "a non-HttpError takes the shared 500");
});
