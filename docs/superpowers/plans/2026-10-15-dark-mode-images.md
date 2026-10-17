# Dark Mode + Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-switchable dark theme (OS-preference default) and image/GIF attachments on posts and replies (D1-stored uploads, hybrid moderation).

**Architecture:** Attachments follow the avatar pipeline's shape (magic-byte sniffing, D1 blobs, pending/approved byte pairs, mod queue) but live in a new `attachments` table and a new `api/attachments.mjs` module. Dark mode overrides the existing `:root` token block; no second palette.

**Tech Stack:** Cloudflare Workers, D1, vanilla ES modules, node:test.

**Spec:** `docs/superpowers/specs/2026-10-15-dark-mode-images-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- 10 MiB max per attachment (`MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`) stored as ≤1,900,000-byte chunks per spec revision 2 (Task 9); 3 attachments max per post/reply (`MAX_ATTACHMENT_FILES = 3`); buffered request ceiling `MAX_ATTACHMENT_REQUEST_BYTES = 3 * MAX_ATTACHMENT_BYTES + 512 * 1024` (~30.5 MiB). (Tasks 3-7 were built at 1 MiB single-blob; Task 9 raises and re-works this — those tasks' 1 MiB test values are superseded there.)
- Accepted attachment types (by magic bytes, never by client-declared mime): JPEG, PNG, WebP, GIF (`GIF87a`/`GIF89a`). GIF needs only bytes 0–5 to identify, but the existing 12-byte minimum in `sniffImageMime` stays (a shorter "image" is garbage).
- CSP is untouched: `img-src 'self' data:` stays. No external image hosts, ever.
- `requireTurnstile` reads `body["cf-turnstile-response"]` as a string (api/shared.mjs:355) — multipart uploads must surface that form field into the `fields` object passed in.
- Pending attachments serve to the author and mods only; everyone else gets 404. Rejected attachments 404 for everyone.
- New rate-limit scope `"image-upload"` → binding `IMAGE_UPLOAD_RATE_LIMITER`, 5/min, added to `wrangler.toml` following the `AVATAR_UPLOAD_RATE_LIMITER` block (wrangler.toml:86).
- The `api/*.mjs` module split is load-bearing (CLAUDE.md): attachment topics live in `api/attachments.mjs`.
- Keep `public/styles.css`'s light `:root` values as the defaults; dark values are overrides, not a new palette definition site.

## Review Focus

1. **3-file multipart at the ceiling** — a request whose files total ~3 MiB must return 413 with a clean JSON error, never hang or partially insert posts. Test in Task 3.
2. **Client-declared mime mismatch** — a file named `.png` whose bytes are JPEG must store `image/jpeg` (the sniffed type) and serve with that mime. Test in Task 3.
3. **Pending-attachment existence leak** — a non-author requesting a pending attachment must get 404 (not 403), and a guest must get 404. Test in Task 4.
4. **Theme precedence** — a stored manual choice must beat OS preference and survive a malformed localStorage value (falls back to OS preference). Test in Task 8.
5. **Truncated GIF** — a 5-byte file claiming to be a GIF must be rejected (12-byte minimum). Test in Task 2.

---

### Task 1: Migration 0003 — attachments table

**Files:**
- Create: `migrations/0003_attachments.sql`
- Test: `tests/migration.test.mjs`

**Interfaces:**
- Produces: `attachments` table with columns `id TEXT PK`, `post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE`, `created_by INTEGER NOT NULL REFERENCES users(id)`, `created_at INTEGER NOT NULL`, `mime TEXT NOT NULL` (CHECK in the four accepted types), `status TEXT NOT NULL DEFAULT 'pending'` (CHECK `'pending','approved','rejected'`), `version TEXT NOT NULL`, `pending_mime TEXT`, `pending_data BLOB`, `pending_updated_at INTEGER`, `mime`/`data`/`updated_at` (approved pair, nullable), plus indexes on `post_id` and on `status WHERE status='pending'` (partial). CHECK constraints pin status↔pending-pair consistency exactly the way the users table pins `avatar_status` (copy the users-table CHECK style from migration 0002, including `PRAGMA defer_foreign_keys` batching where needed).

- [ ] **Step 1: Write the failing schema test** in `tests/migration.test.mjs`, following that file's existing per-migration test pattern: after applying `0001`+`0002`+`0003`, assert `attachments` exists, accepts a valid pending row, rejects `mime='image/bmp'`, rejects `status='weird'`, and cascades a delete from `posts`.

- [ ] **Step 2: Run** `npm run db:migrate:local && node --test tests/migration.test.mjs` — expect FAIL (file 0003 missing / table absent).

- [ ] **Step 3: Write `migrations/0003_attachments.sql`** creating exactly the schema above. New table only — no rebuild of existing tables.

- [ ] **Step 4: Run** `node --test tests/migration.test.mjs` — expect PASS.

- [ ] **Step 5: Commit** `feat: add attachments table migration (0003)`

### Task 2: GIF support in `sniffImageMime`

**Files:**
- Modify: `api/shared.mjs:101-115` (`sniffImageMime`)
- Test: `tests/attachments.test.mjs` (new file; later tasks append)

**Interfaces:**
- Produces: `sniffImageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null` — signature unchanged, new `"image/gif"` branch matching `GIF87a`/`GIF89a` in bytes 0–5. Later tasks rely on this.

- [ ] **Step 1: Write failing tests** in `tests/attachments.test.mjs` (plain unit test of the export, no worker fetch): `\x47\x49\x46\x38\x39\x61…` (GIF89a + garbage minimum 12 bytes) → `"image/gif"`; GIF87a header → `"image/gif"`; a 12-byte `\x47\x49\x46\x38\x00\x00…` header-mutated file → `null`; a **5-byte** GIF header → `null` (Review Focus #5); and one JPEG/PNG/WebP happy-path case pinning existing behavior.

- [ ] **Step 2: Run** `node --test tests/attachments.test.mjs` — expect FAIL ("image/gif" branch absent).

- [ ] **Step 3: Implement** the GIF branch in `sniffImageMime` (check bytes 0–5 before/alongside the WebP scan; the `length < 12` guard stays).

- [ ] **Step 4: Run** `node --test tests/attachments.test.mjs` — expect PASS. Also run `npm test` to confirm nothing regressed.

- [ ] **Step 5: Commit** `feat: accept GIF images in sniffImageMime`

### Task 3: Attachment intake — multipart on post/reply creation

**Files:**
- Create: `api/attachments.mjs`
- Modify: `api/posts.mjs:226` and `api/posts.mjs:264` (the two `readJson` call sites), `api/posts.mjs` top imports
- Modify: `wrangler.toml` (add `IMAGE_UPLOAD_RATE_LIMITER` binding), `api/shared.mjs` (`rateLimit` scope map — follow the `"avatar-upload"` entry)
- Test: `tests/attachments.test.mjs`

**Interfaces:**
- Consumes: `sniffImageMime` (Task 2), `readLimitedBody`, `readJson`, `rateLimit` from `api/shared.mjs`.
- Produces (all later tasks rely on these exact names):
  - `export const MAX_ATTACHMENT_FILES = 3; export const MAX_ATTACHMENT_BYTES = 1024 * 1024; export const MAX_ATTACHMENT_REQUEST_BYTES = 3 * MAX_ATTACHMENT_BYTES + 512 * 1024;`
  - `export async function readComposedBody(request, env)` → `{ fields: Record<string, string>, files: Array<{ mime: string, bytes: Uint8Array }> }` — `multipart/form-data` bodies are parsed with file inputs collected from the repeatable field name **`images`** and each file validated (≤ `MAX_ATTACHMENT_BYTES` after buffering under `MAX_ATTACHMENT_REQUEST_BYTES`, mime from `sniffImageMime`, unknown type → 400); `application/json` bodies return `{ ...parsed, files: [] }` (old behavior, tests keep working).
  - `export async function insertAttachments(db, postId, createdBy, files)` → INSERTs one row per file (`id` = `crypto.randomUUID()`, `status='pending'`, `version` = random text via the `createAvatarVersion()` pattern), returns the row ids.

- [ ] **Step 1: Write failing tests** through `forumWorker.fetch` with the mock-Db pattern from `tests/moderation-v2.test.mjs` (import the `call`-style helper or copy its ~30 lines): (a) `POST /api/posts` as multipart FormData with one GIF file creates the post and one pending attachment row — assert the INSERT bind array's mime is `"image/gif"` (Review Focus #2's cousin: mime sniffed, not claimed); (b) a `.png`-named JPEG file binds `image/jpeg` (Review Focus #2); (c) 4 files → 400; (d) one 1.1 MiB file → 413; (e) files totalling ~3 MiB with each file individually valid but the request at/above ceiling → 413, and **no posts INSERT appears in the captured SQL calls** (Review Focus #1); (f) a JSON body without `files` still creates a post (backward compat); (g) multipart reply creation on `/api/posts/2/replies` creates an attachment row.
- [ ] **Step 2: Run** `node --test tests/attachments.test.mjs` — expect FAIL (`readComposedBody` not defined).
- [ ] **Step 3: Implement** `api/attachments.mjs` (the two functions + constants). In `posts.mjs`, replace both `readJson(request)` calls with `readComposedBody(request, env)`, feed `fields` to `requireTurnstile`, and after each successful insert call `insertAttachments(db, insertedId, session.user.id, files)` — for replies, `insertedId` is the **reply's own** row id, not the bump target's. Add `if (files.length > 0) await rateLimit(request, env, "image-upload", String(session.user.id));` before validation work in both routes.
- [ ] **Step 4: Add** the `IMAGE_UPLOAD_RATE_LIMITER` binding to `wrangler.toml` and the `"image-upload"` scope mapping in `rateLimit`; extend the test env helper with the new limiter stub.
- [ ] **Step 5: Run** `node --test tests/attachments.test.mjs && npm test` — expect PASS (full suite too).
- [ ] **Step 6: Commit** `feat: accept image attachments on posts and replies`

### Task 4: Serving — `GET /api/attachments/:id`

**Files:**
- Modify: `api/attachments.mjs`, `worker.mjs:55` (add `handleAttachmentRoutes` to the handlers array)
- Test: `tests/attachments.test.mjs`, `tests/worker.routes.test.mjs` (route-registered check, follow that file's pattern)

**Interfaces:**
- Consumes: nothing from other tasks beyond the module Task 3 created.
- Produces: `export async function handleAttachmentRoutes(request, env, url, path, method)` in `api/attachments.mjs` → a `Response` for matching routes, `null` otherwise (the worker's handler-chain convention). Registered in `worker.mjs:55`'s handlers array. Mirrors the avatar reader in `api/shared.mjs:562-600` for response construction (`blobToUint8Array`, `X-Content-Type-Options`, security headers).
- Produces: `GET /api/attachments/:id?v=` serving approved bytes publicly (no auth), pending bytes to the author or any mod, 404 otherwise. `Cache-Control: private, max-age=300` for pending; `max-age=31536000, immutable` for approved (the `?v=` version param makes this safe).

- [ ] **Step 1: Write failing tests**: (a) approved attachment serves correct bytes + `Content-Type` = stored mime; (b) author fetches own pending → 200 with pending bytes (Review Focus #2/#3 adjacency: with `Content-Type: image/gif` from the validated mime); (c) second member → 404, (d) guest → 404 (Review Focus #3); (e) mod → 200; (f) rejected → 404 for everyone incl. author; (g) unknown id → 404.
- [ ] **Step 2: Run** — expect FAIL (route not registered).
- [ ] **Step 3: Implement** `handleAttachmentRoutes` in `api/attachments.mjs` and register it in `worker.mjs`'s handlers array.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat: serve attachments with hybrid visibility`

### Task 5: Attachment metadata on post reads

**Files:**
- Modify: `api/posts.mjs` (feed SELECT, replies SELECT, `GET /api/posts/:id` detail read paths around `POST_SELECT` use), `api/attachments.mjs` (add a shared read helper)
- Test: `tests/attachments.test.mjs`

**Interfaces:**
- Produces: `export async function attachmentRowsForView(db, postIds, viewer)` in `api/attachments.mjs` → `Map<postId, Array<{ id, status, mime, version, awaiting }>>` — `awaiting` is `true` when the viewer sees the pending state, and for non-author/non-mod viewers pending rows are **omitted entirely**. Every serialized post gains `attachments: Array<…>` from that map; `attachments` may be empty; it is never `null`/absent.

- [ ] **Step 1: Write failing tests**: detail read as author lists a pending attachment with `awaiting: true`; the same read as another member shows `attachments: []`; after marking approved, non-author sees the row with `awaiting: false`; feed rows include an approved attachment's `id`/`version`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** — a single query-per-post read (`SELECT … WHERE post_id = ?`) reused across the three read paths; filter by viewer per the rule above.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: expose attachment metadata on post reads`

### Task 6: mod queue — list, approve, reject

**Files:**
- Modify: `api/attachments.mjs` (extend `handleAttachmentRoutes`)
- Test: `tests/attachments.test.mjs`

- Consumes: `handleAttachmentRoutes` (Task 4 — extended here, not redefined); role checks following `api/moderation.mjs:270-345` (the avatar queue/moderation routes).
- Produces: `GET /api/admin/attachments` → `{ attachments: [{ id, postId, uploader, mime, sizeBytes, createdAt }] }` (pending only, oldest first, LIMIT 100); `POST /api/admin/attachments/:id/approve` → `{ approved: true, id }` (copies `pending_*` into the approved pair, bumps version, sets status); `POST /api/admin/attachments/:id/reject` → `{ rejected: true, id }` (clears pending bytes, `status='rejected'`). All three mod-only (member → 403, guest → 401).

- [ ] **Step 1: Write failing tests**: queue returns pending oldest-first; member → 403; approve swaps in pending bytes and bumps version (assert bound values); reject clears bytes → status rejected; approve then re-listing shows the row gone; rejecting an already-rejected id → 404.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the three route handlers.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: attachment moderation queue endpoints`

### Task 7: Frontend — composer attach + image strip

**Files:**
- Modify: `public/js/app.js` (composer builders near lines 125-142 and 360 for the FormData path — mirror the avatar form's upload flow in `public/js/forms.js`), `public/js/render.js` (post/reply cards)
- Modify: `public/js/api.js` (post/reply submission gains a FormData branch when files are chosen)
- Test: `tests/frontend-render.test.mjs`, `tests/frontend-glue.test.mjs`

**Interfaces:**
- Consumes: post objects with `attachments[]` (Task 5); the multipart wire format Task 3 defines (field name `images`, repeatable, plus the existing `body` and `cf-turnstile-response` text fields).
- Produces: composer file input `accept="image/jpeg,image/png,image/webp,image/gif" multiple` with per-file remove buttons; each post/reply card renders `<div class="post-attachments">` with `<img loading="lazy" src="/api/attachments/<id>?v=<version>" alt="">` per attachment, and `<p class="attachment-pending">🖼️ image awaiting review</p>` for rows with `awaiting: true`.

- [ ] **Step 1: Write failing render tests** (pattern of `tests/frontend-render.test.mjs`): a post with one approved attachment renders `img[src="/api/attachments/a1?v=ver-1"]`; an `awaiting: true` attachment renders the pending placeholder instead of an `img`; a post with no attachments renders no `.post-attachments` node.
- [ ] **Step 2: Write failing glue test** for submission: selecting 2 files makes the create-post call submit `FormData` containing both file entries under `images` plus `body` and `cf-turnstile-response`; zero files keeps the existing JSON path (no behavior change).
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement** render + composer changes.
- [ ] **Step 5: Run** `npm test` — PASS.
- [ ] **Step 6: Commit** `feat: image attachment composer and rendering`

### Task 8: Dark mode

**Files:**
- Modify: `public/index.html` (head + header), `public/styles.css` (`:root` block and a new dark block at the top of the file)
- Create: `public/js/theme.js`
- Modify: `public/js/app.js` (init wiring)
- Test: `tests/frontend-glue.test.mjs`

**Interfaces:**
- Produces: `theme.js` exports:
  - `export function resolveTheme(preference, prefersDark)` → `"light" | "dark"`: a stored `"dark"`/`"light"` wins; anything else (null, garbage) maps to `prefersDark ? "dark" : "light"` (Review Focus #4).
  - `export function initTheme(document, localStorage)` → applies `document.documentElement.dataset.theme = resolveTheme(...)`, wires `#theme-toggle` click → toggle + persist; the button's `aria-label` becomes "Switch to light theme"/"Switch to dark theme" (opposite of the current state).
- `index.html` head changes: `<meta name="color-scheme" content="light dark">`; an inline non-module script before the stylesheet link: read `localStorage.forum-theme`, if `"dark"` set `data-theme="dark"` on `<html>`; add `<button id="theme-toggle" class="button button-secondary" type="button">` inside `.header-inner` (before `.account-nav`). `styles.css`: `:root` gains `color-scheme: light dark;` and `accent-color: var(--green);`; add `:root[data-theme="dark"] { … }` overriding the ~10 color variables, and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]):not([data-theme="dark"]) { …same overrides… } }`. Dark values: paper→deep ink surfaces (e.g. `--paper: #1d2836`), ink→warm off-white (`#e8e4d8`), and re-weighted muted/line/green/coral/yellow/blue/focus — exact hex left to the implementer, tuned so body text sits ≥ 4.5:1 on `--paper` (this is the Review-Focus-adjacent bar for the whole task).

- [ ] **Step 1: Write failing glue tests**: `resolveTheme("dark", false) === "dark"`; `resolveTheme("light", true) === "light"`; `resolveTheme(null, true) === "dark"`; `resolveTheme(null, false) === "light"`; `resolveTheme("bogus", true) === "dark"` (OS wins over garbage).
- [ ] **Step 2: Run** — expect FAIL (module missing).
- [ ] **Step 3: Implement** `theme.js` and wire `initTheme(document, localStorage)` from `app.js`'s init; make the head/style/index.html changes above. `theme-color` meta stays light — add `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="<dark paper hex>">` alongside it.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: dark mode with OS preference and manual toggle`

### Task 9: Chunked blob storage — 10 MiB attachments (spec revision 2)

**Files:**
- Create: `migrations/0004_attachment_chunks.sql`
- Modify: `api/attachments.mjs` (constants, `insertAttachments`, serving, admin queue/routes), `public/js/attachments.js` (client cap), `wrangler.toml` unchanged, `tests/attachments.test.mjs`, `tests/migration.test.mjs`
- Rationale (spec revision 2, user-approved 2026-10-15): D1 caps a single BLOB/row at 2,000,000 bytes; the 10 MiB limit requires chunking. The remote DB has received no migrations yet, so 0003 → 0004 chain runs cleanly in both places.

**Interfaces:**
- Produces (constants change, signatures preserved):
  - `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024` (was 1 MiB); `MAX_ATTACHMENT_REQUEST_BYTES = 3 * MAX_ATTACHMENT_BYTES + 512 * 1024` (~30.5 MiB); `MAX_ATTACHMENT_CHUNK_BYTES = 1_900_000` (margin under D1's 2 MB row cap).
  - New migration `0004_attachment_chunks.sql`: `DROP TABLE IF EXISTS attachments;` then CREATE `attachments` (metadata only: id TEXT PK, post_id FK posts ON DELETE CASCADE, created_by FK users, created_at, mime CHECK 4 types, version TEXT NOT NULL, status CHECK, indexes post_id + partial pending) and `attachment_chunks` (attachment_id FK → attachments ON DELETE CASCADE, kind TEXT CHECK('pending','approved'), seq INTEGER NOT NULL, data BLOB NOT NULL CHECK length(data) ≤ 2000000, PK (attachment_id, kind, seq)).
  - `insertAttachments(db, postId, createdBy, files)` — same signature; now chunks each file into 1.9 MiB rows (`kind='pending'`, seq 0..n) in the SAME all-or-nothing db.batch, alongside the metadata INSERTs.
  - Serving: assemble by SELECT data FROM attachment_chunks WHERE attachment_id=? AND kind='approved' (or 'pending' for author/mod) ORDER BY seq, concatenated; an empty chunk set for the row's status → the existing 404 path (fail-safe). Byte assembly via blobToUint8Array on each chunk.
  - Approve route: single UPDATE `UPDATE attachments … status='approved'` AND `UPDATE attachment_chunks SET kind='approved' WHERE attachment_id=? AND kind='pending'` (two statements in one db.batch); reject → `DELETE FROM attachments WHERE id=? AND status='pending'` (chunks cascade) — the reject response contract stays `{rejected:true, id}`.
  - Queue: `sizeBytes` = `SUM(length(c.data))` via LEFT JOIN/aggregate over pending chunks; also returns `chunkCount` for display (optional, display-only).
  - Client cap in `public/js/attachments.js`: per-file 10 MiB (constants follow the server values; the brief of Task 7's file pinned 1 MiB — update that constant + its glue test's boundary values).
- Consumes: everything from Tasks 1–6 unchanged in behavior otherwise.

- [ ] **Step 1: Write failing tests**: migration 0004 (schema, ≤2MB-1 chunk accept, 2000001 reject, kind/seq PK, cascade from attachments row delete); intake chunks a 4 MiB synthetic image into 3 chunks ≤ 1_900_000 with seq 0,1,2 in one batch; serving assembles chunk order byte-exactly (assert concatenated bytes and Content-Length); per-file >10 MiB → 413; client-cap boundary tests updated to 10 MiB; approve flips chunk kinds (assert UPDATE SQL); reject deletes row (assert DELETE SQL); queue aggregates sizeBytes.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** migration 0004 + the rework.
- [ ] **Step 4: Run** `npm run db:migrate:local && npm test` (all green; expect suite ≥ 240) `&& npx wrangler deploy --dry-run`.
- [ ] **Step 5: Commit** `feat: chunk attachment blobs in D1 for 10 MiB attachments`

### Task 10: Dark palette — cool-slate base + bright identity accents (user decision, refined)

**Files:**
- Modify: `public/styles.css` (both dark blocks), `public/index.html` (dark theme-color meta)
- No test changes (CSS-only; resolveTheme/glue tests untouched)

**Interfaces:**
- Consumes: the fix-round-2 structure at f7f0d7d (30 tokens, --quiet-hover/--on-yellow/--error-chip-* trio, hover split, badge borders on --on-yellow).
- Produces (user-refined 2026-10-15 ~20:55): **surfaces/neutral tokens restored to the 348555c cool blue-slate set** (--paper #1d2836, --desk #131b27, --ink #e8e4d8, --muted #a4aeba, --line #3d4d61, --field #232f40, --field-line #4e5e74, --blue #2a3d52, --focus #8ab6ff, soft-green #253c30, cool link/link-hover/success/error tints from 348555c) while **identity accents keep the bright values the warm round verified** (--yellow stays #f3cf67 bright with --on-yellow #33240d — the one "wasn't fine" choice at 348555c was its dim #815b16; --coral #c45744, --green #378255, --green-dark #2d6543 from the warm round's light-parity picks, re-verified white-label ≥4.38:1). Post-348555c tokens: dark --error-chip-* trio cold-family re-derivation (cool dark red bg, #f4b0a4 ink, mid cool red border, ≥4.5:1); dark --quiet-hover = cool dark tone with --green-ink #c9e4cd ≥4.5:1; dark --yellow-hover = dim cool-family mustard compatible with --on-yellow ≥4.5:1 on #f3cf67-derived hover tone. Badge borders STAY var(--on-yellow) (f7f0d7d's fix — with a bright mustard, the dark border fix actually reads correctly). Dark theme-color meta = #131b27. Both blocks byte-identical duplication maintained. Light mode byte-identical to f7f0d7d.

- [ ] **Step 1: Re-tune both dark blocks + meta**: cool values from `git show 348555c:public/styles.css`, bright accents from f7f0d7d's structure; recompute the contrast table for changed pairs (visible text ≥4.5:1).
- [ ] **Step 2: Run** `npm test` (229/229; no CSS tests), `npx wrangler deploy --dry-run`.
- [ ] **Step 3: Commit** `fix: cool-slate dark base with bright accent identity per feedback`

### Task 12: Version stamp — `v2.2 · <short sha>` in the footer

**Files:**
- Modify: `package.json` (version → 2.2.0; extend the `deploy` script to append `--var COMMIT_SHA:$(git rev-parse --short HEAD)`), `wrangler.toml` (`[vars] VERSION = "2.2.0"`), `api/session.mjs` (tiny GET endpoint in the auth/status route group), `public/index.html` (a `#version-tag` span in the footer "Made by" line), `public/js/app.js` (boot-time fill), `public/styles.css` (muted, small)
- Test: `tests/version.test.mjs` (new) or extend `tests/worker.routes.test.mjs`

**Interfaces:**
- Produces: `GET /api/version` → `{ version: "2.2.0", commit: "dcdd4ea" }` — version from `env.VERSION` (wrangler var; plain string, never user input), commit from `env.COMMIT_SHA` (`--var` at deploy; dev shows local hash or "dev" if unset). Frontend: on boot, fill `#version-tag` textContent with `v2.2 · <commit>` — `v` + version trimmed to major.minor (2.2) — hide the tag if the fetch fails (graceful); no error surfaced.

- [ ] **Step 1: Failing test** for `GET /api/version`: returns 200 with both fields from env; missing env vars → graceful `{ version: null, commit: null }` or same-shape defaults (implementer picks one, pins it); no auth required; no state change.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** endpoint + frontend fill + deploy-script extension.
- [ ] **Step 4: Run** full battery (all green) + `npx wrangler deploy --dry-run`.
- [ ] **Step 5: Commit** locally (no push) — `feat: version stamp in footer (v2.2)`

### Task 11: Integration — docs, full checks, smoke list

**Files:**
- Modify: `CLAUDE.md` (API coverage list gains `GET /api/attachments/:id`, `/api/admin/attachments*`; the "Avatar storage" note gains attachments; dark mode mention under behavior notes), `wrangler.toml` already done in Task 3

- [ ] **Step 1: Run the full battery**: `npm run db:migrate:local && npm test && wrangler deploy --dry-run` — all PASS/clean.
- [ ] **Step 2: Update CLAUDE.md** per the list above (no code changes in this task).
- [ ] **Step 3: Browser smoke checklist** (requires `wrangler dev` with Turnstile test keys via `--var`, the process used in the v2 build): register/login, toggle theme + reload → theme persists; attach a small GIF to a post → visible as author with pending chip; second account sees placeholder; mod approves from mod panel → visible to second account on reload; reject flow removes it. Report results to the human partner — do not claim production readiness from unit tests alone (CLAUDE.md).
- [ ] **Step 4: Commit** `docs: document attachments and dark mode`

---

### Task 13: Word filter on usernames and bios (owner-directed add-on)

**Files:**
- Modify: `api/session.mjs` (register route: username check), `api/profiles.mjs` (PATCH /api/me bio), `api/filter.mjs` (if a username-check helper is needed alongside applyWordFilter)
- Test: `tests/filter.test.mjs` / `tests/worker.test.mjs` (whichever holds the register/bio test patterns — read first)

**Interfaces:**
- Consumes: `applyWordFilter(text, env.FILTERED_WORDS)` (api/filter.mjs) and the existing username validation in the register route.
- Produces: usernames are REJECTED at registration when the username would be altered by the filter (mask ≠ identity: reject with a 400 "That username isn't allowed." — the same message style as other 400s, never revealing the word list). Bios are MASKED at save exactly like post bodies (applyWordFilter applied before length/storage/notify logic). Filter unset (secret absent) = no-op both places, identical to the posts behavior.

- [ ] **Step 1: Failing tests**: register with a filtered username → 400, same message both times (no word leak); register with a clean username still succeeds (turnstile/session mocks per the register-test pattern); PATCH /api/me with a bio containing a filtered word → stored/masked response per applyWordFilter's masking behavior; PATCH bio when FILTERED_WORDS unset → unchanged from today.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full battery + dry-run.
- [ ] **Step 5: Commit** locally (no push) — `feat: filter usernames and bios`

## Self-review notes

- Spec coverage: dark mode (Task 8), storage (1), sniffing (2), intake (3), serving (4), read metadata (5), moderation (6), frontend (7 — includes composer thumbnails/placeholder), CSP (untouched — no task may touch `img-src`), CLAUDE.md/checks (9). Spec's "Open items" resolved: dark-palette hex is an implementer decision under the 4.5:1 bar; no `pending count` badge is added (not required).
- Proportion: bodies are deliberately omitted where `requireTurnstile`/sniffer signatures determine behavior; the one algorithmic note (reply attachments bind to the reply's own id, not the bump target) is pinned in Task 3 Step 3.
