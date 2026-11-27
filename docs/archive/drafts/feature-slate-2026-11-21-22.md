# Feature slate — wave 2026-11-21-22 (v4.27.0)

Theme: accessibility pass 2 (code-level) over the UI shipped v4.13–v4.26,
plus one small member feature. No migration. No new route. No server change.

## F1 — Accessibility pass 2

Audited `git diff 3d4c6c4..42117dd -- public/` (mod desk member tools, the
latest/first/my-reply jumps, reply fold, You/Author chips, profile extras,
wall formatting, QOTD, showcase gallery, grouped notifications, poll chips,
search highlight, settings filter + jump list, data export, newcomer/tips
cards, lightbox, gallery recents + sort, Show spoilers, Ctrl/Cmd+Enter).
Real gaps fixed, each with a test in `tests/wave22.test.mjs`:

1. Show spoilers hid itself under focus → focus moves to the first revealed
   spoiler (`public/js/reveal-spoilers.js`).
2. Image viewer: Next/Previous disabled at an end while focused → focus goes
   to the opposite step button, or Close (`public/js/lightbox.js`).
3. Mod desk restore + hide-recent repaint the route and dropped focus to
   `<body>` → `focusPageHeading(main)` lands on the h1
   (`public/js/focus-utils.js`, `public/js/routes/admin.js`).
4. Settings filter "no match" was a hidden node unhidden (never spoken) →
   also written to a `role=status` mounted empty (`public/js/settings-tools.js`).
5. Notifications marked unread with `aria-current="true"` (spoken as
   "current") → a visually-hidden "Unread" word starts the row's name, for
   single and grouped rows (`public/js/notifications.js`).
6. Gallery picker thumbs were `role=option` + `aria-pressed` (option ignores
   aria-pressed, so selection was never spoken) → plain toggle buttons in
   `role=group` grids (`public/index.html`, `public/js/routes/composer.js`).

Checked and fine: peek toggle (aria-expanded/controls), hide-recent confirm,
jumps (jumpToNode + reduced motion), poll "Your vote" is text (not color
only), `<mark>` hits, newcomer dismiss focus, copy-code status, motion
(all new animations under `prefers-reduced-motion: no-preference`), profile
heading is a `<section>`, no duplicate ids found in the new builders.

LOW (needs a browser to confirm, not changed):
- Showcase gallery tiles: image alt and caption carry the same title, so the
  link name repeats it.
- QOTD chip text "QOTD" is read letter by letter; its `title` is not
  reliably announced.
- Data export button is disabled while focused during the download (focus
  may drop in some browsers); `aria-disabled` would keep it.
- Gallery "slots exceeded" error goes to the page `role=alert`, which sits
  behind the modal picker and may not be announced.
- `<mark>` search hits are not announced as highlighted by most readers.

## F2 — Fold all replies

On a thread with 3+ replies, a "Fold all replies" toggle sits above the
replies (beside the latest/my-reply jumps).

- One press folds every top-level reply down to its author line; when every
  reply is already folded, a press unfolds them all.
- Each reply's own Fold toggle stays in sync; the bulk toggle's
  `aria-pressed` follows the cards (a manual unfold shows it unpressed).
- Cards are read at click time, so "Load older replies" stays covered.
- Label never changes; aria-pressed carries the state (v4.13 convention).
- Page view only: nothing stored, nothing sent; others see nothing.
- `public/js/reply-fold.js` (`createFoldAllToggle`), wired in
  `public/js/routes/post.js`.

Not shipped: a remembered fold state (would need storage per thread; the
per-reply fold is deliberately page-view only).

## Strings

`bell.unreadTag`, `post.foldAll`, `post.foldAllTitle` — en + all 20 locales.

## Tests

`tests/wave22.test.mjs` (13): spoiler focus, lightbox step focus (click +
key), focusPageHeading + admin wiring, settings status, notification unread
tag (single/grouped/read), gallery roles, fold-all gating/toggle/sync/wiring,
string parity. `tests/wave21-images.test.mjs` pin updated listbox → group.
