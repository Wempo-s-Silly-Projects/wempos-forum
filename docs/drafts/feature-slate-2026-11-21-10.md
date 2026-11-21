# Feature slate — wave 2026-11-21-10 (v4.15.0)

One docs lane, one load-path lane and one small member feature. No migration,
no new routes.

## F1 — Docs catch up to v4.15

- `README.md` "What's in it" now covers what shipped from v4.5 to v4.15:
  writing tools (drafts, @mention picker, preview, spoilers), reading tools
  (catch-up, glance strip, latest-reply jump, Author chip, read aloud, J/K),
  copy link and copy code, 21 locales with the header picker and RTL, text
  size, group chats (10 members), DM images, pinned chats (5), and the mod
  peek (10 posts), hide-recent (up to 50) and restore.
- `docs/chat-widget.md` gains Group chats and Images in DMs route tables, and
  the in-browser extras (pins, filter, Lobby reply, message effects).
- Each number was checked against code: `DM_GROUP_MAX_MEMBERS = 10` and
  `DM_GROUP_NAME_MAX_CHARS = 60` (constants.mjs), `MAX_PINNED_CHATS = 5`
  (chat-pins.js), `PEEK_LIMIT = 10` and `HIDE_RECENT_MAX = 50`
  (api/mod-tools.mjs), the 10 MiB cap and JPEG/PNG/WebP/GIF list
  (api/dm-images.mjs), and 21 entries in `LOCALES` (i18n.js). No security
  internals are described.

## F2 — Load path

- `scripts/import-graph.mjs` walks the static `import`/`export … from` graph
  out of the `<script type="module">` entries in `public/index.html`, and
  lists dynamic `import()` edges separately.
- Measured before this lane: 71 modules, depth 3 (the
  app → routes/feed|post → render → polls/bots/copy-link chain).
- 16 `<link rel="modulepreload">` hints cover the feed/thread hot path. After:
  72 modules (copy-code.js is new), unhinted depth 3, effective depth 2. The
  render chain is fetched along with the document.
- Hrefs stay plain: the cache-buster here is the worker's `app-build` meta
  stamp plus `no-store` HTML, not a `?v=` query, so preload and import share
  one module-map entry.
- No lazy imports. `read-aloud.js` and `dm-effects.js` are called
  synchronously while rendering (`createReadAloud`, `isEmojiOnly`), so making
  them lazy would change behavior.
- `tests/load-path.test.mjs`: every hint exists, every hint is reachable (no
  dead hints), every static and lazy import resolves, and the hinted depth is
  lower than the unhinted depth.

## F3 — Copy code (members)

- `public/js/copy-code.js`: a quiet icon button in a tool row at the top of
  every `pre.post-codeblock` (posts, replies, rules page, compose preview).
  It copies the block's raw text, read at click time. A polite `role=status`
  beside the button says "Code copied" or "Couldn't copy the code" and clears
  after 2 s.
- The `pre` stays a direct child of the card, so the edit swap
  (`isEditBodyBlock`) is unchanged. The tool row is sticky to the start edge
  in wide blocks. A new `copy` icon. Client-only: no request, no storage.
- 3 new strings in en and all 20 other locales (real translations).
- `tests/copy-code.test.mjs`: 5 tests covering the clipboard success and
  refusal paths, click-time text, status announce and clear, renderBodyBlocks
  wiring with code text untouched, and locale coverage.
