// Role-vocabulary guard (v3.1): the stored role constants live in
// api/core/roles.mjs and every module that references one must import or
// define it. The 2026-11-04 promote 500 — moderation.mjs used ROLE_ADMIN_DB without
// importing it, so every promote/demote died in a request-time
// ReferenceError that no static check caught — is the reason this exists.
// "OK" means the name appears inside some import statement or a local
// export; anything else is an offender.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "api");

test("every ROLE_*_DB referenced in an api module is imported or defined there", () => {
  const offenders = [];
  for (const entry of readdirSync(apiDir)) {
    if (!entry.endsWith(".mjs")) continue;
    const source = readFileSync(join(apiDir, entry), "utf8");
    const known = new Set();
    for (const m of source.matchAll(/import\s*\{([^}]*)\}/gs)) {
      for (const name of m[1].split(",")) {
        const trimmed = name.trim().split(/\s+as\s+/)[0];
        if (trimmed) known.add(trimmed);
      }
    }
    for (const m of source.matchAll(/export const (ROLE_[A-Z]+_DB)\b/g)) {
      known.add(m[1]);
    }
    for (const m of source.matchAll(/\b(ROLE_[A-Z]+_DB)\b/g)) {
      if (known.has(m[1])) continue;
      offenders.push(entry + " references " + m[1] + " without importing it");
    }
  }
  assert.deepEqual(offenders, []);
});
