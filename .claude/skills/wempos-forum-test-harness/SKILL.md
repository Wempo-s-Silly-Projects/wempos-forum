---
name: wempos-forum-test-harness
description: "Use when adding or fixing tests in Wempo's Forum, faking D1, forging a signed-in session, or when someone asks for test coverage of a route — explains tests/helpers/d1.mjs and how to drive real handlers"
metadata:
  version: "1.3.0"
  source: local-git-analysis + session (re-verified 2026-11-21 at v5.0.0)
---

# Forum test harness

- Runner: `pnpm test` → `node --test` (Node 26, `node:test` + `node:assert/strict`), ~77 files in `tests/`.
- `tests/helpers/d1.mjs`: `D1Database` adapter over `node:sqlite` (`prepare().bind().first()/all()/run()` with D1-shaped `results` + `meta.changes/last_row_id`, `batch()` in a transaction). `loadSchema()` applies every `migrations/*.sql` in order to a fresh in-memory DB, so SQL runs for real.
- `makeEnv(overrides)`: FORUM_DB, limiter bindings (`makeLimiters`), `PASSWORD_PEPPER` (`TEST_PEPPER`), `RELAY_TOKEN` (`TEST_RELAY_TOKEN`), `AGENT_TOKENS: ""`, `VERSION: "9.9.9-test"`, `COMMIT_SHA: "abc1234"`, `ASSETS` (`makeAssets`), plus `__sqlite` for direct seeding.
- `tests/helpers/seed.mjs`: `seedUser`, `seedPost`, `seedBan`, `forgeSession` (→ `{cookie, csrf}`), `makeRequest(path, {method, body, session})` (adds cookie + Origin + `X-CSRF-Token` for mutations), `call(env, path, opts)`, `sha256`, `ORIGIN`.

## Patterns
- Drive the real worker (`call`, or `worker.default.fetch(new Request(url, init), env, ctx)`): routing order, auth and headers together.
- Writes need Origin + CSRF: `requireUser` → `requireCsrf` → `assertSameOrigin` runs before the session lookup.
- Word filter list = `site_settings` row `filtered_words`. Agent/MCP tests: `AGENT_TOKENS: JSON.stringify({[sha256(token)]: userId})`.
- Behavior changes on purpose → update the expectation; never weaken an assertion. A real bug found → `{ todo: "BUG: ..." }` and report it.
- Visibility tests: write RED first, cover hidden root, banned author (active vs expired/revoked), block pair both ways, invisible presence; model on `tests/wave40-cross-route-visibility.test.mjs`.

## Client (DOM) tests
- `tests/helpers/fake-dom.mjs` is MANDATORY: `FakeNode`, `FakeText`, `makeFakeDocument()`, `findByClass`, `countByClass`. Never hand-roll a fake element.
- Realistic collections: `.children`/`getElementsBy*` are live HTMLCollections (no `forEach/map/find`); `querySelectorAll`/`.childNodes` are NodeLists (`forEach` yes, `map/find/filter` no). Production code spreads first; the fake fails where a browser would (v4.9 `children.find` shipped broken).
- Selectors are narrow (`tag`, `.class`, `tag.class`, `[attr]`, `[attr=v]`, comma lists); others throw `fake-dom: unsupported selector`.
- `button.dispatch("click", { preventDefault() {} })` fires listeners; `focus()` sets `ownerFocused = true`.
- Strings: `tests/i18n.test.mjs` pins key + placeholder parity across `en.json` and the 20 other locales, real translations, and the no-copy sweep (`tests/helpers/string-literals.mjs` scanner).
- Speed pins use `tests/helpers/timing.mjs` (shape-first: 4x input must not ~16x the cost; absolute ceiling as best-of-N).

## Safety-net pins (never loosen; extend when you add a surface)
- Spoiler sweep `tests/wave17-spoiler-paths.test.mjs` (allow-list only with a reason in `NOT_A_SPOILER_SURFACE`).
- Parser fuzz `tests/wave23-parser.test.mjs` + `tests/helpers/markdown-fuzz.mjs`: rendered text = input minus markers, hrefs http(s) or `/` (never `//`), `maskSpoilers` never leaks a spoiler char, parse+mask < 5 ms on capped 4750-char bodies.
- Storage-wipe sweep `tests/wave27-storage-wipe-sweep.test.mjs`.
- Rollup differential `tests/wave29-feed-rollup.test.mjs` (frozen pre-v4.34 reply-count SQL vs live, 8 viewer kinds, no-SCAN plan pin).
- Feed bind pin `tests/wave32-feed-page-size.test.mjs` (blocking member, full page, < `D1_MAX_BOUND_PARAMS`).
- Cursor fuzz `tests/wave35-feed-cursor-fuzz.test.mjs` (seeded mulberry32, 220 per variant; 200/400 only, < 100 binds, no hidden/banned/blocked root).
- Cross-route visibility `tests/wave40-cross-route-visibility.test.mjs` + `tests/wave40-visibility-routes.test.mjs`.
