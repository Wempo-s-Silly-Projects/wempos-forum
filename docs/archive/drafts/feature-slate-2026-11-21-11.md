# Feature slate — wave 2026-11-21-11 (v4.16.0)

One hardening pass over v4.9–v4.15 and one small member feature. No migration,
no new routes.

## F1 — Hardening review of `d86393c^1..d6683ff`

Scope: `api/mod-tools.mjs` (peek, hide-recent, restore), the wave-5 changes in
`api/chat.mjs` and `api/dm-groups.mjs` (VISIBLE_UNREAD_SQL, group cursor, add
route), the chat-widget split modules, chat-pins/catch-up storage scoping,
lobby-reply, chat-filter, copy-code, read-aloud, post-keys, latest-reply and
the modulepreload hints.

Fixed (MEDIUM): IME composition. `chat-widget-composer.js` sent on any Enter
without Shift, and `mention-picker.js` picked on Enter/Tab. Both ignored IME
composition, so confirming a Japanese/Chinese/Korean candidate sent a
half-typed DM or inserted a mention. New `isImeComposing(event)` in
`focus-utils.js` (`isComposing`, or keyCode 229 for Safari's commit keydown)
guards both handlers. `tests/wave11.test.mjs`: helper unit tests and pins on
both handlers, RED before the fix.

Checked, no defect:
- Mod routes: all three go through `requireStaff`; the POSTs use the mutating
  gate (Origin + CSRF), `assertNotBanned` and the write limiter. Hide-recent
  only touches `visibility = 'public'` rows of the target author. Restore skips
  staged uploads (`staged_at IS NULL`). The largest bind list is 52 (50 ids
  + 2), under D1's 100.
- Group cursor: anchored regex `^\d{1,12}\.\d{1,15}$`, so NaN, negative,
  signed and non-numeric values get a 400. Ids stay within safe integers.
- Unread SQL: the block-pair test covers both directions (`blocker = viewer`
  or `blocked = viewer`). Bind counts match the placeholders in
  `viewerDmUnread`, the thread list and VISIBLE_UNREAD_SQL.
- Storage: pins, catch-up marks and drafts are keyed `:u<id>`, and sign-out
  wipes all three (`account-nav.js`).
- XSS: the filter, Lobby reply prefill, read-aloud text, peek bodies and desk
  links write only through `textContent`, `.value` or numeric hrefs.

LOW (not changed):
- Hide-recent and restore let an admin act on another admin's posts. This
  matches the ban guard (`bans.mjs:147`, only the owner and yourself are
  refused).
- Banned staff can still use the read-only peek, the same as the existing
  hidden desk (GET routes skip `assertNotBanned`).
- If the `/api/session` probe fails, `ui.widgetUser` is null and pins fall back
  to the unscoped key. The wipe on sign-out still clears it.
- Read aloud: two Listen clicks less than 1 s apart, while voices are still
  loading, can queue both posts.
- J/K does nothing with Caps Lock on (`event.key` is "J"), and lines inside a
  code fence are read aloud (only the fence markers are skipped).

## F2 — "You" chip (members)

- `render.js` `createPostCard`: when the signed-in member wrote the card, a
  `role-badge role-badge-you` chip ("You", title "You wrote this") goes next
  to the name, in the muted style of the Author chip. Client-only, from ids
  the card already carries. No request, no storage.
- 2 new strings (`render.you`, `render.youTitle`) in en and the other 20
  locales, real translations (he uses the gender-neutral "שלך").
- Tests: own card is chipped; someone else's card, a guest view and a removed
  author are not; both keys in every locale.
