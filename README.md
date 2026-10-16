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

2. Read [the release checklist](docs/release-checklist.md) and verify the remote database name, ID, schema, and `d1_migrations` ledger before applying anything. Production has a documented 0019 ledger discrepancy; do not invoke the remote migration command until that is reconciled using the guarded procedure in the checklist.

   ```bash
   npm run db:migrate:remote
   ```

3. Deploy:

   ```bash
   npm run deploy
   ```

Never run the remote migration against a database that contains data you do not intend this forum to use. The migration creates tables and indexes but does not create or promote an account by itself.

## Preview environment secrets

Preview has its own D1 database and rate-limit namespaces. It must also have its own secrets configured in the Cloudflare dashboard; Wrangler's `[previews.vars]` block is for non-secret values and must never contain password peppers or setup secrets.

In the Cloudflare dashboard, open the forum Worker/Preview environment's **Settings → Variables and Secrets** and add these as **Secret** values (not plain-text variables):

- `SETUP_SECRET`: generate a unique random value of at least 32 characters.
- `PASSWORD_PEPPER`: generate a separate random value of 32–256 characters.

Use Preview-only values. Do not reuse production secrets, paste secret values into GitHub, or commit them to `wrangler.toml`. Back up the Preview pepper securely if Preview accounts need to remain usable. After setting both secrets, redeploy Preview and verify `GET /api/setup/status` plus first-admin setup against the Preview database only. Production continues to use its separately configured secrets.

The Preview Turnstile hostname is intentionally the single exact hostname `wempos-forum-preview.itswempo.workers.dev`, not a wildcard. If Cloudflare assigns a different hostname to the Preview deployment, update `previews.vars.TURNSTILE_HOSTNAMES` to that exact hostname and add that hostname to the matching Turnstile widget's allowed hostnames.

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

- My posts (v2.5): a tab pair (All posts / My posts) sits right above the home composer — routes (/ and /mine), not a top-bar item. `/mine` filters the feed to the session member's own roots via a server-side `mine=1` param (identity from the session; guests get 401; bare-id cursor pagination).
- Profile themes (v2.5, migration 0010): profiles may set an accent from a server-side whitelist (`PROFILE_ACCENTS` in api/shared.mjs — forest/coral/gold/sky/violet/rose/teal or default). Values are whitelisted KEYS stored on `users.profile_accent`, applied client-side via per-key CSS classes — no raw CSS, no inline styles. Set via `PATCH /api/me` (`profileAccent`), carried on the profile payload.
- Markdown subset (v2.5): post and reply bodies render **bold**, *italics*, inline `code`, fenced ``` code blocks, `#`-to-`###` headings (h3–h5), `- ` bullet lists, `[links](urls)` (only `http(s)://` or same-origin paths — `javascript:`/`data:` and images `![…]` render as literal text), and the pre-existing `> ` blockquotes. HTML is never interpreted — every body character lands via textContent, so markup stays literal. Snippets/quotes keep raw text.
- Suggestions tab (v2.5): the feed tab pair (All posts / My posts / Suggestions) sits right above the composer on home, /mine, and /suggestions — Suggestions no longer lives only as the header lightbulb.
- Per-user post counter (v2.5): profile payloads carry `postsCount`/`repliesCount` (threads started vs replies written; display-only, unfiltered) shown in the profile heading.
- Mobile PWA (v2.5): the forum installs on phones (manifest.json + apple/mobile-web meta flags + generated PNG icons; standalone display). At ≤640px a bottom app bar (Home / My posts / Suggest / Alerts / Profile-or-Sign-in) replaces the top icon nav, touch targets enlarge, and safe-area insets are respected.
- Milestone badges: profile headings show auto-awarded milestone badges (computation in app.js; display-only) next to flairs.
- Square corners (v2.5, appearance pref): round corners are the default; the account settings panel's "Square corners" checkbox flips the --button-radius token site-wide via a data-corners="square" attribute (client-stored, like the theme).
- GIF marketplace (v2.5): api/gifs.mjs — a shared moderated library (uploads pending; approved-by-hash uploads return the twin with reuse:true) with its moderation desk (GET /api/admin/gifs + approve/reject), serving (`GET /api/gifs/:id`, same hybrid visibility rules as attachments), a lazy grid dialog picker on every composer, and library GIFs attaching to posts/replies BY REFERENCE via `gifIds` (approved rows carry the hash; bytes resolve through canonical lookup; use_count bumps best-effort).
- Content-addressed dedup (v2.5): direct-upload SHA-256 hashes let byte-identical content skip re-moderation, but each direct upload keeps its own chunked bytes so removing another post cannot break it. Library GIFs remain by-reference attachments to the approved GIF library. Migration 0020 materializes bytes for legacy approved duplicate rows.
- Creation retries (migrations 0021, 0024, and 0025): post and reply writes accept an `Idempotency-Key`, bind it to a fingerprint of the submitted text, target/board, and media hashes, and archive the key with deleted posts. Live inserts also guard against archived author/key pairs atomically, so a concurrent delete cannot let a delayed retry resurrect a post. Replaying the same request returns the original post; reusing a key for different content is rejected. Abandoned hidden media uploads can be retried after the staging timeout. New attachment rows preserve library-GIF identity so an exact retry can still be verified after that GIF is revoked or removed. Pre-migration rows do not have that source identity; if their GIF is no longer resolvable, the retry fails closed rather than guessing.
- Custom profile CSS (v2.5): members submit raw CSS (≤20 KiB → POST /api/me/css, lands pending, the approved theme keeps serving); the moderation desk reviews it; the approved theme SERVES as a same-origin stylesheet (GET /api/users/:id/profile.css) pre-scoped by the sandbox (scopeProfileCss: selector prefixing, property allow-list, keyframes passthrough, no @import) — no CSP change; url() loads remain CSP-gated same-origin.
- Weekly leaderboard (v2.5): `GET /api/leaderboard` + the `/leaderboard` page — the top 10 over the trailing 7 days, scored threads×2 + replies + reactions received; banned members excluded; zero-activity members absent; ranks link to profiles.
- Search upgrades (v2.5): `/api/search` gains `by=<username>` (author-filtered post results; unknown names = empty, never an error) and `in=replies` (deep reply-TEXT search — flat results carrying their thread root, gated per row through `canViewPost` so hidden/banned chains can't leak). The classic users+posts shape is unchanged when both params are absent.
- View counter (v2.4.3, raw impressions): every detail read by a non-author adds one view (`posts.view_count`, migration 0009; `UPDATE … RETURNING` keeps the payload's count fresh). The eye chip sits in each card's action row; counts are display-only and affect nothing.
- Posts and replies are capped at 1,000 characters with a live composer counter.
- Replies nest one level (root → reply → reply-to-reply); the feed is sorted by `last_activity_at` (replies bump, reactions do not) with composite `before=<seconds>_<id>` cursors.
- Avatars are moderated: uploads go to a pending set; the previously approved avatar keeps serving until a moderator approves/rejects from the `/api/admin/avatars` queue.
- Accountability archive (v2.4.1): every post deleted by its author or removed by account deletion is copied into `post_archive` first in the same atomic batch and served publicly at `/archive`. Archive entries include the deletion timestamp, reason, and the deleting account's username snapshot; the name remains available even after that account is deleted.
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
