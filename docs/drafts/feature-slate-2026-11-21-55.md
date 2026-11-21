# Feature slate 2026-11-21-55 (wave 5.5, v5.5.0)

Areas: the post composer and the thread/reply view (neither touched in
v4.45–v5.4). Checked against all 42 earlier slates: no caps/shouting guard
and no in-thread reply filter has shipped (closest neighbours: F3 Search
highlighting = the /search page; F2 Fold all replies = hides everything).

## F1 — Caps guard in the composer (unique)

What: when a composer's text is mostly capital letters (>= 70% of at least
12 cased letters), a quiet note appears under the textarea: "That's mostly
capital letters, which can read as shouting." with a "Lower the caps"
button that rewrites the text to sentence case. Links, `code` and @mentions
are left exactly as typed. After the fix an "Undo" button puts the original
text back until the member types again. Scripts without letter case
(Chinese, Japanese, Arabic...) never trigger it.

Why: all-caps posts read as yelling and get reported; a one-click fix at
writing time beats a moderator edit later. Nothing leaves the browser,
nothing is stored, and the text only changes when the member presses the
button.

Files: new `public/js/caps-guard.js` (`isShouting`, `toSentenceCase`,
`createCapsGuard`), `public/js/routes/composer.js` (mount under the
textarea), `public/styles.css`, `public/locales/*.json` (4 keys x 41).

Tests (`tests/wave55-caps-guard.test.mjs`, RED first): detection threshold
and minimum, caseless scripts never trigger, sentence case keeps URLs/code/
mentions byte-identical, fix fires an input event (draft + counter stay in
sync), Undo restores, note hides when the text calms down, no
innerHTML/storage/api() in the module, composer mounts it.

## F2 — Filter replies on a thread page (unique)

What: a "Filter replies" box above the replies of any thread with 3+
replies. Typing shows only the top-level replies whose text contains the
words (case-insensitive), a live "2 of 9 replies match" line, and Escape or
"Clear" brings them all back. Spoilered text is masked before matching, so
the filter never reveals what a spoiler hides. "Load older replies" cards
are filtered as they arrive. A reply's open sub-reply group follows its
parent.

Why: long threads bury the one reply about the thing you care about; the
browser's find bar jumps but does not narrow. Page view only: nothing
stored, nothing sent, the replies stay visible to everyone else.

Files: new `public/js/reply-filter.js` (`replyMatches`,
`createReplyFilter`, `refreshReplyFilter`), `public/js/routes/post.js`
(mount + refresh after Load older), `public/styles.css`,
`public/locales/*.json` (5 keys x 41).

Tests (`tests/wave55-reply-filter.test.mjs`, RED first): threshold, match
narrowing + count line, case-insensitive, spoiler text never matches,
sub-reply group follows its parent, Escape/Clear restore (IME guard),
refresh covers older replies, page-view-only source pin, post.js wiring.

## Laws

No server change, no migration, no new storage key, no network call. Every
string via t()/tn() in en.json + 40 locales (real translations). User text
via textContent/value only.
