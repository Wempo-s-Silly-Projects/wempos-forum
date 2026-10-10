import test from "node:test";
import assert from "node:assert/strict";
import { api, setCsrfToken } from "./api.js";

async function withFetch(fetchImplementation, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImplementation;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    setCsrfToken("");
  }
}

test("api uses same-origin credentials for a default GET", async () => {
  await withFetch(async (_path, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "same-origin");
    assert.deepEqual(options.headers, { Accept: "application/json" });
    return new Response(JSON.stringify({ posts: [] }), { status: 200 });
  }, async () => {
    assert.deepEqual(await api("/api/posts"), { posts: [] });
  });
});

test("api serializes JSON mutations and includes the CSRF token", async () => {
  setCsrfToken("csrf-123");
  await withFetch(async (_path, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.headers["X-CSRF-Token"], "csrf-123");
    assert.deepEqual(JSON.parse(options.body), { body: "hello" });
    return new Response(JSON.stringify({ id: 7 }), { status: 201 });
  }, async () => {
    assert.deepEqual(await api("/api/posts", {
      method: "POST",
      body: { body: "hello" },
    }), { id: 7 });
  });
});

test("api leaves multipart content type to the browser", async () => {
  const body = new FormData();
  body.append("avatar", new Blob(["image"]));
  await withFetch(async (_path, options) => {
    assert.equal(options.body, body);
    assert.equal("Content-Type" in options.headers, false);
    return new Response(JSON.stringify({ avatarUrl: "/api/avatars/test.png" }), { status: 201 });
  }, async () => {
    assert.deepEqual(await api("/api/me/avatar", { method: "POST", body }), {
      avatarUrl: "/api/avatars/test.png",
    });
  });
});

test("api returns null for a no-content response", async () => {
  await withFetch(async () => new Response(null, { status: 204 }), async () => {
    assert.equal(await api("/api/auth/logout", { method: "POST" }), null);
  });
});

test("api preserves the message and status from a JSON error response", async () => {
  await withFetch(async () => new Response(JSON.stringify({ error: "not allowed" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  }), async () => {
    await assert.rejects(api("/api/admin/reports"), (error) => {
      assert.equal(error.message, "not allowed");
      assert.equal(error.status, 403);
      return true;
    });
  });
});

test("api reports a useful error for a non-JSON response", async () => {
  await withFetch(async () => new Response("not json", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  }), async () => {
    await assert.rejects(api("/api/posts"), (error) => {
      assert.equal(error.message, "Request failed (503)");
      assert.equal(error.status, 503);
      return true;
    });
  });
});

test("api rejects when fetch fails", async () => {
  const networkError = new Error("connection lost");
  await withFetch(async () => {
    throw networkError;
  }, async () => {
    await assert.rejects(api("/api/posts"), (error) => error === networkError);
  });
});
