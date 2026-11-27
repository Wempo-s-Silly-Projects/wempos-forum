# Feature slate — wave 2026-11-21-12 (v4.17.0)

The three LOWs from the wave-11 review, plus two small reading comforts for
long threads. No migration, no new routes, nothing new stored or sent.

## F1 — Wave-11 review LOWs

a. **Pins wait for the account id.** `chat-pins.js` fell back to the unscoped
   `forum-chat-pins` key when `/api/session` failed, so pins saved while the
   session was unknown landed in a key shared by every account on that
   browser. Now
   `pinsKey(null)` is `null`, `readPins`/`writePins` do nothing without an
   account id, and the chat header shows no pin toggle until the id is known.
   Sign-out still wipes any old unscoped key left by earlier versions.
b. **Read aloud never queues two posts.** Two Listen clicks while voices were
   loading both reached `speak()`. A ticket bumped on every click and stop now
   drops any voice wait a newer click superseded; queued speech is cancelled
   just before speaking; and a late `end` event from a cancelled utterance no
   longer flips the new post's button back to "Listen".
c. **J/K under Caps Lock.** `postKeyStep` compared `event.key` case-sensitively,
   so Caps Lock's "J"/"K" did nothing. It now lowercases the key; Shift, Ctrl,
   Alt and Meta still block.

Tests: `tests/wave12.test.mjs` — the pins, read-aloud double-click and Caps
Lock tests were RED against v4.16.0 and pass now. `tests/chat-pins.test.mjs`
updated on purpose: its storage tests now use an account id.

## F2 — Fold a reply (members)

Each reply on a thread page gets a small **Fold** toggle in its header.
Folding hides that one reply down to its author line, so a member can tuck
away a long tangent and keep reading.

Why this one: long threads are where our members spend time, and the slate
so far only helps you *move* through them (J/K, latest reply, catch-up). This
helps you *thin* one, with no moderation implied: it is page-view only,
nothing is stored or sent, and everyone else still sees the reply. Not
shipped before. It is not "hide replies" (that toggles a whole sub-reply
branch) and not mod hide (that is server-side and staff-only).

Shape: `public/js/reply-fold.js` `addReplyFolds(document, container)`,
idempotent, called wherever replies are painted (first paint, sub-replies,
"Load older replies"). The label never changes; `aria-pressed` alone carries
the state (the v4.13 toggle convention). CSS hides `.post-card[data-folded]`
children except the header.

## F3 — Back to the first post (members)

Under a long thread's replies (3 or more), a **Back to the first post** button
moves focus and the view to the opening post. It is the mirror of v4.14's
"Jump to latest reply": a reader at the bottom can re-read the question
before replying without scrolling all the way up. Harmless: one button, no
request, no storage. `createFirstPostJump` lives in `latest-reply.js` next to
its twin and uses the same threshold.

## Strings

3 new keys (`post.foldReply`, `post.foldReplyTitle`, `post.firstPost`) in
en.json and all 20 locales, real translations; the wave-12 test checks every
locale has them and that none is left in English.

## Release

v4.17.0 — `wrangler.toml` production `VERSION` and `package.json`.
