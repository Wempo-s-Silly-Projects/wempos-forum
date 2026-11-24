# Security review — v5.82.1..e63f7b5 (wave 5.95.1)

Scope: `git diff v5.82.1 e63f7b5` (v5.83.0 through v5.95.0 and the daily
dependency update). Server: 31 files under api/, worker.mjs, constants.mjs
and migrations 0095–0097 (+2058/−128). Client: 54 first-party files under
public/js/ (+2758/−395), public/index.html, public/sw.js; vendored additions
under public/js/vendor/ and public/icons/lucide/; 50 edited test files.

Findings: 0 CRITICAL, 0 HIGH, 2 MEDIUM (both fixed), 3 LOW (1 noted,
2 lead-gated), 4 INFO. RED-first pins for the fixes and regression pins for
the checks that pass are in tests/wave5951-security-review.test.mjs. The
surfaces already pinned by their own wave tests (anubis-gate,
anubis-review-fixes, anubis-crawlers, modules, module-vibe-guard,
search-module, mcp, wave27-storage-wipe-sweep, wave5712-polyfill-csp) were
read and are green at this SHA.

| ID | Severity | Where | Status |
|----|----------|-------|--------|
| M1 | MEDIUM | api/full-search.mjs:71 (SCORE_CURSOR), :95 | Fixed in v5.95.1 |
| M2 | MEDIUM | api/mcp.mjs:780 (lobby_read), :816 (lobby_post) | Fixed in v5.95.1 |
| L1 | LOW | constants.mjs:206, api/core/anubis-gate.mjs:149 | Lead-gated (needs Anubis's real page requirements) |
| L2 | LOW | migrations/0096_translate.sql | Noted (orphan tables, not dropped) |
| L3 | LOW | api/core/modules.mjs:83 (chat paths) vs /api/presence | Lead-gated (scope call) |
| I1 | INFO | api/wemposclaude.mjs:191 | Pinned-pass (cost only, capped) |
| I2 | INFO | api/search-index.mjs (sync callers) | Pinned-pass (read-time law covers stale rows) |
| I3 | INFO | REUSE.toml / LICENSES | Pinned-pass (every vendored addition covered) |
| I4 | INFO | tests/** (range) | Pinned-pass (no assertion weakened) |

The v5.82.1 review's M1 (an unset or unknown HUMAN_CHECK ran no check) is
closed in range: anubis mode without a configured Anubis now behaves as
altcha mode (api/core/human-check.mjs `requireHumanCheck`), and with Anubis
configured a write needs a valid pass cookie or an ALTCHA proof. Pinned by
tests/wave528-security-pins.test.mjs and tests/anubis-review-fixes.test.mjs.

## M1 — MEDIUM — the full-search cursor regex backtracked quadratically (fixed)

- Where: `parseSearchCursor` (api/full-search.mjs) matched `?cursor=` for
  the `relevant` sort against `SCORE_CURSOR`
  (`^(-?(?:[0-9]+\.?[0-9]*|…)(?:e…)?)_(…)$`) with no length bound. On a long
  digit run with no `_`, `[0-9]+` and `[0-9]*` split the run every possible
  way before failing: O(n²).
- Failure scenario: `GET /api/search/full?q=a&cursor=1111…1` (16 000 digits,
  inside Cloudflare's URL cap) costs ~100 ms of CPU per request (measured:
  2k → 1.6 ms, 4k → 8 ms, 8k → 25 ms, 16k → 100 ms), ten times the free
  plan's per-request CPU budget, from an anonymous caller.
- Preconditions (why not HIGH): the search module is default-off and
  `/api/search/` answers 404 while it is off; `rateLimit("full-search")` runs
  before the parse; in anubis mode the API gate challenges anonymous reads.
  Every other cursor in the codebase is length-bounded
  (api/vendor/db.mjs, the feed-cursor law).
- Fix: `CURSOR_MAX_CHARS = 64` (an honest cursor is at most ~24 characters
  of `String(double)`, `_`, and a 15-digit id) is checked before either
  regex; longer is a 400 with the same message.
- Pins: "M1: an over-long relevant cursor is a 400, refused before the regex
  runs" (16 000 digits under 5 ms, best of 7; RED at e63f7b5 with 101 ms) and
  "M1: honest cursors still parse".

## M2 — MEDIUM — the MCP lobby tools ignored the chat module switch (fixed)

- Where: the chat module owns `/api/chat`, `/api/chat/` and `/api/dm/`
  (api/core/modules.mjs:83), and `gateModulePath` answers them 404 when the
  owner turns chat off. `/mcp` is routed before `routeApi`, so its
  `lobby_read` (public, no token) and `lobby_post` (agent token) tools
  reached `lobbyMessageRows` / `insertLobbyMessage` regardless.
- Failure scenario: the owner turns the chat module off from the desk (or
  `MODULE_CHAT=off`). The lobby disappears from the site and `/api/chat` is a
  404, but anyone can still read the whole lobby history with one
  `tools/call lobby_read` on `/mcp`, and agent accounts can keep posting to
  it.
- Fix: `lobbyRead` returns the tool error "Not found." and `lobbyPost`
  throws a 404 HttpError (turned into a tool error by `runWriteTool`) while
  `isModuleOn(env, "chat")` is false. Both tools stay in `tools/list`
  (removing one would be a MAJOR change). No other MCP tool touches a
  module-owned surface (polls, wall and DMs have no MCP tool).
- Pins: "M2: with the chat module off, lobby_read and lobby_post refuse and
  write nothing" (RED at e63f7b5) and the chat-on control.

## L1 — LOW — the Anubis page fallback CSP admits inline script (lead-gated)

- Where: `ANUBIS_PAGE_CSP` (constants.mjs:206, added in e4dac2e) carries
  `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'`.
  `anubisResponseHeaders` (api/core/anubis-gate.mjs:149) applies it to
  same-origin `/.within.website/**` responses and to the gate's 403 deny page
  whenever Anubis sends no CSP of its own; when Anubis sends one it passes
  through with no ceiling.
- Failure scenario: any HTML injection in an Anubis page (an upstream bug in
  a reflected value) becomes script on the forum origin, which can make
  same-origin API calls with the member's session and act as them.
- Why lead-gated: tightening it (or capping a passed-through Anubis CSP)
  needs Anubis v1.28.2's real page requirements; a too-strict policy breaks
  the challenge and with it every page in anubis mode. Next step for the
  lead: read the live `Content-Security-Policy` Anubis serves on its
  challenge page; if it sends none, try `script-src 'self'` on the preview
  environment before production.
- The document leg (the forum's own pages) has no `'unsafe-*'`; pinned.
  The fallback is pinned at its current value so any further widening fails.

## L2 — LOW — migration 0096 left orphan translate tables (noted)

- `translate_suggestions`, `translate_votes` and `translate_glossary` were
  created for the translate module, which was deleted on owner order. No
  route, MCP tool, export or discovery surface reads or writes them (grep of
  api/, worker.mjs, constants.mjs, public/js). Rows can only hold data a
  member submitted while the module existed; user deletion cascades. Not
  dropped (migrations are CREATE-only); pinned that nothing references them.

## L3 — LOW — /api/presence is outside the chat module (lead-gated)

- `GET/POST /api/presence` (Who's Online and the heartbeat, api/chat.mjs)
  keeps answering with the chat module off. It is not chat content and it is
  also used by the feed (public/js/routes/feed.js) and who-online.js, and
  docs/modules.md scopes the chat module to "the chat lobby and direct
  messages". Presence already applies the ban, invisible and stale filters.
  Whether "chat off" should also hide Who's Online is a product call for the
  lead; no change made.

## INFO

- I1: wemposclaude checks the thread lock and slow mode after the model
  call (api/wemposclaude.mjs:191), so a tag in a locked thread spends one
  claim row and one model call before the reply is refused. Bounded by the
  per-member burst bucket and the daily caps (10 per member, 300 global);
  no content leaks. Everything else passed: module off (the default) never
  calls the model; the source must be visible to the bot as a plain member
  (canViewPost, block pair either way, lobby ban filter); the member text is
  spoiler-masked, capped, angle-bracket-swapped and quoted as untrusted; no
  env or secret reaches the prompt; the answer is defused (`@`), capped,
  word-filtered and posted through the ordinary reply guards as text.
- I2: search-index sync runs only from the write paths that changed in range
  (create, edit, delete, hide-recent, restore, report hide, MCP). Other
  hides and bans leave stale index rows, but `visibleRowsQuery` re-applies
  the visibility law in FORUM_DB for every candidate (viewablePostSql for a
  signed-in non-staff viewer, publicChainSql otherwise, staff included), the
  excerpt is cut from the current, spoiler-masked body, and the owner's
  rebuild prunes. MATCH input is reduced to letter/digit/mark runs, each one
  quoted FTS5 string; binds ≤ 4 (SEARCH_DB) and ≤ 7 (FORUM_DB).
- I3: every vendored addition (NoSleep, core-js, driver.js + css, exifr,
  is-animated, minisearch, prism-command-line, screenfull, Lucide icons) has
  a REUSE.toml entry (prism-command-line through the blanket
  `public/js/vendor/**` MIT block) and an AGPL-compatible licence
  (MIT, ISC) present in LICENSES/. None carries a VENDORED VERBATIM banner;
  REUSE.toml covers them, as the brief allows. No gap.
- I4: the 50 edited test files were read for removed or loosened
  assertions. Every removal is a deliberate behaviour change with a stronger
  or equal replacement: the cdnjs polyfill exception gone (script-src now
  exactly `'self'`, wave5712/wave574/wave5731/wave528); the Anubis
  header-read pin widened to an exact allowlist plus forged-crawler checks
  (wave5821, anubis-gate); production pinned to altcha or fully configured
  anubis; the APNG fixture made a real APNG for is-animated (upload-safety);
  the modulepreload graph now includes routed modules (load-path); the
  locale count 65 → 66 (wave52-honest-404); wave574's dropped
  `worker-src`/wildcard check is still pinned by wave576-embeds:481 and
  wavek-service-worker:179. Fun extras now default ON (batch-m-fun,
  c5bf2a7) under the owner's "keep the old vibe" order; not activity-
  revealing. No `.skip` or `todo` was added.

## Checks that passed (no finding)

- Anubis pass cookie: Ed25519 JWT verified against ANUBIS_PUBLIC_KEY_HEX
  (WebCrypto verify), alg must be EdDSA, strict base64url, exp required,
  nbf honoured, action CHALLENGE, restriction = sha256(CF-Connecting-IP);
  length- and count-capped. The client IP comes only from CF-Connecting-IP;
  upstream headers are an allowlist; only Anubis cookies cross either way;
  redirects stay on our origin; crawler pass needs the Cloudflare ASN.
  Mutations are never page-gated and writes need the pass or ALTCHA.
  Session cookies: `__Host-`, Path=/, HttpOnly, SameSite=Lax, Secure
  (api/core/cookies.mjs).
- Modules: GET/PUT /api/admin/modules owner-only (requireAdmin) with CSRF;
  the INSERT re-checks owner + no active ban; unknown and read-only ids 400;
  off-module API paths 404 before any handler and off-module pages answer
  404; /api/site lists ids only; defaults match module-vibe-guard.
- Saturday Fools: owner-only switch with CSRF, one site_settings row, no
  anonymous write, no member data stored; the gag is CSS + translated text.
- posts-feed: the detail read keeps canViewPost before the view count,
  replies and flags; only reads were parallelised. seo.mjs reads the reply
  count alongside canViewPost but uses it only after visibility passes.
- Migrations 0095–0097: CREATE TABLE/INDEX IF NOT EXISTS only; no secret
  columns; no `SELECT *` route reads them.
- Client sinks: no new innerHTML/outerHTML/insertAdjacentHTML/document.write/
  srcdoc/eval/`new Function`/on* attributes in first-party code; Driver.js
  popover strings are HTML-escaped; icons are CSS-mask spans; full-search
  builds results with textContent and app links from ids.
- CSP: the document leg lost the cdnjs path (script-src `'self'` only); no
  `'unsafe-*'`; public/sw.js unchanged in range.
- Storage: the two new localStorage keys (fun extras, Saturday Fools banner
  date) are device preferences, allow-listed with reasons in
  tests/wave27-storage-wipe-sweep.test.mjs.
- AGPL headers on every new first-party .js/.mjs/.css
  (tests/license-headers.test.mjs green).
