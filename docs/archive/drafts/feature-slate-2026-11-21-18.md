# Feature slate — wave 2026-11-21-18 (v4.23.0)

A privacy feature (Download my data) plus two small settings-page fixes. No
migration. One new read route. Nothing new is stored.

## F1 — Download my data

`GET /api/me/export` (api/export.mjs, wired in worker.mjs) returns a JSON
attachment (`Content-Disposition: attachment; filename="wempos-forum-data-<id>.json"`,
`Cache-Control: no-store`) holding the caller's own data only.

- **Auth:** `requireSignedInRead`; anonymous callers get 401. Banned members
  can still export: it is their own data.
- **Rate limit:** the shared `write` limiter, keyed per member id.
- **Caps:** `EXPORT_SECTION_CAPS` in constants.mjs (posts 2000, bookmarks
  1000, followedThreads 1000, blocks 1000, wallPosts 1000, directMessages
  2000), newest first. A section that hit its cap is flagged in
  `truncated`.

| Section | What it holds | Why this scope |
|---|---|---|
| profile | username, role, bio, flair, accent/banner, approved + pending CSS, css status, Polytoria name, avatar status, socials, joined date | fields the member can see or edit on their profile |
| settings | twoFactorEnabled (flag only), invisibleOnline | the stored server-side settings |
| posts | own posts and replies: id, parentId, board, visibility, body, created/edited | the author's own words, exported as written (spoilers not masked, hidden ones included); the masking law covers previews of others' reading, not an author reading their own text back |
| bookmarks | postId + savedAt | ids only, never someone else's text, so the visibility law has nothing to filter |
| followedThreads | postId + followedAt | thread subscriptions are the forum's only notification setting (no other notification preference is stored) |
| blocks | own direction only: id, username, blockedAt | a block ON the caller is the other member's record |
| wallPosts | wall posts the caller wrote: id, wallOwner, body, createdAt | posts others wrote on the caller's wall belong to their authors |
| directMessages | messages the caller SENT (1:1 + group): kind, id, with / groupName, body, sentAt | data portability covers what you wrote; others' replies are their words, so they stay out. The other username / group name is context the caller already has |

**Never included** (explicit column lists, never `SELECT *`):
`password_hash`, `password_salt`, `totp_secret`, `totp_pending_secret`,
`totp_backup_codes.code_hash`, `sessions.token_hash`, `sessions.csrf_token`,
any IP data (`known_ips`, `banned_ips`, request IP hashes), `avatar_data` /
`pending_avatar_data` (image bytes), `idempotency_key` /
`idempotency_fingerprint`, other members' posts, DMs and blocks.

**Client:** a "Your data" panel in account settings
(public/js/data-export.js) with a **Download my data** button. Nothing is
fetched until it is pressed (privacy law: network actions are explicit). The
JSON comes through the one `api()` wrapper and is saved locally through a
Blob URL.

## F2 — Settings filter

A "Find a setting" search box at the top of account settings
(public/js/settings-tools.js `createSettingsFilter`) hides sections whose
text doesn't match, shows "No settings match that." when nothing does, and
hides the jump buttons of filtered-out sections. Client-only.

## F3 — Titled settings with section anchors

The settings disclosure used to show the browser's bare "Details" label. It
now has an **Account settings** summary. Every section gets a stable id
(`settings-<slug>`, with a position fallback for non-Latin headings) and a
jump list. The jump list uses buttons that scroll and focus the heading, not
`#fragment` links, because a fragment navigation re-enters the SPA router.

## Strings

9 new keys (`settings.*`) in en + all 20 locales.

## Tests

tests/wave18.test.mjs (14): anon 401; no-store JSON attachment; own sections
with own text unmasked; no foreign data (posts, wall, DMs, reverse block);
no secret key name at any depth and no secret value in the body; caps +
truncated flag; 429 through the write limiter; panel renders without
fetching; download fetches once and saves; filter; empty state; jump-button
hiding; anchors + focus; feed wiring.
