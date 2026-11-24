---
name: wempos-forum-patterns
description: "Use when working in the Wempo's Forum repo, especially before editing worker.mjs, api/*.mjs or public/js, placing tests, or writing commits — conventions measured from git history"
metadata:
  version: "1.3.0"
  source: local-git-analysis + session (re-verified 2026-11-21 at v5.0.0, 1107 commits)
---

# Wempo's Forum Patterns

## Commits
- Conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `ci:`) are the norm now (236 of the last 400 subjects; older history is free-form prose). Releases: `chore: release vX.Y.Z` bumping `package.json` + `wrangler.toml` VERSION.
- Commits written with Claude end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- The owner also edits `main` in the GitHub web UI — always fetch and diff `HEAD..origin/main` before pushing (wempos-forum-owner-web-edits).

## Architecture
- `worker.mjs`: single Workers entry. Order: `*.workers.dev` → 301 to `https://wempos-forum.com`; `/mcp`; discovery; `/api/*` → `routeApi` → `dispatch(API_HANDLERS, notFound)` (from `api/vendor/http.mjs`); everything else → `env.ASSETS` via `stampedAssetResponse` (HTML gets `<meta name="app-build">` + `no-store`).
- `api/*.mjs`: one feature per module exporting `handleXRoutes(request, env, url, path, method, ctx)` that returns `null`/`undefined` when the path isn't its own; register it in `API_HANDLERS`.
- `api/core/*.mjs`: shared primitives (auth, http, crypto, passwords, visibility, blocks, shapers, spoilers, cursors). `api/vendor/{db,http}.mjs` are never touched.
- `public/js`: vanilla ES modules, no bundler; one `api()` fetch wrapper in `public/js/api.js` (fetch only, XHR banned). Strings via `t()` from `i18n.js`, locales in `public/locales/*.json` (21).
- Every source file carries the 17-line AGPLv3 header (`//` JS, `/* */` CSS); `tests/license-headers.test.mjs` enforces it.

## Client laws (each pinned by a test)
- **Spoiler masking**: every preview/excerpt/snippet/title surface goes through `maskedExcerpt(text, max)` (masks BEFORE cutting) or `maskSpoilers` (`public/js/markdown.js`; worker re-exports via `api/core/spoilers.mjs`). Sweep: `tests/wave17-spoiler-paths.test.mjs`; allow-list only with a reason in `NOT_A_SPOILER_SURFACE`.
- **Account-scoped localStorage**: per-member keys carry `:u<id>` and read/write nothing until the id is known. Every new key family registers a `clearAll…()` in `wipeAccountLocalData()` (`public/js/routes/account-nav.js`, runs in a `finally`). Device prefs (theme, text size, locale) stay out. Sweep: `tests/wave27-storage-wipe-sweep.test.mjs`.
- **IME guard**: any Enter/Tab keydown that sends/submits/picks bails first on `isImeComposing(event)` (`public/js/focus-utils.js`).
- **modulepreload**: a new module on the boot/feed/thread chain gets a `<link rel="modulepreload">` in `public/index.html`; `tests/load-path.test.mjs` fails on a missing file, dead hint or unresolved import.
- **Defaults**: activity-revealing or behavior-changing features are opt-in, never default-on.
- Page-view-only features (jumps, folds, toggles) touch no storage or `api()`; pin with a `doesNotMatch(/localStorage|sessionStorage|api\(/)` source test.

## Server laws (each pinned by a test)
- **Visibility**: every non-staff read obeys wempos-forum-visibility-law (`api/core/visibility.mjs`).
- **Writes**: `requireUser` (→ `requireCsrf` → `assertSameOrigin` + `X-CSRF-Token`) then `assertNotBanned`, `rateLimit`, word filter, caps from root `constants.mjs`.
- **Feed page size**: every feed variant pages by `FEED_PAGE_SIZE` (20), no caller-supplied limit; binds stay < `D1_MAX_BOUND_PARAMS` (100) — worst today is the reply-count rollup at `2*FEED_PAGE_SIZE+11` = 51 (`tests/wave32-feed-page-size.test.mjs`). Chunk IN-lists before raising the page size.
- **Feed cursors**: anchored, length-bounded regexes in `api/vendor/db.mjs` (re-exported by `api/core/cursors.mjs`); `mine`/`unanswered` params `/^[01]$/` (the Unanswered client view was removed in v5.0.0; the server param remains). Keep `tests/wave35-feed-cursor-fuzz.test.mjs` green (200/400 only, < 100 binds, no hidden/banned/blocked root).
- **Client checks are advisory; the server enforces** (byte ceiling, 10 MiB/file, magic-byte sniff, metadata strip, 3-attachment cap via `assertAttachmentRoom` in `api/attachments.mjs`).
- **Migrations**: CREATE-only, next free number (0060+), remote only via wempos-forum-ritual.

## Testing
- `pnpm test` = `node --test` over `tests/*.test.mjs` with the real-SQLite D1 adapter (wempos-forum-test-harness). Prefer behavioral tests through `worker.fetch`; static source pins for client modules.
