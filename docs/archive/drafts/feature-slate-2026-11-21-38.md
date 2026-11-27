# Feature slate — wave 2026-11-21-38 (v4.43.0) — timing de-flake + notification times

Not shipped before (checked feature-slate-2026-11-21*.md and public/js: the
Notifications page rows carried only a label; the API already returned
`createdAt`, but no surface showed it).

## F1 — De-flake every wall-clock timing assertion (tests only)

Sweep of tests/ for performance.now / hrtime / Date.now thresholds found two
absolute ms pins; the Date/setTimeout hits carry no thresholds.

- `tests/helpers/timing.mjs` (new): `bestOf` (fastest of 7, early stop once
  under budget) and `growthRatio` (median of 15 back-to-back small/large pair
  ratios, alternating order, ~1 ms samples) so P/E-core hops under load
  cannot skew a reading.
- `tests/wave19.test.mjs` "maskSpoilers stays linear": one 30 ms wall-clock
  pass → per-unit growth check (4x input < 8x cost; linear ~4x, quadratic
  ~16x) + the unchanged 30 ms ceiling as a best-of-7 last guard.
- `tests/wave23-parser.test.mjs`: new "parse and mask grow linearly on every
  pathological unit" (parseInline + maskSpoilers, all units); the 5 ms per
  body budget unchanged, now best-of-7 with early stop (was best-of-5).
- `tests/wave38-timing-harness.test.mjs` (new): the growth check trips on a
  known quadratic scan and passes a linear one; bestOf call counts.

Proof (12 busy-loop burners, 6-core host): baseline wave19 18/20 (2× "masking
took 36.8/35.4 ms"); after: wave19 20/20, wave23 20/20, harness 20/20; full
suite 3× under the same load. No production code changed; no perf defect.

## F2 — When each notification arrived (unique)

Each Notifications page row ends with a `<time datetime>` stamp ("5 min.
ago"), localized by Intl.RelativeTimeFormat through `currentLocale()` (locale
date/time fallback when the runtime lacks it). Grouped thread rows show their
newest reply's time; rows without a parseable time show none. Row labels are
now explicit text nodes. CSS `.notification-time` (muted, normal weight).

## Strings

None (relative times come from Intl).

## Storage keys

None.

## Tests

637 → 646 (wave23 +1 growth, wave38-timing-harness 3, wave38-notification-times
5). F2 RED first (4 failing before the code).

## Migrations

None.
