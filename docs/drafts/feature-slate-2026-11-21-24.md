# Feature slate — wave 2026-11-21-24 (v4.29.0)

Theme: close the wave-23 LOWs (privacy first) plus one small member feature.
No migration. No new route. No server change.

## F1 — Wave-23 LOWs

### a. Sign-out wipe survives a failed logout (privacy)

`public/js/routes/account-nav.js` — the local wipe moved into
`wipeAccountLocalData()` and runs in a `finally` around the logout POST.
A network error or a 5xx still clears every account-scoped key family:

| Family | Key shape | Cleared by |
|---|---|---|
| Composer drafts | `forum-draft:[u<id>:]…` | `clearAllDrafts` (drafts.js) |
| Catch-up read marks | `forum-seen-replies[:u<id>]` | `clearAllCatchUp` (catch-up.js) |
| Chat pins | `forum-chat-pins[:u<id>]` | `clearAllPins` (chat-pins.js) |
| Gallery recents | `forum-gallery-recents:u<id>` | `clearAllRecents` (gallery-picks.js) |
| Newcomer dismissals | `forum-newcomer-dismissed:u<id>` | `clearAllNewcomer` (newcomer.js) |

Device preferences stay (theme, text size, locale, corners, DM effects).
The error still propagates to `handleClick`'s status line, and the browser
does not redirect to the Accounts sign-out land on failure (no fake success).
Test: `tests/wave24-logout-wipe.test.mjs` drives the real `ACTIONS.logout`
with `fetch` rejecting (TypeError) and answering 503, plus a success control.

### b. Wall renders per block

`public/js/wall.js` — wall bodies now go through `renderBodyBlocks`
(`renderWallBody`), the same per-block renderer `maskSpoilers` mirrors, so a
`||` split across a paragraph and a list renders exactly the spoilers the
mask hides. Wall posts gain lists/quotes/headings/code blocks like posts.
CSS: `.wall-post-body .post-body` keeps paragraph spacing tight.

### c. Lightbox skips imageless thumbnails

`public/js/lightbox.js` — the strip is filtered to thumbnails holding an
`<img>`; stepping skips the gap, and clicking an imageless thumbnail never
opens the viewer on the previous image.

### d. Fold all on long, paged threads

`public/js/routes/post.js` — the first render gates on
`knownReplyTotal(post)` (loaded replies + 1 when an older page exists; the
detail payload carries no total). `ensureFoldAllToggle` (reply-fold.js)
adds the toggle after "Load older replies" once the list passes the
threshold; idempotent.

## F2 — Quote what you selected (members)

Select part of a reply, press Quote: only that part is quoted.
`public/js/quote-selection.js` `selectedQuoteText(selection, card)`:

- counts only text inside this card's own body blocks (not its header, a
  nested sub-reply or another card);
- masks every spoiler (revealed or not), including a selection that sits
  wholly inside one; skips buttons (Copy);
- otherwise returns "" and Quote uses the masked snippet as before.

Same 120-char single-line prefill. Read from the page only: nothing stored,
nothing sent.

## Strings

1 key x 21 locales: `render.quoteTitle` (Quote button tooltip).

## Tests

- `tests/wave24-logout-wipe.test.mjs` (3)
- `tests/wave24-fixes.test.mjs` (6)
- `tests/wave24-quote-selection.test.mjs` (6)
- Updated on purpose: wave13 wall pin (block renderer), wave22 fold-all
  pin (`knownReplyTotal`).
