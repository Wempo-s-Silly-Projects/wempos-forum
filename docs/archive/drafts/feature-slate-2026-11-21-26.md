# Feature slate — wave 2026-11-21-26 (v4.31.0)

Theme: chat (lobby + DMs + group DMs). Two small member features. No
migration. One new route (`PATCH /api/dm/groups/:id`).

## F1 — Mute a chat (members, local-only)

A **Mute chat** toggle sits beside **Pin chat** in an open DM or group. A
muted conversation stops counting toward the chat launcher's unread badge
and lists with a quiet "Muted" mark. Messages still arrive, the row still
shows its own unread styling, and opening it still marks it read. Press the
toggle again to unmute.

Why: in a busy group the badge becomes noise, and the only way out today is
leaving the group. Muting keeps you in the conversation without the badge
nagging. Not shipped before: pins (v4.10) reorder the list, they do not
change the badge.

Shape: `public/js/chat-mutes.js` (mirrors `chat-pins.js`):
`forum-chat-mutes:u<id>` (no account id, no key), cap 50, keys
`dm:<id>` / `group:<id>` only, corrupt or blocked storage reads as none.
`unmutedUnreadTotal({ serverTotal, rows, mutes, keyOf })` takes the server's
whole total (or the row sum on an older server) minus the loaded muted
rows' unread, never below 0. A muted group on an unloaded older page still
counts until its page loads. The closed-panel badge keys on
`state.currentUser` until the panel's own session probe runs.
`clearAllMutes()` is registered in `wipeAccountLocalData()`.

Privacy: the mute list never leaves the browser and reveals no activity to
anyone. Nothing about it reaches the server.

## F2 — Group rename by the creator

The group's creator gets a one-line **Group name** field with a **Rename**
button in the member strip. Saving an empty name clears it back to the
member-list title.

Why: a group's name was fixed at creation (v4.7); slate 2 deferred rename
"until asked", and long-lived groups outgrow their first name.

Server: `PATCH /api/dm/groups/:id {name}` in `api/dm-groups.mjs`
(`handleGroupRenameRoute`). `loadManagedGroup` gate: requireUser (CSRF +
same-origin), membership (outsider = the same 404 as a missing group),
creator check (403), active-ban refusal, write rate limit. Name intake =
`readGroupName` (word filter, 60-char cap); non-string 400. Single-row
`UPDATE … WHERE id = ? AND creator_id = ? AND EXISTS(creator membership)`
with bound params, so a rename racing the creator's leave changes nothing.

Client: `public/js/group-rename.js` `buildGroupRename(doc, group, { onSave })`
(pure builder, no request): trimmed, maxLength 60, unchanged name sends
nothing, single-flight. `dm-extras.js` wires it under `group.canManage`
with `api(base, { method: "PATCH" })`. The 5s repaint carries a half-typed
name (same conversation only).

## Strings

5 keys × 21 locales: `dm.muteChat`, `dm.mutedLabel`, `dm.muteFull`,
`dm.renameGroup`, `dm.groupNameLabel`.

## Tests

- `tests/wave26-group-rename.test.mjs` (6, RED before the route): creator
  renames, member 403, outsider/missing identical 404, guest 401, no-token
  and cross-origin 403, banned creator 403, left creator 404, word filter,
  cap, empty clears, non-string 400. Mutation-checked: dropping the creator
  gate or the string check each fails a test.
- `tests/wave26-chat.test.mjs` (10, RED before the modules): mutes key
  scoping, immutable toggle + cap, corrupt/blocked storage, badge math,
  wipe, wiring pins, rename form (fake-dom) prefill/cap/trim/empty/unchanged/
  single-flight, rename wiring, locale parity.

Considered and deferred: emoji reactions (needs a table, so a migration),
lobby mention jump, timestamp locale polish.
