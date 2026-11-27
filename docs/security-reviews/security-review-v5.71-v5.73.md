# Security review — 0eed02a..96ab785 (wave 5.73.1)

Scope: `git diff 0eed02a 96ab785` (the v5.70.1 release to the v5.73.0
merge: v5.71.0, v5.71.1, the owner's v5.71.2, v5.72.0 and v5.73.0).
68 files changed: 52 non-locale files plus 16 new locale bundles. The
runtime changes are v5.71.0 and v5.72.0 (sixteen new interface languages,
an hy as av ay bm ba be and bi bs br my ch ce ny cv: sixteen bundles under
public/locales/ and sixteen `LOCALES` entries in public/js/i18n.js), v5.71.1
(the two-state theme toggle in public/js/theme.js, fixed-popup caps of 100%
instead of 100vw in public/styles.css, `upload_source_maps` in wrangler.toml
and wrangler.example.toml), v5.71.2 (the cdnjs polyfill `<script>` in
public/index.html and the HTML-leg CSP allowance in api/core/http.mjs) and
v5.73.0 (shrink-wrapped DM bubbles in public/styles.css; the `nomodule`
public/js/legacy-notice.js and its static `#legacy-notice` block). worker.mjs,
migrations/, api/vendor/ and public/js/vendor/ were not touched. The rest is
docs, .gitignore, version bumps and test files.

25 items reviewed. Findings: 0 CRITICAL, 0 HIGH, 1 MEDIUM (M1, fixed),
1 LOW (L1, covered by a new pin), 1 INFO (I1, fixed with M1), plus one new
owner item (O10, MEDIUM, owner-gated, not changed). RED-first pin for M1 and
regression pins for the checks that pass are in
tests/wave5731-security-review.test.mjs. The open owner items O1-O9 and the
open L8 and L9 from docs/security-reviews/2026-11-22-v5.57-v5.60.md are
carried over unchanged (their code was not in this diff and was not
re-reviewed).

| ID | Severity | Where | Status |
|----|----------|-------|--------|
| M1 | MEDIUM | api/core/http.mjs:59 | Fixed in v5.73.1 |
| O10 | MEDIUM | public/index.html:24 | Owner-gated (owner-ordered in v5.71.2), not changed |
| L1 | LOW | tests/wave528-security-pins.test.mjs:195 | Covered by a new anchored pin |
| I1 | INFO | api/core/http.mjs:55 | Fixed (comment) with M1 |
| L8, L9, O1-O9 | see the v5.57-v5.60 review | unchanged code | Carried over |

## M1 — MEDIUM — the HTML CSP allowed every script on cdnjs (fixed)

- Where: api/core/http.mjs:57 (v5.71.2) spliced the bare origin
  `https://cdnjs.cloudflare.com` into the static leg's `script-src`.
- Failure scenario: cdnjs is a public CDN that hosts thousands of libraries,
  including script gadgets that defeat a host allow-list CSP (old AngularJS
  builds evaluate template expressions from plain DOM attributes; CSP
  evaluators flag cdnjs as a bypass host for this reason). If any HTML
  injection ever lands in the shell (a future renderer bug, say), the
  attacker adds `<script src="https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.x/angular.min.js">`
  plus an attribute payload and gets script execution despite the CSP, which
  is exactly the defence-in-depth the CSP exists for.
- Fix: the allowance is the path source `https://cdnjs.cloudflare.com/polyfill/`.
  The shell's polyfill URL (`/polyfill/v3/polyfill.min.js?...`) is unchanged
  and still matches; nothing else on cdnjs does. Every browser that can run
  the forum's ES modules implements CSP Level 2 path matching, so the owner's
  polyfill keeps loading where it can matter. The old pin in
  tests/wave5712-polyfill-csp.test.mjs:39 was tightened to the path source
  (stricter, not looser).
- Pin: tests/wave5731-security-review.test.mjs "M1: ..." (RED at 61323ff,
  GREEN at 0c164af).

## O10 — MEDIUM — third-party polyfill script on every page (owner-gated)

- Where: public/index.html:24 (v5.71.2, owner order Nov 22 13:33/13:35).
- Effect: a classic script from cdnjs runs with full forum-origin privileges
  (session-bound `api()` calls, DOM, storage) before the module graph. The
  polyfill service varies its body by User-Agent, so Subresource Integrity is
  impossible; the forum trusts cdnjs's runtime output on every load (the
  2024 polyfill.io takeover is the precedent for this class). Every visitor's
  IP address and User-Agent also go to a third party on every page load,
  default-on, which conflicts with the privacy-design law (network actions
  explicit, never default-on). `referrerpolicy="no-referrer"` keeps the page
  URL out of it.
- Not changed: owner-ordered behaviour; M1 narrows its blast radius only.
- Owner options: (a) self-host a fixed polyfill bundle under /js/ (no third
  party, CSP back to the vendor set); (b) drop it: browsers that cannot run
  ES modules already get the v5.73 no-module notice, and module-capable
  browsers need few of the listed fills; (c) keep it as an accepted risk.

## L1 — LOW — one polyfill allow-list in an older test is unanchored

- Where: tests/wave528-security-pins.test.mjs:195-197 (v5.71.2 hunk). The
  `POLYFILL_TAG` regex has no `^...$`, so a polyfill tag that also carried
  extra attributes (`type="module"`, `integrity`, an `on*` handler) would
  still be skipped by that loop. The second hunk (line 213) is anchored.
- Effect: test-strength only; tests/wave5712-polyfill-csp.test.mjs already
  rejects async/defer/module on the tag.
- Action: covered without editing the older test: the new pin "the polyfill
  tag is exactly one classic external script with src and no-referrer only"
  anchors the whole tag (`^<script src="https://cdnjs.cloudflare.com/polyfill/v3/polyfill.min.js?..." referrerpolicy="no-referrer">$`).

## I1 — INFO — CSP comment said "only HTML responses"

- Where: api/core/http.mjs:55. `secureResponse` wraps every ASSETS response
  (HTML, JS, CSS, locale JSON, images), not only HTML. A script-src on
  non-HTML responses has no effect, so no runtime consequence. The comment
  now says "static-leg (ASSETS) responses" (same edit as M1).

## Checks that passed

1. HTML sinks. No public/js module (vendor aside) assigns `innerHTML` /
   `outerHTML` or calls `insertAdjacentHTML`, `document.write`, `eval` or
   `new Function` outside comments. The v5.73 DM bubble change is CSS only
   (styles.css: `display: block; width: fit-content; max-inline-size: 78%`);
   bubble text is still painted as text. Pinned (whole public/js sweep).
2. Locale strings carry no markup. All 16 x 1223 new strings: no `<` `>`,
   entities, `javascript:` / `data:` / `vbscript:`; no `{{` (en has none);
   placeholder multiset and `{` / `}` count per key equal to en's. Pinned.
3. Bundle hygiene. All 16 parse as flat string maps with exactly en's 1223
   keys, no BOM; no C0/C1 controls, Arabic letter mark, zero-width
   characters (ZWJ/ZWNJ included), bidi marks, embeddings, overrides or
   isolates, word joiner or soft hyphen. Pinned.
4. Direction. All 16 are `dir: "ltr"` (Latin, Cyrillic, Armenian,
   Bengali-Assamese, Myanmar scripts). `localeDir` returns ltr. Pinned.
5. Registration. Each code is in `LOCALES` exactly once; the bundle set
   equals the `LOCALES` set (65). Pinned.
6. Locale fetch path. `detectLocale` only returns a shipped code for hostile
   stored/browser tags (`../en`, `hy/../../x`, `br.json`, `my%2F..`,
   `cv?x=1`, `<bs>`, a bidi override); the fetch also `encodeURIComponent`s
   the code (i18n.js:223). Pinned.
7. `/locales/<unknown>` stays an honest plain 404; the 16 new bundles serve
   200 JSON through `worker.fetch`. Pinned.
8. CSP shape. Apart from M1's script-src source, the HTML-leg CSP equals the
   vendor CSP directive by directive (style-src `'self'` only, object-src
   `'none'`, frame-ancestors `'none'`); no `'unsafe-*'`, wildcard, scheme-only
   or `data:`/`blob:` in default-src, script-src or style-src. JSON/API,
   feeds, images and discovery keep the vendor set (only `secureResponse`
   uses the hook). `forumDocumentSecurityHeaders` fails closed if the vendor
   policy changes shape. Pinned.
9. Routes. api/core/http.mjs adds no route, statement or bound parameter;
   no visibility, bind-budget or CSRF surface changed.
10. Polyfill tag. Exactly one external script in the shell, classic and
    blocking, `src` + `referrerpolicy="no-referrer"` only, no inline script.
    Pinned (anchored; see L1).
11. No-module notice (legacy-notice.js). Same-origin external classic file,
    so CSP-compatible with `script-src 'self'` (no inline script, no eval);
    plain ES5; reads nothing, stores nothing, makes no request; it only
    removes `hidden` from `#legacy-notice` and tolerates the block missing.
    Executed in a `vm` context with a fake-dom node. Pinned.
12. Notice markup. `#legacy-notice` (index.html:127) is static text with one
    `https://www.mozilla.org/firefox/new/` link, no inline handler, style or
    script; hidden by default (`hidden` + `.legacy-notice[hidden]`). Module
    browsers never run the file. Pinned.
13. Theme two-state (theme.js:114). Writes `"system"` into the existing
    device-pref key `forum-theme` instead of removing it; `resolveTheme`
    and theme-preload.js accept only `dark` / `light`, so `"system"` always
    means follow the OS. No new key, nothing account-scoped. Pinned.
14. Storage wipe. No new localStorage key family in the range; `forum-theme`
    stays a device pref outside `wipeAccountLocalData()` by design
    (tests/wave27-storage-wipe-sweep.test.mjs green).
15. Fixed-popup caps (styles.css, 100vw to 100%). Layout only; no security
    surface.
16. CSS fetches. styles.css still has no `@font-face`, `@import` or remote
    `url()`; the `.legacy-notice` rules have no `url()`. Pinned.
17. Source maps. `upload_source_maps = true` uploads maps to Cloudflare for
    stack traces; no `.map` file is under public/, so none is served (the
    source is public AGPL code anyway). Pinned.
18. .gitignore adds `.firecrawl/` (local tool cache). Keeps scrape output out
    of the public repo.
19. Test churn (31 edited older tests/*.test.mjs). 28 files only raise a
    locale count (49 to 65, 48 to 64; exact `assert.equal`, so stricter) or
    extend the locale list in tests/wave536-search-client.test.mjs, with
    titles/comments to match. Four hunks loosen a check, each scoped to the
    owner-ordered polyfill or the slate-designed English notice and
    documented in place: tests/i18n.test.mjs:185 (exempts exactly the
    `#legacy-notice` block from the untranslated-English sweep, non-greedy to
    its first `</div>`), tests/wave528-security-pins.test.mjs:195 and :213
    (skip the polyfill tag; :195 unanchored, see L1),
    tests/wave534-share.test.mjs (allows at most one external script whose
    src starts with the exact polyfill URL). No assertion was dropped,
    skipped or marked todo.
20. AGPL headers. legacy-notice.js and the six new test files carry the
    19-line header; the 16 bundles are covered by REUSE.toml.
    tests/license-headers.test.mjs green.
21. Vendored files. No diff under api/vendor/ or public/js/vendor/.
22. Secrets. No credential, token or `.dev.vars` content in the diff
    (wrangler*.toml, package.json, docs and CHANGELOG hunks checked).
23. Migrations. None in the range.
24. Strings. No new keys; the 16 bundles translate en's existing keys only;
    the notice is static English by design (it shows only where the i18n
    module cannot run).
25. Defaults. No activity-revealing feature added. O10 is the one new
    default-on network action (owner-ordered).

## Evidence

- `pnpm test` and `pnpm lint` green on branch wave-5-73-1 (counts in the
  release notes, .team/release-5.73.1.md).
- New pins: tests/wave5731-security-review.test.mjs (12 tests; 1 RED-first
  for M1, 11 regression).
