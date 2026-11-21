# Feature slate — wave 2026-11-21-35 (v4.40.0) — feed hardening + end of feed

## F1 — Hardening review of v4.37–v4.39 (`1110f1f..7d7fc27`)

Scope: `api/posts-feed.mjs` cursor parsers and query params, the feed-views
client, long-post fold, suggestion rank, draft notice, and a re-check of the
wave-31 early attachment cap.

- **LOW — future-dated drafts never expired** (`public/js/drafts.js`
  `loadDraftEntry`). `savedAt` comes from localStorage; only finiteness was
  checked. A value ahead of the clock dodged the 7-day expiry forever, and
  one past Date's range (e.g. `1e300`) made the restored-draft notice read
  "Invalid Date". Fix: a `savedAt` more than `DRAFT_FUTURE_SKEW_MS` (1 day)
  ahead is corrupt: cleared, read as no draft. RED first:
  `tests/wave35-draft-clock.test.mjs` (4; 2 failed before the fix).
- **No defect — cursors.** Activity `[01]_\d{1,10}_\d{1,10}` (legacy
  `\d{1,10}_\d{1,10}`), score `-?\d{1,10}_\d{1,10}`, bare id `\d{1,15}`:
  all anchored and bounded under 2^53, so non-numeric, NaN/Infinity, signs,
  overflow, extra fields and odd separators 400 before any SQL. Worst root
  query binds 9. Cross-view: activity → Suggestions, bare id → activity or
  Suggestions, ranked/score → Newest all 400; a score cursor on an activity
  feed parses as the legacy 2-part form and returns a safe page (visibility
  intact).
- **No defect — params.** `unanswered=1&sort=new&board=suggestions` 400;
  repeated params take the first (`URLSearchParams.get`); unknown values
  400; unknown params ignored.
- **No defect — client.** `?view=` goes through the `FEED_VIEWS` whitelist
  (router.js) and chip hrefs are fixed constants, so nothing from the URL
  reaches links or history. Fold `focusin` unfolds; edit swap hides and
  restores the fold wrapper as one block.
- **No defect — attachment cap.** Interleaved image/GIF bodies: exactly 3
  in any mix pass the count gate; the 4th part is refused before read,
  sanitize or hash lookup, whichever kind it is
  (`tests/wave35-attachment-cap-mixed.test.mjs`, 2).
- **LOW, noted, not changed:** a suggestion whose score drops while you
  paginate can show again on Load older and take a second rank number
  (score instability accepted on owner instruction, v2.4.1). Fold toggles
  use `post-body-fold-<id>` ids, which would repeat if one post rendered
  twice on a page (only in that same case).

Fuzz pin: `tests/wave35-feed-cursor-fuzz.test.mjs` (4): seeded mulberry32,
220 cursors (37 fixed hostile + random) x 8 variants = 1760 requests, plus
220 on My posts; anonymous and signed-in (block pair armed) alternate.
Every answer 200/400, every statement < 100 binds, no hidden root, banned
root or blocked root in any 200 page. Mutation: an injected throw and a
dropped visibility clause each fail the suite.

## F2 — End of feed + Back to top (unique)

Not shipped before (checked feature-slate-2026-11-21*.md and public/js: no
end marker or back-to-top existed). After Load older brings in a non-empty
final page (short, or full with no cursor), the list closes with "You've
reached the end of this feed." (`role="status"`) and a Back to top button
that scrolls to and focuses the page's first heading (`jumpToNode`, which
honors reduced motion). Front page, categories, Suggestions, My posts.
`public/js/feed-end.js`, page-view only (source-pinned: no storage, no
requests, no innerHTML), modulepreload hint. Tests:
`tests/wave35-feed-end.test.mjs` (7).

## Strings

2 new keys (`feed.endOfFeed`, `feed.backToTop`) in en and all 20 locales.

## Migrations

None.
