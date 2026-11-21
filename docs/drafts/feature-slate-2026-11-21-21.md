# Feature slate — wave 2026-11-21-21 (v4.26.0)

Theme: images and the gallery. Three small client-side improvements. No
migration. No new route. No server change.

Not shipped (and why):
- Alt text at upload: `attachments` and `gifs` carry no description column,
  so storing one needs a migration (out of bounds for this wave). Parked.
- Gallery search: library rows have no name or tags (`api/gifs.mjs`
  handleGifListRoute returns id/url/useCount only), so there is nothing to
  search. Sort (F3) covers the browsing need instead.
- A basic click-to-expand lightbox already existed (micro-batch); F1 extends
  it rather than re-shipping it.

## F1 — Image viewer: step through a post's images

`public/js/lightbox.js` drives the existing native `#attachment-lightbox`
`<dialog>` (showModal → the page behind is inert; Escape is native).

- Close button (×), previous/next buttons (‹ ›), and an "Image 2 of 3"
  counter (`aria-live="polite"`). Single-image posts hide steps and counter.
- ArrowLeft/ArrowRight/Home/End step within the SAME post's strip; ends
  clamp (buttons disable); right-to-left pages mirror the arrows and glyphs.
- Focus starts on the close button; on close it returns to the thumbnail of
  the image last shown (not just the one first clicked).
- Backdrop or image click still closes; clicks on the controls do not.
- Fade-in only under `prefers-reduced-motion: no-preference`.
- Visibility: the viewer only walks `.attachment-expand` buttons already
  rendered in that strip, with their own versioned URLs. No new fetch path.

## F2 — Gallery "Recently used" row

The composer's Gallery picker shows this member's last 8 inserted library
images in their own row above the full list.

- localStorage `forum-gallery-recents:u<accountId>` (id list). Local-only,
  never sent anywhere; nothing read/written until the account is known.
- Shown only when the id is ALSO in the current approved `/api/gifs` list, so
  a rejected or revoked image never resurfaces from recents.
- Sign-out wipes every `forum-gallery-recents:*` key (`clearAllRecents`,
  routes/account-nav.js logout) with drafts, read marks, pins, newcomer cards.
- Selection spans both rows; the spare-slot cap counts both.

## F3 — Gallery sort

"Sort: Newest / Most used" select in the picker. Newest keeps the server's
order; Most used orders by `useCount` (stable: ties stay newest-first).
Changing it repaints and keeps current selections.

## Strings

7 keys (`lightbox.previous|next|counter`, `shell.galleryRecent|Sort|SortNewest|SortPopular`) — en + all 20 locales.

## Tests

tests/wave21-images.test.mjs (16): stepIndex (clamp, Home/End, rtl), strip
scoping, fake-DOM open/step/close flow incl. focus return and backdrop rules,
recents scoping/junk/blocked storage, rememberRecents order/cap/immutability,
arrangeGallery visibility filter + sort stability, scoped wipe, wiring pins,
21-locale parity with placeholders.
