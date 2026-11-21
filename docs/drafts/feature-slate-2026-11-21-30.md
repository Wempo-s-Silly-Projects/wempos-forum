# Feature slate — wave 2026-11-21-30 (v4.35.0) — the composer

Not shipped before (checked against feature-slate-2026-11-21*.md): the
live counter and draft autosave (wave 2026-11-21 F1) existed; paste/drop,
a near-limit announcement and an edit-discard confirm did not.

## F1 — Paste or drop an image into a post/reply composer

- Paste on the textarea, drag/drop on the whole form (`public/js/composer-paste.js`).
- Pasted/dropped files are STAGED, not attached: a pending strip shows
  "N image(s) ready to attach: names. Nothing uploads until you attach and
  post." with **Attach** / **Dismiss**. Attach folds them into
  `form.composerFiles`, the same list the picker fills.
- One gate for every route in: `addComposerFiles` (attachments.js) now checks
  the type (`isComposerImageType`, mirrors `COMPOSER_ACCEPT`: JPEG/PNG/WebP/GIF)
  beside the existing 10 MiB and 3-file caps. Staging runs the gate as a
  preview (refusals show at once); Attach re-runs it.
- A paste carrying `text/plain` (rich copies) is left to the browser; text
  drags are not intercepted.
- Privacy: no network, storage or FormData in the module (source-pinned);
  bytes leave only on Post, through the existing multipart path. No new
  server route; the server still sniffs and sanitizes every image.

## F2 — Character counter: quiet until near the cap

- The visible "N chars left" count was an `aria-live` region, so screen
  readers heard every keystroke. It is now plain text; a visually hidden
  `role=status` announcer speaks once on entering the last 10% (475 of 4,750)
  and once at the cap, and clears below the band. Near-limit style
  (`.char-counter-near`). Applies to every `counter: true` textarea (post,
  reply, edit, wall).
- `COMPOSER_MAX_CHARS` pinned equal to the server's `MAX_COMPOSER_BODY_CHARS`
  (api/posts-write.mjs) by test.

## F3 — Edit composer: "Discard your changes?"

The inline edit form has no autosave; Cancel used to throw changed text away.
Cancel now asks (`window.confirm`, as in dm-extras/admin) only when the
textarea differs from the post's raw body (`editHasUnsavedChanges`).

## Strings

6 new keys (`attachments.wrongType`, `composer.pendingImages.one|other`,
`composer.pendingAttach`, `composer.pendingDismiss`,
`render.discardEditConfirm`) in en and all 20 locales.

## Tests

`tests/wave30-composer.test.mjs` (18): type/size/count rejection reuse,
type mirror, paste stages-not-attaches, text paste untouched, non-image
paste notice, dragover/drop, text drag, confirm through the cap + dismiss,
local-only source pin, wiring + preload + CSS, client/server cap parity,
counter bands, announce-once-per-band, prefilled near-limit, edit dirty
check, cancel-edit confirm pin, locale parity.

## Gates

No migration, no server change, no new storage key. Deploy follows the
normal push then `pnpm run deploy` order.
