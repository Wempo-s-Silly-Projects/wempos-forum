# v4.0 Plan 1 — Core Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dissolve `api/shared.mjs`'s core responsibilities into single-purpose leaves under `api/core/`, changing zero behavior and zero importer files.

**Architecture:** Verbatim moves. Each task lifts one family of functions out of `api/shared.mjs` into a new `api/core/<name>.mjs`; `shared.mjs` imports them back and re-exports, so all 18 importers (17 api modules + worker.mjs) and every test keep working untouched. What is genuinely topic-owned (profile colors, avatar read route, archive statement, profile-CSS sandbox) stays in `shared.mjs` for plans 2–3 to claim; the shim dies in the final sweep.

**Tech Stack:** Cloudflare Workers ESM (`.mjs`), D1, node:test.

**Spec:** `docs/superpowers/specs/2026-11-05-v4-rewrite-design.md` — Backend design section (import-layer rule, splits). This is plan 1 of 6; plans 2–6 are written just-in-time.

## Global Constraints

- API surface identical — no path, method, status, or payload changes (spec invariant 1).
- DB schema frozen — no migrations, no SQL string changes (spec invariant 2).
- CSP/security headers and secrets contract identical (spec invariant 4).
- The suite (`npm test`) and `npx wrangler deploy --dry-run` are green at every commit (spec invariant 6).
- Moves are verbatim — no renames, no signature changes, no logic edits. A discovered bug is reported, never silently fixed inside a move.
- `worker.mjs`'s `export { … } from` re-export surface does not change.
- Import direction is one-way: `core/` files may import other `core/` files (crypto is the bottom), never topic modules; topic modules and `shared.mjs` import core; nothing in core imports topics.

## Review Focus

1. **A core leaf importing a topic module** (backwards edge → cycle). Pinned by Task 1's layer test, which scans every `api/core/*.mjs` for any import outside `core/`.
2. **A name moved but left defined in shared.mjs** (double definition shadows the move; two divergent copies drift silently). Pinned by Task 1's export-parity check listing shared.mjs's exact export surface, and by each move task's rule: the moved code is *deleted* from shared.mjs, replaced by an import.
3. **An intra-shared helper moves and shared.mjs's own leftover code loses it** (e.g. `nowSeconds`, `sha256Hex` are used by code that stays). Pinned by the suite (image-sanitize, roles, session, filter tests all exercise shared paths) plus `wrangler deploy --dry-run` catching unresolved references at bundle time.
4. **A test importing a moved name from its old path** breaks — tests import `../api/shared.mjs` and `../worker.mjs` directly. Pinned by Task 1's export-parity test asserting the old surface exports every historical name; the suite running green proves the shims resolve.
5. **workerd rejecting a new module shape** (it validates every export as function/ExportedHandler). Pinned by the dry-run in every task's verify step.

---

### Task 1: Layer guard — a test that pins the import rule and shared.mjs's export surface

**Files:**
- Create: `tests/core-layers.test.mjs`

**Interfaces:**
- Consumes: none (runs first; fails until core modules exist).
- Produces: the enforcement every later task relies on — `api/core/` may only import within `api/core/`; `api/shared.mjs` must export a fixed name list.

- [ ] **Step 1: Write the failing test**

`tests/core-layers.test.mjs`, two assertions:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// The core layer rule: api/core/*.mjs may import only other api/core files.
test("core modules import nothing outside core/", () => {
  const dir = new URL("../api/core/", import.meta.url);
  let files = [];
  try { files = readdirSync(dir); } catch { return; } // no core/ yet — Task 2+ populates it
  for (const name of files.filter((f) => f.endsWith(".mjs"))) {
    const source = readFileSync(new URL(name, dir), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const target of imports) {
      assert.ok(target.startsWith("./"), `${name} imports "${target}" — core must stay relative-internal`);
    }
  }
});

// The compat surface: every name shared.mjs has ever exported must stay exported
// (worker.mjs re-exports through it; tests and api modules import it directly).
test("shared.mjs keeps its full export surface", async () => {
  const shared = await import("../api/shared.mjs");
  for (const name of [
    "HttpError", "json", "rateLimit", "securityHeaders", "publicRole",
    "ROLE_OWNER_DB", "ROLE_ADMIN_DB", "ROLE_MEMBER_DB", "requestIpHash",
    "assertNetworkNotBanned", "canViewPost", "createSession", "hashPassword",
    "imageResponse", "isValidPassword", "isValidPasswordPepper", "isValidSetupSecret",
    "isValidUsername", "requireTurnstile", "sanitizeImage", "sniffImageMime",
    "verifyPassword", "blobToUint8Array", "createAvatarVersion", "isValidHexColor",
    "archivePostRowsStatement",
  ]) {
    assert.ok(name in shared, `shared.mjs must keep exporting ${name}`);
  }
});
```

(The export list is every `export`/re-export name in shared.mjs as of `2dd922f`; extend it with any name found by `grep -n "export" api/shared.mjs` that isn't listed — the test must encode the *complete* current surface.)

- [ ] **Step 2: Run test to verify it passes against today's tree**

Run: `npm test`
Expected: PASS (no `api/core/` yet; shared.mjs still exports everything). This test is a guard, not a driver — it must be green before the first move and stay green after every one.

- [ ] **Step 3: Commit**

```bash
git add tests/core-layers.test.mjs
git commit -m "v4.0: layer guard test — core import rule + shared.mjs export surface"
```

---

### Task 2: `api/core/crypto.mjs` — the bottom leaf

**Files:**
- Create: `api/core/crypto.mjs`
- Modify: `api/shared.mjs`

**Interfaces:**
- Consumes: nothing (Web Crypto + TextEncoder only).
- Produces: `nowSeconds()`, `hex(bytes)`, `fromHex(value)`, `base64Url(bytes)`, `randomToken(size=32)`, `sha256Hex(value)`, `equalConstantTime(a,b)` — all async where shared.mjs had them async, same signatures. Later core files and shared.mjs import these from `"./crypto.mjs"` (or `"../core/crypto.mjs"` from shared).

- [ ] **Step 1: Move the code**

Move verbatim from shared.mjs: `encoder`, `nowSeconds`, `hex`, `fromHex`, `base64Url`, `randomToken`, `sha256Hex`, `equalConstantTime`. Delete their definitions from shared.mjs and add `import { … } from "./core/crypto.mjs"` there; keep every existing `export` of these names working by adding them to shared.mjs's `export { … }` block (they are currently exported via the block at shared.mjs:1037 — the names `nowSeconds`, `sha256Hex`, `randomToken`, `equalConstantTime` are already in it; nothing else changes).

- [ ] **Step 2: Verify**

Run: `npm test` → all green. Run: `npx wrangler deploy --dry-run` → clean.
Expected: no failures; the layer test sees `api/core/crypto.mjs` importing nothing.

- [ ] **Step 3: Commit**

```bash
git add api/core/crypto.mjs api/shared.mjs
git commit -m "v4.0: move crypto primitives to api/core/crypto.mjs"
```

---

### Task 3: `api/core/http.mjs` — request/response glue

**Files:**
- Create: `api/core/http.mjs`
- Modify: `api/shared.mjs`

**Interfaces:**
- Consumes: `crypto.mjs` if any moved body needs it (e.g. turnstile's constant-time compare) — import as `./crypto.mjs`.
- Produces: `HttpError`, `MAX_JSON_BYTES`, `json(data, status=200, headers)`, `securityHeaders(headers=new Headers())`, `rateLimit(request, env, scope, actor="")`, `requireTurnstile(request, env, body, expectedAction)`, `readLimitedBody(request, maximum)`, `readJson(request, maxBytes=MAX_JSON_BYTES)`, `requiredText(value, field, maximum)`, `requireMutationApplied(result)` — same signatures.

- [ ] **Step 1: Move the code**

Move verbatim: the `HttpError` class, `MAX_JSON_BYTES`, `securityHeaders`, `json`, `rateLimit`, `requireTurnstile`, `readLimitedBody`, `readJson`, `requiredText`, `requireMutationApplied` (plus the `TURNSTILE_TOKEN_MAX_LENGTH` const and any private helper only they use). shared.mjs imports them back and keeps re-exporting every name it exported before (`HttpError`, `rateLimit`, `requireTurnstile`, `requireMutationApplied`, `readLimitedBody`, `readJson`, `requiredText`, `securityHeaders`, `json`, `MAX_JSON_BYTES`).

- [ ] **Step 2: Verify**

Run: `npm test` → all green. Run: `npx wrangler deploy --dry-run` → clean.

- [ ] **Step 3: Commit**

```bash
git add api/core/http.mjs api/shared.mjs
git commit -m "v4.0: move http glue to api/core/http.mjs"
```

---

### Task 4: `api/core/passwords.mjs` — hashing and credential validation

**Files:**
- Create: `api/core/passwords.mjs`
- Modify: `api/shared.mjs`

**Interfaces:**
- Consumes: `./crypto.mjs` (`hex`, `fromHex`, `sha256Hex`-family as the moved code requires).
- Produces: `isValidPassword(value)`, `isValidPasswordPepper(value)`, `isValidSetupSecret(value)`, `hashPassword(password, pepper)`, `verifyPassword(password, salt, expectedHash, pepper)` — same signatures, PBKDF2 iteration cap unchanged.

- [ ] **Step 1: Move the code**

Move verbatim: `isValidPassword`, `isValidPasswordPepper`, `isValidSetupSecret`, `derivePassword` (private), `hashPassword`, `verifyPassword`. shared.mjs imports back; keeps re-exporting the five public names.

- [ ] **Step 2: Verify**

Run: `npm test` → all green. Run: `npx wrangler deploy --dry-run` → clean.

- [ ] **Step 3: Commit**

```bash
git add api/core/passwords.mjs api/shared.mjs
git commit -m "v4.0: move password hashing to api/core/passwords.mjs"
```

---

### Task 5: `api/core/roles.mjs` — the role vocabulary

**Files:**
- Create: `api/core/roles.mjs`
- Modify: `api/shared.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `ROLE_OWNER_DB = "admin"`, `ROLE_ADMIN_DB = "moderator"`, `ROLE_MEMBER_DB = "member"`, `publicRole(value)` — plus the private `PUBLIC_ROLE_BY_STORED` map. This is the module `tests/roles.test.mjs`'s import-guard concept points at; every api module's `ROLE_*_DB` imports eventually repoint here in later plans (not this one — importers keep using shared.mjs's re-export).

- [ ] **Step 1: Move the code**

Move verbatim: the three `ROLE_*_DB` consts, `PUBLIC_ROLE_BY_STORED`, `publicRole`. shared.mjs imports back, keeps re-exporting all four public names.

- [ ] **Step 2: Verify**

Run: `npm test` → all green (the roles import-guard test reads source, not imports, so it passes regardless). Run: `npx wrangler deploy --dry-run` → clean.

- [ ] **Step 3: Commit**

```bash
git add api/core/roles.mjs api/shared.mjs
git commit -m "v4.0: move role vocabulary to api/core/roles.mjs"
```

---

### Task 6: `api/core/images.mjs` — sanitize, sniff, serve

**Files:**
- Create: `api/core/images.mjs`
- Modify: `api/shared.mjs`

**Interfaces:**
- Consumes: `./http.mjs` only if `imageResponse` needs `securityHeaders`/`json` (read the moved body; import what it actually references — if it builds its own `Response`, no import).
- Produces: `blobToUint8Array(value)`, `sniffImageMime(bytes)`, `sanitizeImage(bytes)`, `imageResponse(bytes, claimedMime, cacheControl)`, `createAvatarVersion()` — plus private `assembleSanitized`, `PNG_DROP_CHUNKS`, `sanitizePng`, `jpegEntropyEnd`, `sanitizeJpeg`, `gifSubBlocksEnd`, `sanitizeGif`, `sanitizeWebp`.

- [ ] **Step 1: Move the code**

Move verbatim (the whole image family, ~260 lines). shared.mjs imports back the five public names; `tests/image-sanitize.test.mjs` keeps passing through its existing import path (worker.mjs or shared.mjs — whichever it uses, unchanged).

- [ ] **Step 2: Verify**

Run: `npm test` → all green (image-sanitize suite is the real pin here). Run: `npx wrangler deploy --dry-run` → clean.

- [ ] **Step 3: Commit**

```bash
git add api/core/images.mjs api/shared.mjs
git commit -m "v4.0: move image sanitize/sniff/serve to api/core/images.mjs"
```

---

### Task 7: `api/core/auth.mjs` — sessions, cookies, CSRF, guards

**Files:**
- Create: `api/core/auth.mjs`
- Modify: `api/shared.mjs`

**Interfaces:**
- Consumes: `./crypto.mjs` (`sha256Hex`, `randomToken`, `equalConstantTime`, `nowSeconds`…), `./http.mjs` (`readJson`/`json` as the moved bodies reference), `./roles.mjs` (role comparisons in `requiremod`/`requireAdmin`), `./passwords.mjs` only if `createSession`/`assertNetworkNotBanned` reference it (read the bodies; import exactly what they use).
- Produces: `SESSION_TTL_SECONDS` (private), `requestIpHash(request, env)`, `assertNetworkNotBanned(request, env)`, `setCookie(request, token, maxAge)`, `cookieValue(request, name)`, `readSession(request, env)`, `createSession(request, env, userId=null, oldTokenHash=null, requireUnbanned=false)`, `assertSameOrigin(request)`, `requireCsrf(request, env)`, `requireUser(request, env)`, `requireSignedInRead(request, env)`, `requiremod(request, env, mutating=true)`, `requireAdmin(request, env, mutating=true)`, `assertNotBanned(env, userId)`.

- [ ] **Step 1: Move the code**

Move verbatim. shared.mjs imports back and re-exports the public names it historically exported (`requestIpHash`, `assertNetworkNotBanned`, `createSession`, `readSession`, `requireCsrf`, `requireUser`, `requireSignedInRead`, `requiremod`, `requireAdmin`, `assertSameOrigin`, `assertNotBanned`).

- [ ] **Step 2: Verify**

Run: `npm test` → all green. Run: `npx wrangler deploy --dry-run` → clean.
Expected: the layer test stays green — `auth.mjs` imports only other core files.

- [ ] **Step 3: Commit**

```bash
git add api/core/auth.mjs api/shared.mjs
git commit -m "v4.0: move session/CSRF/guard machinery to api/core/auth.mjs"
```

---

### Task 8: `api/core/visibility.mjs` + `api/core/shapers.mjs` — read-time rules and payload shapes

**Files:**
- Create: `api/core/visibility.mjs`, `api/core/shapers.mjs`
- Modify: `api/shared.mjs`

**Interfaces:**
- Consumes: `visibility.mjs` may need nothing beyond its own SQL over `env` (read the body); `shapers.mjs` imports `./visibility.mjs` if `publicPost` consults it (it receives a precomputed `publicLevel`, so likely not — import exactly what the moved bodies reference).
- Produces: from `visibility.mjs`: `canViewPost(env, row, viewer)`. From `shapers.mjs`: `isValidUsername(value)`, `userByUsernameKey(env, key)`, `SOCIAL_PLATFORMS`, `SOCIAL_SELECT_COLUMNS`, `socialsFromRow(row)`, `publicUser(row)`, `publicPost(row, publicLevel)`, `postById(env, postId, viewerId)`.

- [ ] **Step 1: Move the code**

Move verbatim into the two files (`POST_SELECT` and `VIEW_INCREMENT_SQL` consts belong with `publicPost`/`postById` in shapers). shared.mjs imports back, keeps re-exporting `canViewPost`, `isValidUsername`, `userByUsernameKey`, `SOCIAL_PLATFORMS`, `socialsFromRow`, `publicUser`, `publicPost`, `postById`.

- [ ] **Step 2: Verify**

Run: `npm test` → all green. Run: `npx wrangler deploy --dry-run` → clean.
Expected: shared.mjs is now down to its topic leftovers (profile colors, avatar read route, archive statement, profile-CSS sandbox) plus re-exports.

- [ ] **Step 3: Commit**

```bash
git add api/core/visibility.mjs api/core/shapers.mjs api/shared.mjs
git commit -m "v4.0: move read-time visibility + payload shapers into core"
```

---

### Task 9: Plan-1 close-out — count the shrink, report

**Files:**
- Modify: none.

**Interfaces:**
- Consumes: everything above.
- Produces: the state plans 2–3 start from.

- [ ] **Step 1: Verify the whole plan's invariants**

Run: `npm test` → all green (74+ including the new layer guard). Run: `npx wrangler deploy --dry-run` → clean. Run: `wc -l api/shared.mjs` → expect roughly ≤ 350 (colors + avatar route + archive + CSS sandbox + re-export block); `wc -l api/core/*.mjs` for the record.

- [ ] **Step 2: Report the numbers to the owner (line counts before/after) and note anything discovered but not fixed**

- [ ] **Step 3: Commit (nothing to commit if no drift; commit only if the report touched files)**
