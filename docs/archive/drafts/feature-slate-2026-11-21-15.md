# Feature slate — wave 2026-11-21-15 (v4.20.0)

One hardening fix from the v4.17–v4.19 review and one small member
feature. No migration, no new route, nothing new stored, no new tracking.

## F1 — Hardening review of v4.17–v4.19 (2c49aff..daba38a)

Checked: `api/profile-threads.mjs` (public + ban + block, LIMIT 5),
`joinedAt` (rides the already-gated profile payload), `api/traditions.mjs`
(QOTD LIMIT 1; gallery LIMIT 24, approved + unrevoked images on public,
unbanned, unblocked roots only; covers via the anonymous
`attachmentRowsForView`), wall `parseInline` (http/https/same-origin links
only, `//` refused; mentions are `[A-Za-z0-9_]` same-origin anchors;
spoilers click-to-reveal), reply-fold, first-post / latest-reply jumps,
chat-pins account gating, read-aloud ticket, post-keys case logic,
modulepreload list (every href exists). Public-read rate limits: the
feed/profile/wall GET peers carry none, so none were added.

**Fixed (MEDIUM): spoiler masking diverged from the renderer.**
`maskSpoilers` paired `||` across the whole body with one regex; the post
renderer parses block by block (list items and quote lines singly, code
fences never) and lets code/bold/link spans take precedence. A `||` inside
code (``a || b``, a fenced shell line) or bold could steal a real spoiler's
opener, leaving the spoiler's words bare in raw-text surfaces: recent-thread
excerpts, the QOTD banner, gallery captions, reply previews, parent context
and read-aloud. Now `parseInline` reports the spans it renders as spoilers
and `maskSpoilers` masks exactly those, per rendered inline run
(`public/js/markdown.js`). Truncation after masking was already safe.

## F2 — Jump to my reply

On a thread page, when the signed-in member has a reply among the loaded
replies, a quiet **Jump to my reply** button sits beside "Jump to the latest
reply". It moves focus and the view to their newest top-level reply (the
card with the "You" chip), looked up at click time so it stays right after
older replies load. Client-only (`createMyReplyJump`,
`public/js/latest-reply.js`): no request, no storage. Guests never see it.

## Strings

1 new key (`post.myReply`) in en.json and all 20 locales, real translations.

## Tests

`tests/wave15.test.mjs` (5): five leaky bodies (inline code, fence, bold,
list, quote) never expose spoiler text via `maskSpoilers` or
`threadExcerpt`; unchanged outputs for plain spoilers, lists and fences;
my-reply jump gating and click focus; wiring/CSS/no-storage pins; locale
parity.
