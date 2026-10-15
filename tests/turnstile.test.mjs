import test from "node:test";
import assert from "node:assert/strict";

const freshTurnstile = (unique) => import(`../public/js/turnstile.js?case=${unique}`);

test("a failed widget load is retried instead of cached forever", async () => {
  const { ensureTurnstile } = await freshTurnstile("retry");
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = { turnstile: undefined };
  globalThis.document = { createElement: () => ({}), head: { append: () => {} } };
  try {
    await assert.rejects(
      ensureTurnstile(20),
      (error) => /failed to load/.test(error.message),
    );
    // A later attempt starts fresh: once window.turnstile exists it succeeds
    // without waiting for a page reload.
    globalThis.window = { turnstile: { render: () => 1 } };
    const turnstile = await ensureTurnstile(20);
    assert.equal(typeof turnstile.render, "function");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("a successful load is cached and reused by later attempts", async () => {
  const { ensureTurnstile } = await freshTurnstile("cached");
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let appended = 0;
  globalThis.window = { turnstile: { render: () => 2 } };
  globalThis.document = {
    createElement: () => ({}),
    head: { append: () => { appended += 1; } },
  };
  try {
    const first = await ensureTurnstile(20);
    const second = await ensureTurnstile(20);
    assert.equal(first, second);
    assert.equal(appended, 1);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});