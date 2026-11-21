# Feature slate — wave 2026-11-21-20 (v4.25.0)

Theme: newcomers. Two small, dismissible client-side cards on the signed-in
home feed. No migration. No new route. One additive session field.

Not re-shipped: board descriptions already show on every category page
(`public/js/routes/feed.js` renderCategoryRoute, `board.blurb`, v3.1).

## F1 — Welcome card for new accounts

Shown when the account is under 7 days old (`NEWCOMER_WINDOW_MS`). Heading
"Welcome in, {name}!", a warm line, three starter links (General to say hi,
Showcase, house rules) and a nudge to say hello. "Got it" hides it for good.

Server: `readSession` (api/core/auth.mjs) also selects `u.created_at` and the
session user gains `joinedAt` (ISO, or null). Same value the member's public
profile already shows (`api/profiles.mjs` joinedAt); only the member's own
`GET /api/session` returns the session user, so nothing new reaches anyone else.

## F2 — "New tricks to try" tips card

Four tips from tonight's releases: spoilers `||like this||`, Ctrl/Cmd+Enter
to post, J/K between posts, pinned chats. Shown to every signed-in member
until dismissed. The card id carries its tip-set date (`tips-2026-11-21`),
so a future tip set reappears once.

## Behaviour and accessibility

- One card at a time: welcome first, then tips. Dismissing swaps in the next
  card and moves focus to its heading (tabindex=-1); after the last card a
  short `role="status"` line takes focus, so focus never falls to `<body>`.
  The first paint never steals focus.
- Each card is a `<section aria-labelledby>` with an `<h2>`; the dismiss
  button has its own `aria-label` ("Hide the welcome card" / "Hide the tips
  card"); links are `data-app-link` anchors.
- Fade-in only under `prefers-reduced-motion: no-preference` (plus the
  global reduce guard). Tokens only, so both themes follow.

## Privacy

- localStorage key `forum-newcomer-dismissed:u<accountId>` → `{cardId: ms}`.
  Signed-in only (no guest key). Never sent anywhere; no tracking.
- Sign-out wipes every `forum-newcomer-dismissed:*` key
  (`clearAllNewcomer`, routes/account-nav.js logout), alongside drafts,
  read marks and chat pins.
- Blocked/private storage: cards still show and dismiss for the visit.

## Strings

16 `newcomer.*` keys — en + all 20 locales.

## Tests

tests/wave20-newcomer.test.mjs (11): per-account scoping, immutable
dismissal map, broken/blocked storage, scoped sign-out wipe, 7-day window,
card order, fake-DOM render/dismiss/focus flow, older account + guest,
blocked-storage render, session `joinedAt`, home-mount/sign-out/no-network pins.
