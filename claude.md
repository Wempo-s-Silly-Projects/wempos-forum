# Wempo's Forum
This is my forum code:3 Yeah anyways heres how it was made: Cloudflare Workers, Cloudflare D1, and Static Assets. The frontend calls the same-origin `/api/*` endpoints which are handled by `worker.mjs`; posts, replies, reactions, profiles, sessions, reports, and bans stay and persist in D1 store.
## Requirements

- Node.js 22 or newer (preferably the latest LTS version or latest non-LTS version)
- Access to a Cloudflare account that owns the D1 store `wempo-forum-data`
- Cloudflare Wrangler is installed.

## Local development

1. Install dependencies:

   ```bash
   npm install
   wrangler login
   ```

2. Create a long random setup secret (at least 32 characters) with this command: `openssl rand -hex 32`. For local-only development, create a `.dev.vars` file in the repository root:

   ```dotenv
   SETUP_SECRET=
   PASSWORD_PEPPER=
   ```

   Paste separate, randomly generated values after each equals sign. Use 32–4096 characters for `SETUP_SECRET` and 32–256 for `PASSWORD_PEPPER`. `.dev.vars` is ignored by Git and must never be committed. Keep a secure backup of `PASSWORD_PEPPER`; changing or losing it prevents existing accounts from authenticating because it is part of each password hash.

3. Apply the schema to the local D1 store and run the app:

   ```bash
   npm run db:migrate:local
   npm run dev
   ```

4. Open the local URL printed by Wrangler. The first-admin setup form stays locked until both `SETUP_SECRET` and `PASSWORD_PEPPER` are configured with valid values. Use the setup secret only in the setup form, then sign in normally.

Local development uses a local D1 store by default. The migration does not touch production unless you explicitly use the remote migration command.

## Deploy

The Wrangler configuration is already pointed at the account's existing D1 database, `wempo-forum-data`. Before deployment, confirm that the database ID in `wrangler.toml` matches the database you intend to use.

1. Set both secrets for the deployed Worker (Wrangler prompts for each value):

   ```bash
   wrangler secret put SETUP_SECRET
   wrangler secret put PASSWORD_PEPPER
   ```

   Use separate random values for local and production. Back up `PASSWORD_PEPPER` securely and never rotate it after accounts exist without a password-hash migration; losing it prevents those accounts from authenticating.

2. Apply the migration to the remote database only after reviewing it:

   ```bash
   npm run db:migrate:remote
   ```

3. Deploy:

   ```bash
   npm run deploy
   ```

Never run the remote migration against a database that contains data you do not intend this forum to use. The migration creates tables and indexes but does not create or promote an account by itself.

## API coverage

- `GET /api/session`, `GET /api/setup/status`
- `POST /api/setup`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/posts`, `GET /api/posts/:id`, `POST /api/posts`, `PATCH /api/posts/:id`, `DELETE /api/posts/:id`, `POST /api/posts/:id/replies`
- `PUT /api/posts/:id/reaction`, `DELETE /api/posts/:id/reaction`, `GET /api/search`, `GET /api/users/:username`
- `PATCH /api/me`, `POST /api/me/avatar`, `PATCH /api/me/password`, `POST /api/me/delete`
- `GET /api/me/notifications`, `POST /api/me/notifications/:id/read`, `POST /api/me/notifications/read-all`
- `POST /api/posts/:id/reports`, `GET /api/admin/reports`, `POST /api/admin/reports/:id/resolve`
- `GET /api/admin/bans`, `POST /api/admin/users/:id/bans`, `DELETE /api/admin/users/:id/bans`
- `POST /api/admin/users/:id/promote`, `POST /api/admin/users/:id/demote` (admin only)
- `GET /api/admin/avatars`, `POST /api/admin/avatars/:userId/approve`, `POST /api/admin/avatars/:userId/reject`
- `GET /api/avatars/:userId`
- `GET /api/archive`
- `GET /api/attachments/:id`
- `GET /api/admin/attachments`, `POST /api/admin/attachments/:id/approve`, `POST /api/admin/attachments/:id/reject` (admin only)
- `POST /api/posts` and `POST /api/posts/:id/replies` also accept multipart with image attachments.

The backend is split into `api/*.mjs` modules (shared, session, posts, profiles, moderation, notifications, filter, attachments) imported by `worker.mjs`; keep that split when editing — each topic lives in its module.

## Forum behavior notes

- View counter (v2.4.3, raw impressions): every detail read by a non-author adds one view (`posts.view_count`, migration 0009; `UPDATE … RETURNING` keeps the payload's count fresh). The eye chip sits in each card's action row; counts are display-only and affect nothing.- Posts and replies are capped at 1,000 characters with a live composer counter.
- Replies nest one level (root → reply → reply-to-reply); the feed is sorted by `last_activity_at` (replies bump, reactions do not) with composite `before=<seconds>_<id>` cursors.
- Avatars are moderated: uploads go to a pending set; the previously approved avatar keeps serving until a moderator approves/rejects from the `/api/admin/avatars` queue.
- Accountability archive (v2.4.1): every post deleted by its author or wiped by an account deletion is copied into `post_archive` first (same atomic batch) and served publicly at `/archive` — deletion is never a way to scrub words (rooman98's ask).
- Banning auto-hides posts (v2.4.1): an active ban hides all of that author's content at read time — feed (both boards), replies, detail (hidden-post visibility semantics: author and admins pass; moderators follow `canViewPost`), and edit history. It is read-time only, so unpinning, expiring, or revoking a ban restores the posts without any write.
- A curated word filter runs on posts and replies from the `FILTERED_WORDS` secret (comma-separated; `wrangler secret put FILTERED_WORDS` in production, an entry in `.dev.vars` locally; unset = filter off). See `config/filtered-words-template.txt`.
- Banned accounts see a dedicated ban screen on failed sign-in with the ban reason and (for temporary bans) a reactivation countdown.
- A theme toggle switches between light and dark; the choice is stored client-side and persists across reloads.
- Edit history (v2.4.1): every edit snapshots the replaced version into `post_edits` (the first edit preserves the original); the "(edited)" marker gains a public "history" toggle (`GET /api/posts/:id/edits`) so past versions are viewable by anyone who can view the post (per `canViewPost`; hidden posts stay author+admin for history too). Edits can't quietly rewrite context.
- Thread presentation (v2.3): feed cards show a reply-count chip and up to 3 single-line latest-reply previews; sub-replies render cascade-styled on the detail view; a Quote button prefills `> @user: text` into the reply composer and leading `> ` lines render as blockquotes; profile social links collapse into an expandable block.
- Boards (v2.4.1, migration 0006): posts carry a `board` column (`posts.board`, default `'general'`; values whitelisted to `'general'`/`'suggestions'` at the handler layer). The board is a root-only dimension — replies inherit their thread root's board at creation, and the home feed is the general board implicitly. The Suggestions board (`/suggestions`) lists only roots with `board='suggestions'`, sorted by net reaction score (likes minus dislikes) with the id tiebreak, paginating a composite `before=<score>_<id>` cursor; score instability across page turns is accepted. GET /api/posts without a `board` param keeps the original activity-feed behavior; unknown `board` values 400.
- Author post editing (v2.4): `PATCH /api/posts/:id` is author-only (any role, covers roots and replies), reapplies the word filter and the 1,000-character limit, stamps `edited_at` (shown as an "(edited)" marker), and never bumps `last_activity_at`; edits are text-only, so attachments stay as originally posted.
- Edit history (v2.4.1): `GET /api/posts/:id/edits` is public to anyone who can view the post; every edit stores the replaced version in `post_edits` (the first edit snapshots the original), surfaced as a "history" toggle next to the "(edited)" marker.
- Author post deletion: `DELETE /api/posts/:id` is author-only (session identity, no role path; delete button on own cards behind a confirm dialog). Deleting a ROOT post deletes the entire thread — every reply (other people's included) plus its reactions, reports, notifications, and attachments, all via foreign-key cascades. Deleting a REPLY preserves the conversation: its sub-replies are reparented to the thread root in the same atomic batch before the delete, so no one else's content is lost.
- Account deletion: `POST /api/me/delete` lets a signed-in member permanently delete their own account (Delete account control in the signed-in account settings, behind a confirm dialog that spells out the blast radius). Everything the account owns goes: their posts — and the whole threads they started, including other people's replies inside those threads — their replies inside other people's threads, reactions, reports they authored, notifications, bans on them, all sessions, and their avatar. Bans/reports they acted on as a moderator survive with the actor columns cleared. Other members' own threads are untouched.

### Image attachments

- Post and reply composers accept up to 3 images, 10 MiB max each; JPEG, PNG, WebP, and GIF are accepted by magic-byte sniffing.
- The 10 MiB limit is possible because large blobs are chunked across `attachment_chunks` rows (D1 caps a single BLOB/row at ~2 MB).
- Attachment bytes are stored in D1. Moderation is hybrid: the author always sees their own pending images (with a pending chip); everyone else sees a placeholder until a moderator approves from `/api/admin/attachments`. Rejected images stop serving.
- The pending-only cache is private (no-store).

## Security notes

- Passwords use per-account random salts, a deployment-held HMAC pepper, and PBKDF2-HMAC-SHA-256; plaintext passwords are never persisted. PBKDF2 is capped at 100,000 iterations to stay within the Cloudflare Workers Web Crypto implementation's iteration ceiling. This is a platform-constrained tradeoff versus higher PBKDF2 work factors on traditional servers, partially offset by the pepper and rate limits.
- Session IDs are cryptographically random, only their SHA-256 hashes are stored, and browser cookies are HttpOnly and SameSite=Lax. HTTPS responses set Secure.
- State-changing requests require the exact same Origin plus a CSRF token tied to the session.
- The first administrator requires the out-of-band `SETUP_SECRET`; a database uniqueness constraint prevents duplicate administrator accounts.
- Cloudflare rate-limit bindings are location-local and eventually consistent, so limits are abuse controls rather than exact accounting. Report creation, avatar uploads (5/minute), and reactions (30/minute) also have per-account limits in addition to the broader per-IP write limit.
- SQL values are parameterized, roles are checked server-side, and hidden posts/moderator endpoints enforce access checks.
- API body sizes, username/password/post/bio/report limits, image magic bytes, and request rates are checked server-side. Cloudflare Rate Limiting bindings enforce limits without a D1 write for every request.
- JSON/API responses and static assets include security headers and a restrictive Content Security Policy.

### Avatar and attachment storage

R2 is not enabled on the connected Cloudflare account right now, so this version stores validated image bytes in D1: avatars (JPEG, PNG, WebP) with a hard 1 MiB per-image limit, and post/reply attachments (JPEG, PNG, WebP, GIF) up to 10 MiB each, chunked across `attachment_chunks` rows because D1 caps a single BLOB/row at ~2 MB. This is suitable as a simple initial backend, not an ideal large-scale media store. Move avatar and attachment objects to an R2 bucket before growing the forum or accepting larger uploads.

## Checks

```bash
npm run db:migrate:local
npm test
wrangler deploy --dry-run
```

Run local browser smoke tests for registration/login, posting/replies, reactions, reports, banning/unbanning, password changes, avatar uploads, logout, and reload persistence before opening this to other users. Do not consider the forum production-ready solely because unit tests pass.
## Git
DO NOT DO GIT OPERATIONS ON MY GITHUB REPO WITHOUT PERMISSION AND I DO THAT MYSELF
