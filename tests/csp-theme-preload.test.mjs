import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readmePath = new URL("../public/index.html", import.meta.url);
const preloadPath = new URL("../public/js/theme-preload.js", import.meta.url);

test("theme prepaint runs from a same-origin script allowed by the strict CSP", async () => {
  const html = await readFile(readmePath, "utf8");
  assert.match(html, /<script src="\/js\/theme-preload\.js"><\/script>/);
  assert.ok(html.indexOf('<script src="/js/theme-preload.js"></script>') < html.indexOf('<link rel="stylesheet" href="/styles.css">'), "theme preload must appear before the stylesheet");
  assert.doesNotMatch(html, /<script>\s*[\s\S]*?<\/script>/i);
  assert.match(await readFile(preloadPath, "utf8"), /localStorage\.getItem\("forum-theme"\)/);
});

test("theme prepaint only applies recognized stored values", async () => {
    const originalDocument = globalThis.document;
  const originalStorage = globalThis.localStorage;
  try {
    for (const [stored, expected] of [["dark", "dark"], ["light", "light"], ["unknown", undefined], [null, undefined]]) {
      const dataset = {};
      globalThis.document = { documentElement: { dataset } };
      globalThis.localStorage = { getItem: () => stored };
      await import("../public/js/theme-preload.js?stored=" + String(stored));
      assert.equal(dataset.theme, expected);
    }
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalStorage;
  }
});
