# Security review — v4.45.0..v5.3.0 (15f600f..8157a3f), wave 5.4

Scope: `git diff --stat 15f600f..8157a3f` (86 files). Reviewer: wave54-lead, 2026-11-21.

## Findings

| # | Sev | File:line | Scenario | Status |
|---|-----|-----------|----------|--------|
| F1 | LOW | public/js/router.js:68 (imported by worker.mjs honestAssetResponse) | `BOARD_BY_SLUG` is a plain object (`Object.fromEntries`); `/c/constructor` matched the `[a-z0-9-]+` slug regex and resolved through `Object.prototype.constructor`, so the worker answered a 200 shell (not the honest 404) and the client rendered a category whose `board.slug` is `undefined` (`/api/posts?board=undefined`, broken view). No XSS/data exposure. | FIXED: `Object.hasOwn(BOARD_BY_SLUG, slug)` (same idiom as `/bookmarks?board=`). Pin: tests/wave54-security-pins.test.mjs |

## Checked, no issue

- worker.mjs honestAssetResponse: only re-judges a 200 `text/html` answer (the SPA fallback; `public/index.html` is the only real HTML file). Real assets pass through with their own status/type. `/api/*`, `/mcp`, discovery answer before it, so nothing is shadowed. No redirect is ever built from the path (no open redirect). WHATWG URL normalises `..`/`%2e%2e` before routing; `//`, `/locales%2f...`, case variants fall to the 404 shell.
- Cache: 404 shell goes through stampedAssetResponse → `Cache-Control: no-store` (VERSION is always set in prod). Plain 404 (`/locales/`, `/.well-known/`) is `public, max-age=60` on a static body for paths with no file — no poisoning vector beyond a 60 s miss window for a not-yet-deployed locale. HEAD mirrors GET status.
- routeForPath server-side import: router.js/boards.js/i18n.js evaluate no window/document at import (`startRouter` touches them only when called). Regexes are anchored, no nested quantifiers — linear on 100k-char paths (pinned < 500 ms).
- Locales (41): no `<`, `>`, entities, `javascript:`/`data:` URLs or bidi override/isolate controls in any value; placeholder parity with en.json holds (also pinned by tests/i18n.test.mjs). `dir` comes only from the `LOCALES` table, never from bundle content. New strings render via textContent (`createTextNode`, `textContent`, `t()`); no innerHTML sinks in public/js.
- tab-unread.js: writes `document.title` (text) from fixed translated titles + a normalised integer; no innerHTML, no network; `forum-tab-unread` is a device pref (registered in the storage-wipe sweep). Count comes from the session read, 0 for guests.
- not-found.js: links built with `setAttribute("href", "/" | "/?q=" + encodeURIComponent(...))` and textContent — no scheme injection.
- Unanswered removal: server `unanswered=1` branch (api/posts-feed.mjs:227-247) keeps `visibility='public'` + `banFilterSql` + `viewerBlockFilterSql` on both root and reply arms; param validated `/^[01]$/`; binds ≤ 2 extra; still under tests/wave35-feed-cursor-fuzz.test.mjs.
- No API write route, migration, or bind-count change in the range.

## Notes (no fix)

- If `VERSION` were unset the 404 shell would inherit the assets binding's cache headers; prod always binds VERSION via `pnpm run deploy`.
