# Feature slate — wave 2026-11-21-8 (v4.13.0)

Three lanes: make the test fake DOM honest, close three accessibility LOWs,
and one small forum-side feature. All client-only. There is no migration,
nothing new goes over the network, and nothing new is stored.

## F1 — Realistic fake-DOM collections

Problem: copy-link.js shipped in v4.9.0 calling `children.find` on an
HTMLCollection. It threw in browsers but passed tests, because four suites each
carried their own fake whose `.children` was a plain array.

- One shared `tests/helpers/fake-dom.mjs` replaces the four inline fakes.
  `.children` and `getElementsBy*` return a live HTMLCollection (indexed,
  `length`, `item()`, iterable, no `forEach`/`map`/`find`). `.childNodes` and
  `querySelectorAll` return a NodeList (adds `forEach`/`entries`/`keys`/`values`,
  still no `map`/`find`/`filter`). Text nodes are not elements.
- Real browser bug found: `public/js/render.js:570`. The edit swap's
  `isEditBodyBlock` checked `Array.isArray(node.children)` (always false on an
  HTMLCollection) and the old `post-list` class (renamed to `md-list` in
  ebaccc5). Result: editing a post left its markdown lists visible under the
  edit form. Fixed and pinned by a test.
- Latent: `public/js/thread-starter.js:53`. Its fallback called `.some` on
  `row.children`. Browsers never reach it (rows have `querySelector`), but it
  now uses `Array.from`.
- Test-side, 1:1: six assertions that called `.find`/`.includes` on
  `.children` now wrap in `Array.from(...)`. They assert the same things.

## F2 — Accessibility LOWs

- a. Pins full: the disabled pin button's reason used to live only in `title`.
  It is now a visible note (`.chat-widget-pin-note`) tied by `aria-describedby`.
- b. Pin toggle: the label stays "Pin chat" and `aria-pressed` carries the
  state. A CSS check mark (empty alt text) shows the pressed state visually.
  `dm.unpinChat` is removed from all 21 tables.
- c. Mention textarea: `aria-expanded` is gone, because ARIA 1.2 does not
  allow it on role textbox (MDN aria-expanded "Used in roles", fetched
  2026-11-21: textbox absent). `aria-haspopup="listbox"` replaces it (allowed
  on textbox per MDN aria-haspopup, same date). `aria-controls`,
  `aria-activedescendant` and the listbox popup are unchanged, and there is
  no combobox role.

## F3 — J/K post navigation

On a thread page, **J** moves keyboard focus to the next post and **K** to the
previous one, in reading order including sub-replies. It does not wrap.

- Why: power readers on long threads want to skim post by post without
  tabbing through every reaction and action button.
- Safe by design: it fires only while focus is already inside the thread (the
  WCAG 2.1.4 "active only on focus" exception). It never fires while typing, with
  a modifier key, or during IME composition. It uses the existing `jumpToNode`,
  so reduced motion is honored.
- Discoverable: a one-line hint (`post.keysHint`, en + 20 locales) under
  "Replies" on threads that have replies.
- Where: `public/js/post-keys.js`, wired in `routes/post.js`. Listeners sit on
  the root card and the reply list, which are rebuilt each render, so they
  never pile up.
- Rejected alternative: a document-level listener. It would fire on every
  route and while focus sits on `<body>`, and that fails 2.1.4 for
  speech-input users.
