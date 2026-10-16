// Frontend syntax gate: every shipped client file must PARSE. node --test can
// import render.js etc. but app.js's module top-level touches `document`, and
// wrangler deploy --dry-run validates only the worker — a stray brace in any
// client file would otherwise reach a deploy unnoticed (the C milestone
// implementer found exactly such an error, a stray brace in renderRoute).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const jsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "js");

test("every public/js file parses (node --check)", () => {
  const files = readdirSync(jsDir).filter((name) => name.endsWith(".js"));
  assert.ok(files.length >= 10, "the icon/glue modules exist");
  for (const name of files) {
    execFileSync(process.execPath, ["--check", path.join(jsDir, name)], { stdio: "pipe" });
  }
});
