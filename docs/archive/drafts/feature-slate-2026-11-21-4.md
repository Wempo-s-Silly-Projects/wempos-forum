# Feature slate — wave 2026-11-21-4 (release v4.9.0, hardening + reader tools)

Through-line: **tighten what shipped tonight, then two small reader-side
comforts** — both client-only, opt-in per click or per choice, nothing new
stored on the server, no migration.

Laws every feature rides: vanilla ES modules + 17-line AGPLv3 header on new
files; createElement/textContent only; no new network calls; `api/vendor/**`
untouched; every painted string keyed in `public/locales/*.json` (21 tables,
real translations).

Not duplicated (already shipped): drafts, mention autocomplete, catch-up
markers, thread at a glance, group DMs, DM images, message effects, spoilers,
live preview, language picker, quote-reply.

## F1 — Hardening of v4.5–v4.8

- Composer drafts were keyed by composer + thread only. On a shared browser
  the next member to sign in saw the previous member's unsent text restored.
  Drafts are now keyed per account and wiped on sign-out.
- The group key of `GET /api/dm/threads` had no LIMIT, and anyone can add a
  member to a group without consent, so a griefer could grow another
  member's polled response without bound. It is now the newest 50 groups,
  with member rows loaded only for those.

## F2 — UNIQUE: Copy link on every post and reply

A quiet chain-link icon button beside "open post" copies the card's
absolute `/posts/<id>` link to the clipboard and says "Link copied" in a
polite status for two seconds (or "Couldn't copy the link" when the browser
refuses).
Why: a small community shares individual replies constantly ("look what
she said here"). Today that takes opening the post and copying the address
bar, and on phones even that is fiddly. Harmless: it only writes to the
member's own clipboard, ids are numeric-validated before they form a link,
and nothing is sent anywhere.
Acceptance (RED first): permalink built from numeric ids only; click writes
it and paints a role=status node that clears itself; a missing or refusing
clipboard shows the failure status; render.js mounts the button on every
card.

## F3 — UNIQUE: Reader text size (Default / Large / Larger)

A new Appearance panel in account settings holds a Text size picker. The
choice sets `data-text-size` on `<html>` (112.5% / 125% root size). Every
style is rem-based, so the whole forum scales. It is stored only in this
browser and applied before paint by `theme-preload.js`, so there is no
flash. The panel also restores the square-corners checkbox, which was
built but never mounted.
Why: a warm community includes members with tired or older eyes, and
browser zoom also scales the layout chrome and breaks the mobile bar. A
forum-level text size is a gentle, explicit accessibility comfort, opt-in
and default-off.
Acceptance (RED first): only the three sizes are accepted, anything else is
Default; blocked storage gives Default; the picker reflects the stored
choice, and a change stores and applies it; the preload and CSS rules exist;
feed.js mounts the picker in the Appearance panel.

## Release
v4.9.0 (wrangler.toml production VERSION + package.json). No migration.
Notes: `.team/release-4.9.0.md` (≤4500 chars, member-facing).
