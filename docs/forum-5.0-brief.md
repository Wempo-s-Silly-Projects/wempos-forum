# WEMPOS-FORUM 5.0 — the brief

Status: brief only. No wave-1 feature code has been written; the lead
dispatches builders against this document.

Worktree: `/Users/itswempo/forum-5.0`, branch `forum-5.0` (created off
`main` @ `7b4d844`). Baseline suite green.

**The scar guard is law:** the forum is live production. Zero deploys, zero
prod D1 writes, zero migrations against live tables for the whole of 5.0.
Every wave lands on the branch with `node --test tests/` green.

---

## 1. Baseline (recorded Nov 17, 2026)

- `node --test tests/` → **202 tests, 202 pass, 0 fail** (~1.1 s).
- Worker side of the Kitskey migration is ALREADY on main (phases 1–4):
  - `api/vendor/http.mjs` + `api/vendor/db.mjs` vendored, byte-pinned and
    enforced by `tests/vendor-parity.test.mjs` (the ledger pattern is live
    and extendable).
  - `worker.mjs` consumes `vendor/http.mjs`'s `dispatch` + `errorReply`;
    the static leg consumes the core leaf; the phase-1–4 worker migration
    commits (`6ebcc42`, `c3417b3`, `d9f29f3`) are the base this branch sits on.
  - `api/core/` is the app's consumption layer (12 modules: arch…visibility).
- Browser side: **nothing vendored yet** — `public/js/` has no `vendor/`
  directory. The app still carries the pre-Kitskey local twins
  (`dom.js` panel/heading, `forms.js` form factories) that the designer
  modules supersede.
- Prior door-swap (§4b, already on main): on-site registration and
  password-login forms are GONE; `routes/auth.js` is only the first-owner
  setup screens + the guest door panel; `routes/account-nav.js` signs out
  through Wempo Accounts' land.

## 2. What 5.0 IS

A vanilla rewrite **on the Kitskey framework** — no React, no Vite, no build
step (the React ruling is withdrawn). The existing app's look, schema and
auth semantics all survive; the *shape* of the browser code is what changes:

- Framework modules vendored, byte-pinned, enforced by the parity test.
- App code re-expresses its UI through them — **no redesign of the look**
  (the design language is the forum's OWN: its tokens, its wobbly buttons,
  its system font stacks).
- The surface model changes forum-wide (the rethink):

  1. **One surface model** — every real task is a URL-addressable page
     someone can link, reload, or deep-link back to. `openDialog` survives
     ONLY for fast confirmations (destructive confirm, the attachment
     lightbox). Anything that is a form today-inside-a-dialog — the report
     flow is the live offender — becomes a task page.
  2. **Empty states as instructions** — 28 `empty-state` call sites exist;
     5.0 raises them from "nothing here" text to teaching surfaces: what
     this page is for, the action that fills it, and the link to take.
     Every route's zero/first-run state is a feature, not a gap.
  3. **Unreads as a system** — unread is not just the notification bell
     count. One unread model the header, the mobile bar, the feed, the
     notifications page and the member's own route entries all read from
     (the read-marker rows the worker already advances ride underneath it).

- Wempo Accounts is THE registration door and THE account-settings home
  (ruling 5 — the axe list is §5).

## 3. Route / page inventory (the ONE surface model)

Browser router: `public/js/router.js` (`routeForPath`). Pages that must exist
in 5.0, each URL-addressable with restorable state:

| Page | Route(s) | Carries in today's code |
| --- | --- | --- |
| Home / feed | `/`, `/?q=` (search) | `routes/feed.js` (407 L) + `renderHomeAccess` door |
| Category board | `/c/:slug`, `/suggestions` (alias) | `routes/feed.js`, `routes/composer.js` |
| Post thread | `/posts/:id` | `routes/post.js` (236 L) + `render.js` post bodies |
| Member wall | `routes/wall.js` + `public/js/wall.js` | profile route child |
| Profile | `/users/:name` (+ own-profile editor) | `routes/profile.js` (397 L), `profile-editor.js` |
| Notifications | `/notifications` | `routes/notifications.js` |
| Saved posts | `/bookmarks` | `routes/account-nav.js` chrome + api |
| Mine (own posts) | `/mine` | feed route alias |
| Leaderboard | `/leaderboard` | `api/leaderboard.mjs` |
| Rules | `/rules` | `routes/pages.js` |
| Accountability archive | `/archive` | `api/archive.mjs` |
| Admin desk | `/admin/:section` | `routes/admin.js` (504 L) + `desk/*` (reports, bans, appeals, filter, media, chat-log) |
| Blocks | `routes/blocks.js` | private list |
| 2FA | profile-route panels (AXED — §5) | `routes/twofa.js` |
| First-owner setup | `/setup` | `routes/auth.js` (owner surface, out-of-band secret; stays) |
| Doors | header Sign in, guest rung, sign-out handoff | `sso.js`, `account-nav.js` (stays) |
| Composer | task page for new post/reply (currently rides `routes/composer.js`) | write path |
| Report flow | **today a dialog — becomes a task page** | `routes/reports.js` |
| Banned page | `banned.js` | state page |

`/login` and `/register` URLs already collapse to home (router line 14) — they
stay collapsed; the door panel is the instruction.

## 4. Verbatim vs re-expressed

### Carries verbatim (do not touch)

- **`styles.css` tokens both themes** — `:root` (line 1) and the
  `data-theme="dark"` (line 57) + auto (line 95) sets, including the
  wobbly `--button-radius: 0.45rem 0.65rem 0.4rem 0.55rem`,
  `data-corners="square"` accessibility override, and the 4-role button
  grammar (`button-primary / secondary / quiet / danger`) on the 2px-ink.
- **System font stacks**: Trebuchet body, Chalkboard accents, Georgia
  reflective, mono — wherever they appear in the token set.
- **All schema / auth semantics**: `users`/pepper/sessions, `gc_` tables,
  accounts DB untouched — drop-in compatible with the same
  `wempo-forum-data` database. `/api/auth/*`, `/api/setup`,
  `/api/auth/sso/redeem` stay exactly as they are.
- **`api/core/*`** — already the vendor-fed leaf; 5.0 does not re-walk it.
- **`index.html` skeleton** (header, mobile bar, dialog shells the page
  builds into — but dialog shells SHRINK to confirm-only, see the rethink).
- **The route map** — URLs do not change. Members' bookmarks and muscle
  memory survive.

### Re-expressed on Kitskey modules (behavior-identical, structure changed)

| Forum today | Vendored module | Notes |
| --- | --- | --- |
| `dom.js` `addHeading` / `createPanel` / `addSubmit`, 95 L, module-level `document.querySelector` at import time | `designer/kit` `addHeading`, `panel`, `addSubmit` | kit takes `parent` args + injects nothing at import; drop-in shape |
| `forms.js` `createForm` / `createInput` / `createSelect` (153 L, local twin of the kit family) | `designer/kit` `createForm`, `createInput`, `createSelect` | kit enforces labeled fields + `data-form` dispatch + `aria-describedby` structurally; forum's `forms.js` had it as options |
| ad-hoc DOM string/element building in `render.js` (594 L) | `frontload/dom` `el()` | user text rides `textContent`, never parsed markup |
| `theme.js` (91 L, theme + skin preloads) | `frontload/tokens` `makeAppearance` (with `resolveTheme` / `resolveSkin`) | `theme-preload.js` stays as the head-inline pre-paint shim |
| `dom.js` `openConfirmDialog` chain | `frontload/dom` `openDialog` | confirm-only use after the rethink |
| `state.js` module-level caches | `designer/kit` `createStore` | only where a route needs reactive state; the tiny store is the idiom |

## 5. The axe list (ruling 5 — Wempo Accounts centralization)

Wempo Accounts (accounts.itswempo.workers.dev) is THE registration door
(done last phase) and THE account-settings home (this phase's axing). Each
axed on-site surface, where its capability now lives, and what Accounts must
provide for the swap to complete:

| # | On-site surface today | File(s) | Axe → moves to Accounts | Forum keeps |
| --- | --- | --- | --- | --- |
| A1 | Password-change form | `public/js/routes/profile.js` (handler `password`, line 272; `PATCH /api/me/password`) | The change-password form leaves the forum UI. | The `PATCH /api/me/password` **API plumbing** (session-revocation semantics) until Accounts calls it or completes its own flow; then API retirement is a later, separate decision. |
| A2 | 2FA panels (setup / confirm / disable) | `public/js/routes/twofa.js` (208 L, the profile settings `details` panel ride) | TOTP enroll + disable become an Accounts settings screen. | The API routes `api/twofa.mjs` AND the sign-in `/api/auth/totp` verification step — the forum still runs its own sessions, so during the transition a member enrolled via Accounts still answers the forum's challenge. UI goes, plumbing stays until the accounts lane rules the seam. |
| A3 | Backup-code generation + display | `twofa.js` `openBackupCodeForm` / `renderBackupCodes` | Codes are generated and displayed ONCE, in Accounts, over its own channel. | Generate/confirm plumbing as in A2. |
| A4 | On-site registration | — | **Already axed** (§4b door-swap, on main). Only the door panel remains; it stays. |
| A5 | On-site password login | — | **Already axed** (§4b). Stays axed. |

**NOT axed (app-specific, ruling: forum keeps everything app-specific):**
profile display name / socials / accent picker / profile CSS / avatar
(`profile-editor.js` + `PATCH /api/me`, `/api/me/css`, `/api/me/avatar`);
blocks list; bookmarks; notification preferences; the `/setup` first-owner
surface (needs the out-of-band `SETUP_SECRET`).

**What 5.0 expects the Accounts dashboard to provide** (for the parallel
accounts lane's gap inventory): the change-password screen (A1), the 2FA
enroll/disable screen with backup codes (A2+A3), a session/device list that
matches the forum's session-revocation promise, and — since sign-out already
hands the browser to Accounts' land (A5 twin) — visible confirmation that the
forum session cleared. Until each item is LIVE in Accounts, 5.0 hides the
forum surface only when Accounts parity is confirmed; otherwise the forum
surface stays visible and is only re-expressed on the kit (flagged below in
the wave plan as the accounts-gated decision point).

## 6. Target module layout

The metric of 5.0: **smaller diffs per feature**. A feature wave touches one
route module, one api file, one test — not five files and a monolith.

```
public/js/
  vendor/                      ← new: the framework, byte-pinned
    frontload/dom.mjs          ← el, openDialog, useDocument
    frontload/tokens.mjs       ← resolveTheme, resolveSkin, makeAppearance
    designer/kit.mjs           ← panel, heading, forms, createStore,
                                 openDialog-wrapping helpers
  boot.mjs                     ← useDocument(document) once, makeAppearance
                                 wiring, sso ?wt redeem, router start
  api.js  state.js             ← transport + session cache (small, kept)
  markdown.js  icons.js        ← pure/leaf utilities (kept nearly verbatim)
  routes/
    feed.mjs       post.mjs    ← ONE module per page, each owning its
    composer.mjs   profile.mjs    render + its slice of FORM_HANDLERS
    notifications.mjs pages.mjs admin.mjs …
    _kit.mjs                   ← the app's shared kit consumers (role-
                                 button factory, empty-state composer,
                                 unread pill)
  desk/                        ← admin route children (split like routes)
tests/
  vendor-parity.test.mjs       ← ledger EXTENDED to the browser pins
```

Ledger invariant (extension of the existing pattern at
`tests/vendor-parity.test.mjs`): every vendored file gets a byte-pin line,
and the test fails on ANY vendored file not in the ledger — drift is
un-representable.

## 7. The wave plan

One **vertical slice** per wave: a member-visible surface re-expressed on the
kit, its route module owning the feature, suite green, committed to the
branch. No prod deploys at any point.

### Wave 1 — Vendor the framework (no behavior change)
Vendored: `frontload/dom.mjs`, `frontload/tokens.mjs`, `designer/kit.mjs`
into `public/js/vendor/` byte-identical from `/Users/itswempo/project-designer`;
parity ledger extended to the browser pins; `boot.mjs` wires `useDocument`,
`makeAppearance` (theme + skin resolution keeps today's key names and the
pre-paint shim contract); NO route code converts yet — `forms.js`/`dom.js`
keep working beside the vendor until their wave re-expresses them.

**Acceptance (PM-style).** *Story:* "As a member I open every page and see
the identical forum I know, in both themes and the square-corners mode."
*Edges:* theme-preload still paints before first frame (no flash); the
square-corners override still works; both themes token-identical;
`node --test tests/` 202+ green with the new parity pins enforced.

### Wave 2 — Feed vertical slice (the prove-it wave)
`routes/feed.js` re-expressed on `el()` + kit panels: home feed, category
boards, suggestions alias, `/mine`, search. First route where **empty states
become instructions** ("No posts yet — be the first" is a composer CTA, not
a shrug) and where the **unread system** shows its first surface.

**Acceptance.** *Story:* "As a member I browse boards, open the empty
categories and know exactly what to do next, and unread boards announce
themselves." *Edges:* guest door panel still renders via `renderHomeAccess`;
`?q=` search round-trips; `/suggestions` alias; pagination cursor behavior
unchanged; keyboard/`aria` parity with today.

### Wave 3 — Post thread slice
`routes/post.js` + the post half of `render.js` on `el()`; replies,
quotes, poll rendering; attachment lightbox STAYS a dialog (fast
confirmation class); report flow **leaves its dialog** for a task page
(`/posts/:id/report` — URL-addressable, the rethink's first dialog
retirement). Markdown rendering untouched.

**Acceptance.** *Story:* "As a member I read a thread with formatting,
quotes and polls intact, and reporting a post is a linkable page."
*Edges:* report page requires session; lightbox confirms on Esc +
backdrop; poll votes are one-surface actions; dead-quote and attachment
failures render the instruction empty state.

### Wave 4 — Composer (write path)
`routes/composer.js` on the kit with a store (`createStore`) for draft
state; limits module (`composer-limits.js`) unchanged; dialogs only for
"discard draft?" confirms.

**Acceptance.** *Story:* "As a member I start a post on any board, keep a
draft, and get the same guardrails as today." *Edges:* 4000-char /
attachment caps enforced client + server; draft survives route return;
submit-on-Enter vs Shift-Enter contract preserved.

### Wave 5 — Profile + the accounts-gated axe (decision point)
`routes/profile.js` + `profile-editor.js` on the kit (editor, avatar,
accent, CSS — app-specific, stays); the A1–A3 axe lands HERE if and only if
the accounts lane confirms Accounts' password + 2FA surfaces are live;
otherwise the surfaces are kit-re-expressed and the axe defers (recorded
in this doc's axe table, not silently).

**Acceptance.** *Story:* "As a member I edit my display identity on the
forum and manage my password and 2FA in Wempo Accounts."
*Edges:* css preview reflects live; accent picker round-trips; `PATCH`
error copy identical; blocks route rides the same kit pass.

### Wave 6 — Admin desk
`routes/admin.js` (504 L) → split per desk child (`reports, bans, appeals,
filter, media`); bulk actions stay task pages, not dialogs, except the
confirm-irreversible steps.

**Acceptance.** *Story:* "As an admin I work the desk exactly as today,
each desk section at its own URL." *Edges:* role gates identical; mod-log
audit trail unchanged; the chat-log desk page still reads
`gc_messages` source data without re-writing it.

### Wave 7 — Chrome + the unreads system (finale)
Header/mobile-bar chrome rebuilt on `el()` (today's `account-nav.js` DOM
probes `document.querySelector` for ids); the unread model unified across
bell, mobile bar, feed markers, and `/mine`; the confirm-dialog shell is
the last surviving dialog.

**Acceptance.** *Story:* "As a member the site tells me in one glance what
has my attention, everywhere." *Edges:* zero-unread renders nothing (no
junk chips); notifications read-all still works; mobile bar
`aria-current` contract preserved.

**Sequencing note:** waves 1–4 and 6 are forum-only; wave 5 has the
external dependency; wave 7 depends on wave 2's unread model existing.

## 8. Biggest structural risks found in the current code

1. **`dom.js` runs `document.querySelector` at import time** (module scope,
   lines 16–25). This is the deepest coupling: every importer assumes the
   shell exists before the module loads. The kit's `useDocument` injection
   (and `boot.mjs`) is the fix, but the conversion must be all-at-once per
   module, not gradual, or half of a route renders post-import while the
   other half pre-imports.
2. **`render.js` is a 594-line shared monolith** feeding both feed and post
   routes; waves 2–3 both cut into it. Ordering matters: the second wave in
   must not rebase over the first's cuts. (Wave 2 takes its slice, wave 3
   takes the rest — no shared uncommitted state between them.)
3. **`forms.js` vs `designer/kit` create-family drift**: the local twin and
   the vendor have already diverged in API details (kit enforces labels +
   `data-form` structurally; the local treats them as options). Any new
   form written against `forms.js` before conversion makes the eventual
   diff bigger — builders must not extend `forms.js` from wave 1 on.
4. **The report dialog is a form in a modal** (dialog shells in
   `index.html`, `dom.js` exports the dialog nodes directly) — the one
   live violation of the one-surface model; it must not gain features while
   it lives in a dialog.
5. **A2/A3 axe depends on an external lane.** Hiding TOTP/password UI
   before Accounts provides parity strands members mid-flow. Wave 5 is the
   only wave with an approval gate.
6. **`index.html` static dialog shells + mobile-bar ids** are load-bearing
   for `account-nav.js`'s id-keyed lookups; the wave-7 chrome rebuild must
   keep the ids until the last consumer drops them, or the mobile bar
   silently loses its active state.

## 9. Vendored-modules ledger

| Module | Source (project-designer) | Vendored to | Status |
| --- | --- | --- | --- |
| http | `vendor http module` | `api/vendor/http.mjs` | done, on main (phases 1–4) |
| db | `experience/db.mjs` lineage | `api/vendor/db.mjs` | done, on main (phases 1–4) |
| dom | `frontload/dom.mjs` (142 L) | `public/js/vendor/frontload/dom.mjs` | wave 1 |
| tokens | `frontload/tokens.mjs` (172 L) | `public/js/vendor/frontload/tokens.mjs` | wave 1 |
| kit | `designer/kit.mjs` (161 L) | `public/js/vendor/designer/kit.mjs` | wave 1 |

Byte-parity enforcement: extend `tests/vendor-parity.test.mjs`'s ledger
(every file pinned, coverage of every `.mjs` in the vendor tree enforced).
`experience/auth.mjs` is NOT vendored to the browser (server-side concern;
its forum consumption already lives in the worker core).

Rule: fix upstream → re-vendor with a new pin; never edit the vendored copy.
