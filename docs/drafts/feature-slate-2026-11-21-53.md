# Feature slate — wave 5.3 (release v5.3.0)

Through-line: **a gate you can trust, and one quiet convenience.** The lead's
isolated verify of v5.2.0 read 759/760 once under background load; a flaky
gate blocks good ships, so the hunt came first.

Owner verdicts honoured: no Unanswered view, Read aloud stays, QOTD is the
owner's, not-found pages say 404. No schema change, no migration, no new
endpoint, no new dependency.

## F1 — Flaky-test hunt (tests only)
Method: full suite 25x under 6 CPU burners (= cores), spec reporter, every
failing test name + message recorded.
- Found: `tests/wave23-parser.test.mjs:70` "parse and mask grow linearly on
  every pathological unit" — 5 of 12 pre-fix runs (e.g. parseInline on
  "*`[~": 4x input cost 8.6x). No other test failed in any run.
- Cause: in `tests/helpers/timing.mjs` `growthRatio`, a preemption lands in a
  sample with odds proportional to its length, so the 4x-longer large sample
  is hit far more often than its small partner; single readings skewed whole
  pairs and moved the median past 8x. JIT warm-up was ruled out (30 extra
  warm calls did not change the outlier rate).
- Fix: each pair takes the fastest of 3 interleaved readings per size, and a
  window reading at or over the ceiling is re-measured (up to 3, lowest
  median kept). Noise only raises a ratio; a real quadratic reads ~16x every
  window — `tests/wave38-timing-harness.test.mjs` still flags one. Ceiling,
  pair count and all assertions unchanged.
Acceptance: 25/25 under load, 25/25 at concurrency 1, 25/25 at max.

## F2 — Unread count in the browser tab title (unique, opt-in)
Identity: tick "Show the unread count in the browser tab" in Settings →
Appearance and a pinned tab reads "(3) Wempo's Forum". Module
`public/js/tab-unread.js`.
- Off by default (defaults law: a title shows on shared screens). Device
  pref `forum-tab-unread` like the text size; registered in the storage-wipe
  sweep as a device preference, survives logout like theme/text size.
- Count = the session's `unreadNotifications` (0 for guests); "99+" past the
  cap; the prefix is replaced, never stacked; applied after every route title
  and on bell updates (Mark all read clears it at once).
- No `api()`, no fetch, no innerHTML; blocked storage = off, toggle still
  applies for the page view. One new string, translated in all 41 locales.
Acceptance: `tests/wave53-tab-unread.test.mjs` (9 tests).

Considered and deferred: an F3 — the slate already counts 101 shipped
features; one well-pinned unique beats two thin ones this wave.
