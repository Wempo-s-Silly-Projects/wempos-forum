# Feature slate — wave 2026-11-21-2 (release v4.7.0, DMs)

Through-line: **DMs grow up** — the two roadmap-owed DM features (group chats,
pictures) plus one small opt-in touch that makes a conversation feel alive.

Laws every feature rides: vanilla ES modules + 17-line AGPLv3 header on new
files; createElement/textContent only; fetch only through the one `api()`
wrapper; every `localStorage` touch wrapped in try/catch; visibility law
(active bans hide content at read time, block pairs hide content both ways);
new tables CREATE-only in one migration (`0044_dm_groups_images.sql`), applied
locally only; every painted string keyed in `public/locales/*.json` (21 tables).

## F1 — Group DMs (roadmap)
New tables `dm_groups`, `dm_group_members` (per-member `unread`),
`dm_group_messages`. Module `api/dm-groups.mjs`. Caps in `constants.mjs`:
`DM_GROUP_MAX_MEMBERS = 10` (creator included), `DM_GROUP_NAME_MAX_CHARS = 60`.
- `POST /api/dm/groups {name?, usernames[]}` — creator + 1..9 others.
- `GET /api/dm/groups/:id` — members only (non-member and missing are the
  same 404: no existence oracle). Messages by actively-banned authors and by
  anyone in a block pair with the viewer are hidden at read time.
- `POST /api/dm/groups/:id` send (word filter, 1000 chars, bumps every other
  member's unread); `POST /:id/read` zeroes the viewer's own counter.
- `POST /:id/members {username}` / `DELETE /:id/members/:userId` — creator
  only (while still a member); the creator cannot remove themself.
- `POST /:id/leave` — any member; the last member out deletes the group.
- Add/create refuse: unknown user, self, duplicates, actively-banned users, a
  block pair (either direction) with ANY current member or other invitee,
  and anything over the cap.
- `GET /api/dm/threads` gains an additive `groups` array; `/api/chat`'s
  `dmUnread` includes group unread so the badge stays one number.
Acceptance (RED first): non-member read/send/read-mark/leave/manage → 404,
member add by non-creator → 403, cap → 400, banned → 400, block pair → 403,
banned/blocked authors hidden, unread bump/zero, last leave deletes.

## F2 — Images in DMs (roadmap)
Tables `dm_images` (bound to exactly one 1:1 thread OR one group) and
`dm_image_chunks` (D1 BLOBs, ≤1.9 MB per chunk — R2 is not configured).
Module `api/dm-images.mjs` reuses the attachment intake: the 10 MiB
`MAX_ATTACHMENT_BYTES` cap, `sniffImageMime` + `sanitizeImage` (JPEG/PNG/WebP/
GIF only, metadata stripped), `sha256Hex` + `revoked_attachment_hashes`
refusal, the `image-upload` rate limiter, and `imageResponse` egress checks.
- `POST /api/dm/threads/:id/images` and `POST /api/dm/groups/:id/images`
  (multipart field `image`) store the image and its message (`[img:<uuid>]`
  body) in one batch, with the same gates as a text send.
- `GET /api/dm/images/:id` — signed-in members of THAT conversation only;
  everyone else (outsider, removed member, block pair with the uploader,
  banned uploader, revoked hash, unknown id) gets the same 404.
  `Cache-Control: private, max-age=300`.
- A typed text body shaped like `[img:<uuid>]` is refused (no re-posting
  another conversation's image token).
- Client: a lazy `<img alt="Image from {name}">`, a fallback line when it
  will not load, "Image" as the list preview.
Acceptance (RED first): outsider/no-session/IDOR fetch → 404/401, member
fetch → 200 with bytes, non-image → 400, oversize → 413, forged token → 400.

## F3 — UNIQUE: Message effects (opt-in, client-only)
A "Message effects" switch in the DM panel (off by default, remembered in
localStorage). When on, a message made only of 1–3 emoji renders jumbo, and a
freshly arrived one pops in once (no motion under `prefers-reduced-motion`).
Why: emoji-only replies are the most common "alive" signal in chat; making
them big is a familiar delight, costs zero requests, zero data, zero schema,
and stays invisible to anyone who doesn't turn it on.
Acceptance: pure `isEmojiOnly` helper unit-tested (1–3 emoji yes; text, 4+
emoji, digits, empty no); the toggle reads/writes storage through try/catch.

Considered and deferred: typing indicators and read receipts (network-facing
presence leaks; would need an opt-in privacy design), group renames (YAGNI
until asked).
