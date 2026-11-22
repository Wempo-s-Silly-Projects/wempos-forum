# Feature slate 2026-11-22-e (v5.76.0, MINOR): self-hosted core-js polyfill replaces cdnjs

Owner approval to draft: Nov 22 15:03 ("2 and 3 and 4", item 4 = write the core-js slate). Owner earlier: "use polyfill just in case … for people who CANT UPDATE" (v5.71.2 added the cdnjs polyfill). Nothing is built until the owner approves this slate.

## Findings (measured Nov 22 against core-js 3.51.0)
- **Real browser floor = our syntax, not ES modules.** Client code uses `?.` (97 files), `??` (84) and `??=` (`public/js/i18n.js:277`, boot path). Syntax cannot be polyfilled, so anything below **Chrome/Edge 85, Firefox 79, Safari/iOS 14, Samsung 14, Opera 71** fails to parse before any polyfill runs.
- **Built-ins we call that need help at that floor** (core-js-compat 3.51.0, `targets` = the floor, `modules` = what `public/js/**` calls): `es.array.at`, `es.object.has-own`, `es.string.at-alternative`, plus `web.url.parse`, `web.url.can-parse`, `web.url-search-params.{delete,has,size}`. The `URL` constructor itself is NOT needed at this floor in 3.51.0 (that bar rises only in unreleased core-js master). Even all of `core-js/stable` is 99 modules at this floor; today's cdnjs line requests ~300 features.
- **Not polyfillable by core-js:** `Intl.*` (9 files), `crypto.randomUUID` (1 file; Chrome 92 / Firefox 95 / Safari 15.4, above our floor), `AbortController` (fine, below floor).
- **Gap today:** browsers between "runs ES modules" and our syntax floor (e.g. Chrome 61–84, Safari 10.1–13.1) load the module, hit a SyntaxError and show a blank page. The v5.73.0 no-module notice never fires for them (it is `nomodule`).

## E1: self-hosted core-js build
- **Source:** core-js 3.51.0 release (owner's `core-js-3.51.0.zip`, verified identical to tag `v3.51.0`, 0/4555 files differ; sha256 `3a8ab681…6135`).
- **Build workspace: OUTSIDE the repo** (owner's home-folder install of `core-js-builder` 3.51.0). core-js-builder pulls webpack 4 (7 audit findings: 3 high, all build-time). It never enters the forum lockfile.
- **Module list:** the exact list from the core-js-compat query above, after the inventory step confirms each call site (`URL.parse`, `URL.canParse`, `URLSearchParams#size/has(n,v)/delete(n,v)` only if actually called). Expected: a few KB, unminified (FSF readable-JS posture, like Prism).
- **Vendored verbatim** as `public/js/vendor/core-js.js`, core-js's own banner kept, no edits. REUSE `public/js/vendor/**` MIT block gains `SPDX-FileCopyrightText = "Denis Pushkarev, CoreJS Company"`. sha256 pinned by test.
- **Loading:** `/js/polyfill-loader.js` (AGPL, classic script) feature-checks the listed built-ins and only then adds `<script src="/js/vendor/core-js.js">`. Modern browsers download nothing. It must run before the app module (blocking classic script ahead of the module tag).
- **CSP:** drop `https://cdnjs.cloudflare.com` from `script-src` (v5.73.1 scoped it to `/polyfill/`; this removes it). One fewer third-party network request on every page load (FSF "network actions explicit" posture).

## E2: dev-only coverage test (`core-js-compat` as the only new devDependency)
- Add `core-js-compat` 3.51.0 (pinned exactly) to the forum devDependencies. Dependencies: browserslist only, no audit findings, no install script.
- **Remove** from the forum: `core-js`, `core-js-builder`, and the `allowBuilds` entries `core-js: true` and `fsevents: true` (currently uncommitted in the main checkout; owner's call; this slate assumes they are gone by the time E1 merges).
- Test: a pinned inventory of built-ins the client calls → `compat({ targets: FLOOR, modules: INVENTORY })` → every returned module must be in the vendored build's module list (read from core-js's own banner/summary comment). Adding a new built-in without rebuilding fails CI.
- `FLOOR` lives once in root `constants.mjs` (`BROWSER_FLOOR`), not re-declared.

## E3: blank-page gap notice
- Make the existing ES5 notice script fire for the "modules but too-old syntax" band too: drop `nomodule`, and show the notice at `DOMContentLoaded` when the app has not set `document.documentElement.dataset.booted` (module scripts run before DOMContentLoaded, so a parse failure leaves the flag unset). No `eval`/`new Function` (CSP forbids it). Same English text plus the existing update link; the notice element stays hidden by default.
- The app sets `data-booted` as the first line of its entry module.

## E4: guards for what core-js cannot fill
- `public/js/polls.js:36-46`: the `Intl.RelativeTimeFormat` try/catch only covers locale errors, so a browser without the API throws. Feature-check it first and fall back to the existing absolute-time path (same pattern as `reltime.js:88`).
- `crypto.randomUUID` call site: feature-check it, falling back to `crypto.getRandomValues`-based v4 formatting (Web Crypto, present at our floor).

## Strings
None new (E3 reuses the existing no-module notice text). If any is added: en.json plus all 65 locales, really translated.

## Tests (RED first)
- Vendor sha256 pin; REUSE annotation names CoreJS Company; no `cdnjs` anywhere in `public/index.html` or the CSP.
- Loader: classic (non-module) script, ordered before the app module, same-origin src, injects the vendor script only when a check fails (vm sandbox with the built-ins removed vs present).
- Coverage test (E2) green; mutation check: adding `"es.array.find-last"` to the inventory turns it RED.
- E3: notice shows when `data-booted` is unset at DOMContentLoaded, stays hidden when set; legacy script is still ES5 (no arrows, `let`/`const`, `import`).
- E4: polls render with `Intl.RelativeTimeFormat` deleted; UUID path works with `randomUUID` deleted.
- `pnpm audit --prod --audit-level=moderate` clean; the lockfile has no `webpack`.

## Ship-review
Client assets plus a CSP change: checks 1–4 and 7 N/A; 5, 6, 8 and 9 apply. VERSION 5.76.0, CHANGELOG, `.team/release-5.76.0.md`. Firefox check: page loads with no cdnjs request (network panel) and the polyfill is NOT fetched on current Firefox.
