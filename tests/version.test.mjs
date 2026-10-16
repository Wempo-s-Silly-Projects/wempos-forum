// GET /api/version serves the footer version stamp. It reads only wrangler
// vars (VERSION) and the deploy-time --var (COMMIT_SHA), so no database is
// involved: the env below fails the test if any SQL runs. Missing vars fall
// back to empty strings, pinned here so the frontend's "render nothing for a
// missing part" behavior has a stable contract.
import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";

function versionEnv(vars) {
  return {
    // Any database access through this stub fails the test loudly.
    FORUM_DB: {
      prepare() {
        throw new Error("/api/version must not query the database");
      },
    },
    READ_RATE_LIMITER: {
      async limit() {
        return { success: true };
      },
    },
    ...vars,
  };
}

async function getVersion(env) {
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/version", { method: "GET" }),
    env,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") || "", /application\/json/i);
  return response;
}

test("GET /api/version returns the version and commit from env without auth", async () => {
  const response = await getVersion(versionEnv({ VERSION: "2.2.0", COMMIT_SHA: "dcdd4ea" }));
  assert.deepEqual(await response.json(), { version: "2.2.0", commit: "dcdd4ea" });
});

test("GET /api/version degrades to empty strings when the env vars are absent", async () => {
  const response = await getVersion(versionEnv({}));
  assert.deepEqual(await response.json(), { version: "", commit: "" });
});