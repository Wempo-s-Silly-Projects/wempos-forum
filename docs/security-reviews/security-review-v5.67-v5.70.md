# Security review — e3ed3ae..ff7720e (wave 5.70.1)

Scope: `git diff e3ed3ae ff7720e` (the v5.66.0 release to the v5.70.0 merge).
53 files changed. The runtime changes are v5.67 (the L-fix pair from the
v5.66 review: the write limit on `PATCH /api/me` in api/profiles.mjs and the
sign-up read built from the shared `SOCIAL_SELECT_COLUMNS` in api/session.mjs
and api/core/shapers.mjs), v5.68 and v5.69 (eight new interface languages,
af sq az eu ab aa am ak: eight new bundles under public/locales/, eight
`LOCALES` entries and the `pluralRulesFor` fallback in public/js/i18n.js, the
Ethiopic font names in public/styles.css) and v5.70 (one CSS colour token).
worker.mjs, migrations/, api/vendor/ and public/js/vendor/ were not touched.
The rest is docs, REUSE.toml, version bumps and test files.

22 items reviewed. Findings: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW, 1 INFO
(I1, no runtime effect, not fixed). No code change in this wave; the pins in
tests/wave5701-security-review.test.mjs are all regression pins. The open
owner items O1-O9 and the open L8 and L9 from
docs/security-reviews/2026-11-22-v5.57-v5.60.md are carried over unchanged
(their code was not in this diff and was not re-reviewed).

| ID | Severity | Where | Status |
|----|----------|-------|--------|
| I1 | INFO | REUSE.toml:27 | Open (no runtime effect) |
| L8, L9, O1-O9 | see the v5.57-v5.60 review | unchanged code | Carried over |

## I1 — INFO — REUSE.toml annotates a file that does not exist

- Where: REUSE.toml:27 adds `.bestpractices.json` to the uncommentable-files
  annotation (v5.67-v5.70 range). No such file is in the tree, and it is not
  git-ignored.
- Effect: none at runtime; `reuse lint` accepts an annotation that matches
  nothing. It only matters if a file of that name is added later, which then
  inherits the AGPL annotation automatically (the intended outcome).
- Action: none this wave (out of a PATCH security scope). The owner may drop
  the line or add the file.

## Checks that passed

1. HTML sinks. public/js has no `innerHTML`, `outerHTML` or
   `insertAdjacentHTML` call (the only four matches are comments saying so).
   i18n.js paints locale names with `option.textContent` (i18n.js:289) and
   static copy with `textContent` / `setAttribute`. Pinned.
2. Locale strings carry no markup. All 8 x 1223 new strings: no `<` `>`,
   entities, `javascript:` / `data:` / `vbscript:`; no `{{` (en has none);
   placeholder multiset per key equal to en's and the `{` / `}` count equal to
   en's per key. Pinned.
3. Bundle hygiene. All 8 parse as flat string maps with exactly en's 1223
   keys, no BOM; no C0/C1 controls, zero-width characters, bidi marks,
   embeddings, overrides or isolates, word joiner or soft hyphen. Pinned.
4. Direction. All 8 are `dir: "ltr"` (Latin, Cyrillic for ab, Ethiopic for
   am; all left to right). `localeDir` returns ltr for each. Pinned.
5. Registration. Each code is in `LOCALES` exactly once, and the bundle set
   equals the `LOCALES` set (tests/wave54-security-pins.test.mjs, 49).
6. Locale fetch path. `detectLocale` / `matchTag` only return a code from
   `LOCALES`, so stored or browser tags (`../en`, `ab/../../x`, `ak?x=1`,
   bidi) never reach the fetch; the fetch also `encodeURIComponent`s the code
   (i18n.js:207). Pinned with hostile inputs.
7. `/locales/<unknown>` stays an honest plain 404 (worker.mjs:191
   `PLAIN_404_PREFIXES`); the 8 new bundles serve 200 JSON. Pinned through
   `worker.fetch`.
8. Plural fallback (i18n.js:164-176). Pure: no storage, network or
   account-scoped key; an invalid tag falls through to English rules; ab and
   aa get the n = 1 split. Pinned.
9. Storage. No new localStorage key in the range. The locale choice stays the
   existing device pref `wempo-locale`, which is correctly not in the logout
   wipe. tests/wave27-storage-wipe-sweep.test.mjs green.
10. `PATCH /api/me` (api/profiles.mjs:165-169). Order is `requireUser`
    (CSRF + same-origin) then `assertNotBanned` then
    `rateLimit("write", member id)` then `readJson`, so an over-limit or
    banned member never gets the body parsed or an AutoMod row queued. The
    behavioural 429 / no-write pin is tests/wave567-fixes.test.mjs; the order
    is pinned here.
11. Sign-up read (api/session.mjs:70-75). `SOCIAL_SELECT_COLUMNS`
    (shapers.mjs:125) is built only from the code constant `SOCIAL_PLATFORMS`
    (every column `^[a-z_]+$`), no user input; the statement keeps one bound
    `?` and `LIMIT 1`. The row is shaped by `publicUser` before it leaves.
    Pinned.
12. Bind budget. No new statement besides item 11 (1 bind, far under
    `D1_MAX_BOUND_PARAMS`). No feed or list query changed.
13. Visibility law. No read path that returns posts, replies, users or chat
    to a non-staff viewer changed.
14. CSRF on writes. The only changed write (item 10) keeps `requireUser`.
15. Font stack (styles.css:28). Local font names only; styles.css has no
    `@font-face`, `@import` or remote `url()`, so no third-party font fetch
    (privacy law: no network action by default). Pinned.
16. Contrast token (styles.css:35). Colour only; no security surface.
17. Test churn. Every edited hunk in the 25 older tests/wave*.test.mjs files
    only raises a locale count (41 to 49, 40 to 48) or extends the
    hard-coded locale list in tests/wave536-search-client.test.mjs with the 8
    new codes; comments and test titles updated to match. No assertion was
    dropped, loosened, skipped or marked todo. Every count is an exact
    `assert.equal`, so each got stricter, not weaker.
18. AGPL headers. The four new test files (wave567, wave568, wave569,
    wave570) carry the 19-line header byte-for-byte; the new JSON bundles are
    covered by REUSE.toml. tests/license-headers.test.mjs green.
19. Vendored files. No diff under api/vendor/ or public/js/vendor/.
20. Secrets. No credential, token or `.dev.vars` content in the diff (docs,
    AGENTS.md, AGENTS-ROSTER.md, wrangler.toml and package.json hunks
    checked).
21. Migrations. None in the range.
22. Strings. No new keys; the 8 new bundles are translations of en's
    existing keys only (tests/i18n.test.mjs parity green).

## Evidence

- `pnpm test` and `pnpm lint` green on branch wave-5-70-1 (counts in the
  release notes, .team/release-5.70.1.md).
- New pins: tests/wave5701-security-review.test.mjs (10 tests).
