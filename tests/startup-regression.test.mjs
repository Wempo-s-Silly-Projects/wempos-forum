import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../public/js/app.js", import.meta.url);
const htmlUrl = new URL("../public/index.html", import.meta.url);
const themePreloadUrl = new URL("../public/js/theme-preload.js", import.meta.url);

test("app startup imports its theme helpers before initializing the router", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /import \{ applyCornerPreference, initTheme \} from "\.\/theme\.js";/);
  assert.ok(app.indexOf("applyCornerPreference(document, storage)") < app.indexOf("router = startRouter("));
  assert.match(app, /The forum could not start/);
});

test("theme prepaint uses a same-origin external script allowed by the strict CSP", async () => {
  const html = await readFile(htmlUrl, "utf8");
  const preload = await readFile(themePreloadUrl, "utf8");
  assert.match(html, /<script src="\/js\/theme-preload\.js"><\/script>/);
  assert.ok(html.indexOf("/js/theme-preload.js") < html.indexOf('rel="stylesheet"'));
  assert.match(preload, /localStorage\.getItem\("forum-theme"\)/);
  assert.doesNotMatch(html, /<script>\s*\/\/ No-flash pin/);
});

test("composer dialog state uses form references rather than positional selectors", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /let activeGifComposerForm = null;/);
  assert.match(app, /let activePollComposerForm = null;/);
  assert.doesNotMatch(app, /cssSelectorOfForm/);
});
