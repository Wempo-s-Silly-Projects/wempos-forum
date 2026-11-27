# Feature slate — wave 2026-11-21-52 (v5.2.0) — honest 404s + not-found rescue

Source: lead discovery probe 2026-11-21 on v5.0.0; owner order "not found
should say 404". Tests written RED first (16 failing before the fix).

## F1 — Unknown /.well-known/* answers 404 (bug)

The assets binding (`not_found_handling = "single-page-application"`) answered
index.html with 200 for `/.well-known/oauth-authorization-server`,
`/openid-configuration`, `/oauth-protected-resource` and any other unserved
discovery path — the forum has no OAuth server, so that looked like a lie.
`worker.mjs` `honestAssetResponse` now re-judges ONLY the SPA fallback (a 200
`text/html` answer): under `/.well-known/` it becomes `404 text/plain`,
`Cache-Control: public, max-age=60`. `api-catalog` and
`mcp/server-card.json` are answered earlier by `handleDiscovery`, unchanged.

## F1b — Missing /locales/*.json answers 404 (bug)

Same rule for `/locales/`: `/locales/unknown.json` → `404 text/plain`. All 41
real locale files are real assets (`application/json`), never re-judged; the
test walks every one.

## F1c — Not found says 404 (owner order)

- Server: `worker.mjs` imports `routeForPath` from `public/js/router.js` —
  the single source of truth, no mirrored pattern list. A path it resolves to
  `not-found` (incl. `/c/<slug>` outside `BOARDS`) keeps the stamped shell
  but with status 404, so the client still paints its view. Known routes stay
  200; `/posts/<id>` does NO D1 lookup (a missing id stays 200 and the client
  shows its 404 view). Note: `/settings` and `/search` are not router routes
  (settings lives in the account menu, search is `/?q=`), so they 404 now.
- Client: the not-found view paints a large `aria-hidden` "404" above the h1;
  the h1 still announces "Page not found". No new string (numerals).
- Test walks every route name router.js declares (asserted against its
  source), each → 200 HTML; static assets and `/api/*` JSON 404 unchanged.

## F2 — Not-found rescue (unique, members and guests)

The 404 view offers "Back to the home feed" and "Search the forum for
“<words>”", the words taken from the address that missed
(`/c/gamedev-tips` → "gamedev tips"; route prefixes, file noise and
one-letter words dropped; max 5 words / 60 chars; malformed escapes fall back
to the raw path). `public/js/not-found.js`, page-view only (no storage, no
`api()`), textContent painted. Strings `app.notFoundHome`,
`app.notFoundSearch` in en + all 40 locales.

## Gates

- `pnpm test` 760/760; `wrangler deploy --dry-run` clean.
- Migrations: none. Remote D1: untouched. No deploy, no push.
