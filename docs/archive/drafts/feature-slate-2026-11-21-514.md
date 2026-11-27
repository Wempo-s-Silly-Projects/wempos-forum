# Feature slate 2026-11-21-514 (wave 5.14, v5.14.0)

Area: account security UX + the image viewer. Checked against every
`docs/archive/drafts/feature-slate-*.md`: earlier 2FA work was setup/disable (v4.0.1)
and backup-code generation (v4.8.1); earlier viewer work was step-through,
counter, focus hand-off and imageless-thumb skip (waves 21/22/24). Nothing
below repeats them. No migration.

## F1 — Backup codes left (unique)

- What: with two-factor on, the Backup codes panel says "You have N unused
  backup codes." and, at 3 or fewer, warns to make a new set; at 0 it says
  none are left.
- Why: codes burn one by one at sign-in/disable and the member never learns
  how many remain until the last one is gone.
- Server: new `api/account-security.mjs`, `GET /api/me/security` →
  `{ totpEnabled, backupCodesLeft, otherSessions }` — `requireSignedInRead`
  (own account only), `rateLimit("read")`. Counts only: never a code, hash,
  secret or token. `backupCodesLeft` is 0 when 2FA is off.
- Client: `public/js/routes/twofa.js` fills a `.backup-codes-left` note in the
  ON branch's backup panel from the shared settings read (`public/js/account-security.js`).
- Tests: `tests/wave514-account-security.test.mjs` — anon 401, counts own codes
  only (another member's codes not counted), 0 when 2FA off, payload carries
  no secret/hash/token keys; DOM: note text for 5, low warning at 2, none at 0.

## F2 — Sign out my other devices (unique)

- What: the account settings show "Signed in on N other devices or browsers
  on this forum." with a "Sign out everywhere else" button; this device stays
  signed in.
- Why: changing the password already does this silently; there was no way to
  end a forgotten library/phone session without changing the password.
- Server: `POST /api/me/sessions/sign-out-others` in `api/account-security.mjs`
  — `requireUser` (Origin + CSRF) → `rateLimit("write", user)` → one
  `DELETE FROM sessions WHERE user_id = ? AND token_hash != ?` → `{ signedOut: n }`.
  Count read in F1's route (unexpired, not this session). Forum sessions only:
  the Wempo Accounts relay, SSO redeem and cookie contract are untouched.
- Client: `public/js/account-security.js` panel + `sessions-sign-out-others`
  action; mounted from `public/js/routes/feed.js` after the 2FA section.
- Tests: anon/no-CSRF refused, deletes only the caller's OTHER sessions
  (current survives, another member's sessions survive, guest rows survive),
  count goes to 0; DOM: count text, button hidden at 0.

## F3 — Actual size in the image viewer (unique)

- What: an "Actual size" button in the image viewer switches the image
  between fit-to-screen and its real pixel size (scrollable); it resets to
  fit when stepping to another image or closing. `aria-pressed` reflects it.
- Why: screenshots with small text are unreadable when shrunk to fit a phone.
- Client only: `public/js/lightbox.js` (button + `data-size` on the dialog),
  `public/styles.css` (`.attachment-lightbox[data-size="actual"]`). Page-view
  only: no storage, no network.
- Tests: toggle sets/clears `data-size` + `aria-pressed`, step and close reset
  to fit, source pin: no storage/api.

Strings: `account.*` keys + `lightbox.actualSize` in en.json and all 41 locales.
