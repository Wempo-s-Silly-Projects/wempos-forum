# Feature slate — wave 2026-11-21 (release v4.5.0)

Through-line: **make writing and catching up feel effortless** — two community
asks for the composer, two features members won't have seen on a forum before.
All four are client-only: no schema change, no new endpoint, no new dependency.

Laws every feature rides: vanilla ES modules + 17-line AGPLv3 header on new
files; createElement/textContent only (no innerHTML); fetch only through the
one `api()` wrapper; every `localStorage` touch wrapped in try/catch (private
windows / blocked storage must not break the page); defaults law (nothing
network-facing is default-on; local-only conveniences are fine); visibility
law (features only read data the server already shaped for this viewer);
pure helpers exported and unit-tested in node, DOM wiring pinned statically.

Considered and deferred: group DMs / DM images (owner roadmap, migration now
allowed) — the DM UI lives in `public/js/chat-widget.js`, owned by another lane
this wave; it's the first candidate for the next wave. Changelog page — the
Updates category (`/c/updates`) already is that page.

## F1 — Composer draft autosave (community ask)
Identity: whatever you type in a post or reply composer survives a refresh,
a crash, or navigating away, per thread. Module `public/js/drafts.js`.
- Key: `forum-draft:<form>:<postId|new>`; value `{ body, savedAt }`.
- Saved on input (debounced), restored when the composer is built, cleared
  after a successful submit. Drafts older than 7 days are ignored and removed.
- Storage failures are swallowed into a no-op (typing never breaks).
Acceptance: helpers save/load/clear round-trip on a fake storage; a throwing
storage returns null and never throws; stale drafts read as null; composer.js
calls restore on build and clear after both submits.

## F2 — @mention autocomplete (community ask)
Identity: type `@` plus a letter in any composer and pick a member from a
suggestion list — keyboard (Up/Down/Enter/Tab/Escape) or mouse. Module
`public/js/mention-picker.js`. Uses the existing `GET /api/search` member
results (already block-filtered server-side), debounced, max 6 suggestions.
- Token rule mirrors the server's MENTION_SCAN_PATTERN: `@` at start or after
  a non-word char, handle `[a-zA-Z0-9_]`.
- Ranking: prefix matches first, then substring, alphabetical; bio-only hits
  dropped.
- ARIA: textarea gets `aria-autocomplete="list"`, `aria-controls`,
  `aria-expanded`, `aria-activedescendant`; the list is `role="listbox"`.
Acceptance: `mentionQueryAt` finds/rejects tokens (email-shaped text is not a
mention); `applyMention` replaces the token and appends a space; ranking
pinned; picker wired into createComposer.

## F3 — "New since your last visit" (unique)
Identity: come back to a thread and the replies posted since you last read it
glow with a **New** chip, a divider marks where you left off, and a
"Jump to N new replies" button takes you there. Purely local memory — the
server never learns what you've read. Module `public/js/catch-up.js`.
- Stores the highest reply id seen per thread, capped at 300 threads (oldest
  dropped). First visit marks nothing.
Acceptance: `newReplyIds` returns only ids above the mark; `recordSeen` is
immutable, keeps the max, and evicts beyond the cap; storage failure = no
markers, no errors; wired in routes/post.js.

## F4 — Thread at a glance (unique)
Identity: a compact strip above the replies — how many people are talking,
an estimated read time, and a "Top reply" jump to the most-liked reply.
Module `public/js/thread-glance.js`, computed from the replies already on
the page (no extra request).
- Read time at 220 words/minute, minimum 1 min. Top reply needs ≥ 2 likes.
Acceptance: `summarizeThread` counts unique participants (root author
included), read time, and top reply (ties → earliest); no top reply under
the threshold; wired in routes/post.js.

## Release
Last commit bumps production VERSION + package.json to 4.5.0; member notes at
`.team/release-4.5.0.md` for the lead to post in Updates.
