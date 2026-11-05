# v4.0 Rewrite — Cleaner Architecture, Identical Desktop Behavior, Rebuilt Responsive Layer

**Date:** 2026-11-05 · **Branch:** `v4.0` (cut from main at `91c3ab9`) · **Path:** strangler, in place — every commit boots and tests green; main stays production until the owner merges.

## Goal

v4.0 restructures the entire codebase for clarity: small files, one purpose each, defined seams. **Same features, same desktop look, same stack.** The one deliberate behavior change: the responsive/mobile layer is **rebuilt from scratch** (owner's call — "it is the definition of broke": layout, bottom bar, touch ergonomics, and PWA layer all hurt, and narrow desktop windows look bad too).

## Non-negotiable invariants

1. **API surface identical** — every path, method, status code, and payload shape from claude.md's API coverage list is unchanged.
2. **DB schema frozen** — zero new migrations, zero schema edits.
3. **Desktop output identical** — at comfortable desktop widths (≥ ~900px) the forum renders exactly like v3.1: same tokens, same layout, same styles. Below that, the new responsive layer owns everything.
4. **CSP and security headers identical** — same policy strings, same cookie flags, same secrets contract (SETUP_SECRET, PASSWORD_PEPPER, FILTERED_WORDS, GOOGLE_VISION_API_KEY, OPENAI_API_KEY).
5. **Every claude.md behavior note still true** — that file is the acceptance spec (its mobile-PWA bullet gets rewritten to describe the new layer).
6. **The suite passes at every commit** — each step ends with `npm test` + `wrangler deploy --dry-run` clean.

## Current state (measured, 2026-11-05)

16,056 lines backend + frontend. Pain is concentrated:

| File | Lines | Problem |
|---|---|---|
| `public/js/app.js` | 2,513 | God file: routing, session, header, every route render, every form handler |
| `api/posts.mjs` | 1,369 | Feed read, composer write, replies, search, suggestions — interleaved |
| `api/shared.mjs` | 1,210 | Grab-bag: http glue + roles + image sanitize + visibility + cursors |
| `api/profiles.mjs` | 722 | Profile read + avatar routes + profile-CSS sandbox |
| `public/styles.css` | 2,075 | Base styles fine; the accreted media-query layer is the broke part |
| `public/js/render.js` | 594 | Acceptable size, mixed concerns |
| `public/js/admin.js` | 592 | Desk sections in one file |
| `api/moderation.mjs` | 582 | Report queues + bans + role admin |

Untouched entirely: `index.html` (except viewport/meta if the new layer needs it), `migrations/`, `wrangler.toml`, icons, static assets.

## Backend design

### The import-layer rule (applies to every module)

Three layers, imports only ever point **down**:

1. **`api/core/`** — pure leaves with zero cross-module deps: `http.mjs` (json, HttpError, securityHeaders, rateLimit glue), `roles.mjs` (stored/public vocab, publicRole, ROLE_*_DB), `images.mjs` (sanitizeImage, sniffImageMime, imageResponse, blobToUint8Array), `visibility.mjs` (canViewPost, active-ban predicate), `cursors.mjs` (composite `<seconds>_<id>` / `<score>_<id>` encode-decode-parse).
2. **`api/` topic modules** — import core; own their tables.
3. **`worker.mjs`** — imports topics only; keeps its flat handler array and its `export { … } from` re-export surface **unchanged**, because tests import through it.

If a circular import appears, the design is wrong — fix the seam, never add a cycle.

### Splits

- **`shared.mjs` (1,210) dissolves into `api/core/`** (above). A one-line `api/shared.mjs` re-export shim stays during transition; deleted in the final sweep. Nothing outside `api/` changes any import.
- **`posts.mjs` (1,369)** → `posts-feed.mjs` (list + detail + cursor pagination + view counting), `posts-write.mjs` (create/edit/delete + archive copy + reply reparenting + composer validation), `replies.mjs` (reply read paths + nesting), `search.mjs` (users+posts shape, `by=`, `in=replies`), `suggestions.mjs` (status transitions + score-sorted board), `boards.mjs` (BOARD_VALUES + slug helpers). One public `handlePostRoutes` composed from the pieces keeps worker.mjs untouched.
- **`profiles.mjs` (722)** → `profiles.mjs` (read payload + counters + colors), `profile-css.mjs` (submit + serve + scopeProfileCss), `avatars.mjs` (upload + serve + moderation queue routes).
- **`moderation.mjs` (582)** → `bans.mjs` (create/revoke/list + IP bans + timed expiry), `reports.mjs` (post + profile report queues, resolution), and `members-admin.mjs` (promote/demote + member search). The seam is "who bans" vs "who reviews" vs "who manages roles."
- Already-clean topic modules (`session.mjs`, `notifications.mjs`, `filter.mjs`, `attachments.mjs`, `vision.mjs`, `textmod.mjs`, `chat.mjs`, `dms.mjs`, `gifs.mjs`, `appeals.mjs`, `polls.mjs`, `subscriptions.mjs`, `bookmarks.mjs`, `rules.mjs`, `leaderboard.mjs`, `archive.mjs`) keep their topic-per-module homes; only their imports of shared.mjs move to core.

### worker.mjs

Stays ~100 lines: handler array, apiError, secureResponse. **No route-registry rewrite** — the flat dispatch is already the right idiom at this scale; the jungle was inside the modules, not the loop.

## Frontend design

Same vanilla ESM, same textContent-only rendering (no innerHTML anywhere, ever), same `data-action`/`data-form` delegation.

- **`router.js`** grows into the real route table: path pattern → route module's `render(host, state)`. pushState/popState behavior identical.
- **`public/js/routes/`** — one file per route, each owning its render + bindings: `feed.js` (home / /mine / categories / suggestions), `post.js` (detail + replies + quote + history), `profile.js`, `leaderboard.js`, `rules.js`, `archive.js`, `search.js`, `settings.js`, `admin.js`, `auth.js` (sign in/up/setup/ban screen). `chat.js` already is this shape — it moves into `routes/` untouched.
- **`app.js` (2,513) shrinks to boot** (~200–300 lines): session resolution, header/nav composition, route delegation, global message area. Every form handler lives in the route module that renders its form; shared submitForm stays in `forms.js`.
- **`render.js`** keeps element-building helpers; anything route-specific moves into its route module.
- **`admin.js` (592)** splits along the desk's sections (reports, bans, appeals, attachments/avatars, auto-mod panels, chat/DM logs) as desk-section modules.

## Responsive + mobile rebuild (the one behavior change)

The current media-query layer (accreted ≤640px patches + the v2.5 bottom bar + safe-area insets) is deleted and rebuilt from zero, covering **all narrow viewports** — phones, split-screen, tablets, half-width desktop windows — not just one phone breakpoint.

**Kept:** the design tokens (colors, radii, fonts, dark mode), the forum's visual identity, the manifest/standalone PWA concept, installability.

**Rebuilt, from scratch:**

- **`public/responsive.css`** — a separate stylesheet with the entire responsive layer, so `styles.css` is desktop-only and both files are single-purpose. Desktop rendering (≥ ~900px) is byte-equivalent in effect to v3.1.
- **A real breakpoint ladder** instead of patches: ~900px (narrow desktop — content column narrows gracefully, sidebar/header compress), ~640px (phone — single column, everything full-width). Fluid sizing between rungs; **no horizontal scrolling ever** — wide content (code blocks, tables, long URLs) scrolls *inside its own box* (`overflow-x: auto` on the box, never the page).
- **Rebuilt mobile chrome:** the bottom app bar is redesigned, not patched — same five destinations (Home / My posts / Suggest / Alerts / Profile-or-Sign-in) but rebuilt with active-route highlighting, 48px touch targets, `env(safe-area-inset-*)` padding, and hiding when the on-screen keyboard opens (composer focus).
- **Touch ergonomics:** ≥44px hit areas on every interactive element at phone width, sticky composer above the keyboard, action rows sized for thumbs, no hover-dependent affordances.
- **PWA layer:** viewport meta corrected, `theme-color` per light/dark theme, `overscroll-behavior` so pull-to-refresh doesn't fight the app, installed-standalone treated as a first-class target.

**Acceptance:** at ≥900px nothing visibly changes; at every narrower width the site is clean — no sideways scroll, no overlapping text, no squished icons; the installed PWA feels native. Verified in a real browser at common widths (1440, 1024, 820, 768, 640, 390, 320).

## Testing strategy

- Core leaves are pure functions keeping their current names — most test files change **only import paths**. Tests importing through `worker.mjs`'s stable re-export surface keep working untouched.
- New seam tests welcome where a leaf had none (cursors encode/decode deserves direct tests).
- Synthetic-vocabulary rule unchanged: no real filtered words in tests or fixtures.
- Any behavior bug discovered mid-rewrite is **reported and fixed as its own commit**, never silently absorbed into a move.
- The responsive layer gets manual browser verification at the width ladder above (the existing local smoke-test discipline).

## Execution order (each step ends with green `npm test` + dry-run)

1. **Core split** — dissolve shared.mjs into `api/core/`, update every import. Highest blast radius, so first, while all else is v3 shape.
2. **posts.mjs split** into its six pieces.
3. **profiles.mjs + moderation.mjs splits.**
4. **Frontend router table** — router.js owns delegation (intermediate state: app.js still renders routes internally).
5. **app.js dissolution** — one route module extracted per commit, feed first.
6. **admin.js desk-section split.**
7. **Responsive + mobile rebuild** — delete the old media-query layer and bottom bar, build `responsive.css` + the new mobile chrome against the now-stable v4 DOM. Done after route extraction so the rebuilt layer targets the final structure, not a moving one.
8. **Final sweep** — delete the shared.mjs shim and dead exports, update claude.md (structure notes, new mobile bullet, version stamp).

## Risks

- **Circular imports** — prevented by the layer rule; any cycle is a design failure to fix at the seam.
- **Silent behavior drift** — countered by the invariants + suite green at every commit; claude.md is the acceptance spec.
- **Responsive rebuild regresses desktop** — countered by the ≥900px-identical rule + width-ladder verification.
- **Mobile rebuild built against a moving DOM** — countered by doing it after step 5.

## Definition of done

All invariants hold; no JS file over ~600 lines; desktop output identical; the width ladder verified clean in a real browser; `npm test` and `wrangler deploy --dry-run` clean; claude.md updated; the owner smoke-tests locally before merging to main.
