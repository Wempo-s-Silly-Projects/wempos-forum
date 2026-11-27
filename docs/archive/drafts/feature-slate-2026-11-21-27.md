# Feature slate — wave 2026-11-21-27 (v4.32.0)

## F1 — Hardening review of v4.29–v4.31 (`4fa7deb..1f4943e`)

Reviewed: sign-out wipe, quote-selection, wall per-block render, lightbox
skip, fold-all bound, next-author jump, chat mutes + badge math, group
rename route, docs claims. No real defects found.

- **Storage-wipe sweep**: 6 account-scoped families (drafts, catch-up,
  newcomer, chat pins, chat mutes, gallery recents), each with a
  `clearAll…()` called in `wipeAccountLocalData()`. 5 device prefs (theme,
  text size, corners, DM effects, locale) stay by design. No sessionStorage.
  Guest catch-up/draft keys are wiped by prefix.
- **Regression pin**: `tests/wave27-storage-wipe-sweep.test.mjs`. Any
  public/js module that writes storage must be a listed device pref or
  register a `clearAll…()` that the wipe calls. Mutation-checked (dropping
  `clearAllMutes()` fails; a rogue `:u` writer fails).
- **Quote-selection**: both ends must sit in this card's own body blocks
  (nested cards excluded via `closest`); spoilers are masked whether partly
  or wholly selected; goes into the textarea as plain text. LOW: a
  `.visually-hidden` span inside a body would be quoted (none exist today).
- **Group rename**: same `readGroupName` intake as create (filter, cap);
  creator gate plus membership in the UPDATE's WHERE; 5 binds; PATCH
  routes through the shared dispatch (Origin/CSRF in `requireUser`).
- **Mute badge**: the server `dmUnread` and the per-row unread are both
  visibility-filtered (hidden peers 0, banned/blocked group authors
  excluded), so the subtraction is consistent. LOW: a stale older group
  page can briefly under-count until the next refresh (floored at 0).
- **Docs (LOW, fixed)**: the README sign-out list now names muted chats;
  moderation.md says hide-recent closes open reports on the hidden posts
  only (matches `api/mod-tools.mjs`).

## F2 — "Unread only" on the chat list (members)

A checkbox under the Filter chats box narrows the loaded rows to those with
unread > 0. It combines with the name filter; muted chats stay in; the empty
state says "No unread chats." (also announced through the existing status
node). Page-view only: no storage, no request, resets on close.
`onlyUnread(rows, on)` is pure and immutable in `public/js/chat-filter.js`.

## Strings

`chat.unreadOnly`, `chat.noUnreadChats`: en + all 20 locales, translated.

## Tests

- `tests/wave27-storage-wipe-sweep.test.mjs` (5)
- `tests/wave27-unread-only.test.mjs` (6, written RED first)

Migrations: none.
