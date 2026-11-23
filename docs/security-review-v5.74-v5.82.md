# Security review — v5.73.1..4907b53 (wave 5.82.1)

Scope: `git diff v5.73.1 4907b53` (v5.73.2 through the v5.82.0 merge).
Server: 39 files under api/, worker.mjs, constants.mjs and migrations/
(2009 insertions, 313 deletions). Client: 103 first-party files under
public/js/ (7596 insertions), public/sw.js (new), public/index.html, 164 new
vendored files under public/js/vendor/, 44 test files.

Findings: 0 CRITICAL, 0 HIGH, 1 MEDIUM (M1, lead-gated), 2 LOW (L1 fixed,
L2 lead-gated), 4 INFO. RED-first pins for L1 and regression pins for the
checks that pass are in tests/wave5821-security-review.test.mjs; most
priority-1 surfaces were already pinned by their own wave tests
(batchf-altcha, batchf-passkeys, batchf-totp-upgrade, batchl-link-preview,
wave576-web-vitals, anubis-gate, relay, request-hardening), which were read
and are green at this SHA.

| ID | Severity | Where | Status |
|----|----------|-------|--------|
| M1 | MEDIUM | api/core/human-check.mjs:48, constants.mjs:136, api/core/anubis-gate.mjs:69 | Lead-gated (owner-ordered default); production pinned to altcha |
| L1 | LOW | public/js/vendor/picmo.js:830,885 via public/js/emoji-picker.js | Fixed in v5.82.1 |
| L2 | LOW | api/link-preview.mjs:185-186 | Lead-gated (accepted residual) |
| I1 | INFO | api/core/http.mjs:97-103 | Pinned-pass (no 'unsafe-*') |
| I2 | INFO | api/core/human-check.mjs:118 | Pinned-pass (self-host design since v5.17) |
| I3 | INFO | api/passkeys.mjs (signInVerify) | Pinned-pass (by design) |
| I4 | INFO | tests/** (range) | Pinned-pass (loosened only with owner approval) |

## M1 — MEDIUM — an unset or unknown HUMAN_CHECK runs no human check (lead-gated)

- Where: `humanCheckMode` (api/core/human-check.mjs:48) maps unset, empty
  and unknown values to `DEFAULT_HUMAN_CHECK_MODE` = `anubis`
  (constants.mjs:136). In anubis mode `requireHumanCheck` returns at once
  (human-check.mjs:116), and `anubisGate` returns null both with no ANUBIS
  binding and with one (anubis-gate.mjs:69, the forward-auth TODO).
- Failure scenario: a self-hoster deploys from a toml without
  `HUMAN_CHECK` (or with a typo such as `"altcah"`), configures
  `ALTCHA_HMAC_KEY`, and expects signup, login, posts and replies to ask for
  proof. None does: the unset/unknown value fails open to a mode whose gate
  is not built yet. The brief asks that unknown/empty fail closed to a real
  check.
- Not live: production pins `HUMAN_CHECK = "altcha"` (wrangler.toml:22,
  pinned by tests/anubis-gate.test.mjs and the new review pin).
- Why not changed: the anubis default for unset/unrecognised is an owner
  order (constants.mjs:129-136) and pinned by tests/anubis-gate.test.mjs:43
  and :49. Suggested fix for the lead/owner: resolve the effective mode to
  `altcha` whenever the resolved mode is `anubis` but `env.ANUBIS` is
  unbound (or until the forward-auth call is implemented), so an
  unconnected Anubis never means "no check".

## L1 — LOW — emoji recents survived sign-out (fixed)

- Where: the vendored picmo picker's default recents provider writes the
  member's recently used emoji to the unscoped localStorage key
  `PicMo:recents` (public/js/vendor/picmo.js:830, :885). public/js/emoji-picker.js
  passed no `recentsProvider`, so the default applied.
- Failure scenario: on a shared browser, member A signs out; member B opens
  the emoji picker and sees A's recently used emoji. The storage-wipe sweep
  (tests/wave27-storage-wipe-sweep.test.mjs) skips vendor/ by design, so it
  could not see the write.
- Fix: emoji-picker.js exports `PICMO_RECENTS_KEY` and
  `clearAllEmojiRecents(storage)`; `wipeAccountLocalData()`
  (public/js/routes/account-nav.js) calls it. The recents feature is kept.
  tests/wave56-prefs-survive.test.mjs `REMOVAL_FILES` gains emoji-picker.js
  (list extended, not loosened).
- Pins: three L1 tests in tests/wave5821-security-review.test.mjs (key
  matches the vendored constant; removal touches only that key and never
  throws; the wipe imports and calls it). RED before the fix (missing
  export), green after.

## L2 — LOW — link-preview DNS check and fetch resolve separately (lead-gated)

- Where: `guardedFetch` checks every A/AAAA address via DoH
  (api/link-preview.mjs:185) and then fetches by hostname (:186), so the
  Worker's own resolution is a second lookup.
- Failure scenario: a hostile name with a 0-second TTL answers a public
  address to the DoH check and a private one to the fetch (classic DNS
  rebinding, single hop). Redirect-based rebinding is already refused per hop
  (batchl-link-preview pins).
- Residual accepted: Cloudflare's fetch cannot reach private networks or
  link-local metadata from a Worker; https-only, default port, no
  credentials, size/time caps and image-free output all hold. Closing it
  fully needs fetch-by-IP with SNI, which Workers do not offer. No change.

## INFO

- I1 — CSP widenings since v5.73.1 (api/core/http.mjs:97-103): frame-src
  `https://www.youtube-nocookie.com` (iframe only after play), `blob:` on
  img/media/connect (hls.js, model-viewer), one style hash for WaveSurfer.
  Turnstile's origin left the policy. No `'unsafe-*'`, no wildcard: pinned on
  documents and JSON.
- I2 — altcha mode with no `ALTCHA_HMAC_KEY` and no `TURNSTILE_SECRET` runs no
  check (human-check.mjs:118); the same self-host contract Turnstile had
  since v5.17. The shell then announces no check (`humanCheckConfigured`).
- I3 — a passkey sign-in skips the TOTP step: passkeys are discoverable and
  `userVerification: "required"` (device PIN/biometric), so the ceremony is
  itself multi-factor. Registration needs a current-password re-proof.
- I4 — test edits in the range that relaxed an old assertion are all tied to
  owner-approved changes: Turnstile tests removed with Turnstile (Batch F);
  CSP tests rewritten for the retired origin; the gitleaks `paths`
  allow-list admits exactly `^public/js/vendor/mermaid\.min\.js$`
  (v5.79, owner-approved, pinned to that single value).

## Checks that pass (priority order)

1. Server routes (every hunk read):
   - TOTP: `totpMatchStep` returns the matched step; `claimTotpStep`
     (api/twofa.mjs) is a guarded upsert (`excluded.last_step >
     last_step`), so a code and any older step are single-use; ±1 window;
     limiter `totp`. Recovery codes: 50-bit base32, hashed, single-use.
     `equalConstantTime` (api/core/crypto.mjs) pads to equal length,
     uses `timingSafeEqual` when present, and still refuses unequal lengths.
   - Passkeys (api/passkeys.mjs): challenge stored as SHA-256, bound to
     purpose + session hash (+ user for registration), claimed by one
     guarded DELETE with expiry before verification; rpID = request host,
     origin = request origin; counter verified by @simplewebauthn/server and
     stored; userHandle must match the row owner; CSRF + login limiter on
     sign-in, password re-proof + totp limiter on registration; banned
     members refused atomically by `createSession`; delete is own-only.
   - ALTCHA (api/core/human-check.mjs, api/altcha.mjs): key from env only
     (`ALTCHA_HMAC_KEY`, or HKDF from `TURNSTILE_SECRET`); payload ≤ 2048;
     `verifySolution(..., checkExpires=true)`; spent signatures recorded in
     `altcha_spent` with `ON CONFLICT DO NOTHING` + `changes === 1`, so a
     replay is refused; challenge endpoint read-limited, no key material.
   - anubisGate: reads only `Accept`; no client header or cookie can bypass
     (there is nothing to bypass yet — see M1).
   - Link preview: https only, no userinfo/port, every resolved address
     public unicast (ipaddr.js `range() === "unicast"`, mapped v4 folded),
     manual redirects re-checked per hop (≤ 3), one timeout, text/html only,
     512 KiB cap, uniform `{ ok: false }`, signed-in + not banned + two
     limiter tiers, cache keyed by URL with no member id.
   - Profile CSS: css-tree parse, allow-list regeneration, same-origin
     `url()` only, escapes tokenised (no `u\72l(` / `@\69mport` bypass),
     clean re-parse or nothing; served as `text/css` + nosniff from
     `/api/users/:id/profile.css` (a `<link>`, so no `</style>` breakout).
   - Profile header: fixed key list (`PROFILE_HEADER_STYLES` + DB CHECK),
     requireUser (CSRF), not banned, write limiter.
   - Vitals: no session/IP/UA stored, exact-shape validation, route names
     from the router, column names from a fixed list, same-origin gate,
     always 204, read limiter scope; site-health staff only.
   - Export: new `uploads` section is `WHERE created_by = ?` for the caller,
     ids + mime only.
   - Relay: comment-only change; 403 unauthenticated (pinned).
   - auth.mjs: ban network key is the IPv6 /64 (legacy full-address hash
     still checked, 3 binds); Fetch Metadata refuses cross-site/same-site
     writes before the Origin check.
   - http.mjs: `readJson` requires exactly application/json (UTF-8) and
     refuses `__proto__`/`constructor.prototype` keys (secure-json-parse);
     other JSON parsers (mcp, rules, filterstore, profiles) switched to
     `parseJsonSafely`.
   - images.mjs: upload must agree on sniffed MIME and `file-type` detection
     before sanitising; dimensions stored by hash only.
   - All new SQL uses positional `?` binds; max new statement binds = 7
     (passkey insert) — far under `D1_MAX_BOUND_PARAMS`; new list reads carry
     LIMIT (vitals 1000) or are per-user. No visibility-law surface changed
     (chat, DM, post and reply diffs are body normalisation and the human
     check only).
2. Migrations 0079, 0080, 0081, 0084, 0087: every statement is
   `CREATE TABLE|INDEX IF NOT EXISTS` (pinned per statement). Passkey public
   keys, challenge hashes and spent-signature hashes are never selected by a
   `SELECT *` route (the only `SELECT *` uses are wrapped sub-selects in
   posts-feed, automod and dm-groups, untouched by these tables).
3. Client HTML sinks (grep-swept across the first-party diff): no
   `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`srcdoc`/
   `new Function`/`eval`/`on*` attributes added. Library HTML goes through
   DOMPurify to a fragment (sanitize.js); Mermaid runs `securityLevel:
   "strict"` with locked `secure` keys and its styles land in the diagram's
   shadow root; ansi_up escapes HTML and drops links; embed URLs pass
   `isSafeLinkUrl` and off-origin media stays a plain link; the link-preview
   href is the server-checked https URL.
4. CSP / index.html / sw.js: see I1; sw.js never intercepts `/api/` or
   non-GET, serves navigations network-first (offline page only on failure),
   and caches only static paths whose response is not HTML, not `no-store`
   and not `private` (pinned).
5. Storage keys: first-party additions are covered by the existing sweep
   (drafts moved to IndexedDB and `clearAllDrafts` clears it; fun extras
   and recent searches registered); the one vendor-written key is L1.
6. Vendored additions (164 files): every file is covered by REUSE.toml (a
   specific entry, or the `public/js/vendor/**` block); licenses are MIT,
   ISC, Apache-2.0, BSD-2/3, MPL-2.0 OR Apache-2.0, GPL-3.0-only (typeit) and
   CC BY 4.0 (EFF wordlist) — all AGPLv3-compatible, texts in LICENSES/.
   Not edited.
7. Tests: see I4.
8. AGPL headers: tests/license-headers.test.mjs green at this SHA.

## Not reviewed (time-box)

- Priority 3 was a grep sweep of the first-party diff, not a line-by-line
  read of each listed module (markdown.js, render.js, rich-paste.js,
  quote-card.js, profile-header.js, reader-safety.js, totp-qr.js were
  covered only by the sink grep and their existing pins).
