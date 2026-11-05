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

- `POST /api/posts/:id/reports`, `GET /api/admin/reports`, `POST /api/admin/reports/:id/resolve`
- `POST /api/users/:id/reports` (profile reports), `GET /api/admin/profile-reports`, `POST /api/admin/profile-reports/:id/resolve`
- `GET /api/admin/bans`, `POST /api/admin/users/:id/bans`, `DELETE /api/admin/users/:id/bans`
- `POST /api/admin/users/:id/promote`, `POST /api/admin/users/:id/demote` (admin only)
- `GET /api/admin/avatars`, `POST /api/admin/avatars/:userId/approve`, `POST /api/admin/avatars/:userId/reject`
- `GET /api/avatars/:userId`
- `GET /api/archive`
- `GET /api/attachments/:id`
- `GET /api/admin/attachments`, `POST /api/admin/attachments/:id/approve`, `POST /api/admin/attachments/:id/reject` (admin only)
- `POST /api/posts` and `POST /api/posts/:id/replies` also accept multipart with image attachments.
- `POST /api/posts/:id/suggestion-status` (staff; resolved/declined/open, suggestions-board roots only)
- `GET /api/admin/vision`, `POST /api/admin/vision-kill-switch` (auto-mod status + kill switch)
- `GET /api/admin/text-mod`, `POST /api/admin/text-mod-kill-switch` (text auto-mod status + kill switch)
- `GET /api/admin/appeals`, `POST /api/admin/appeals/:id/approve`, `POST /api/admin/appeals/:id/deny`; `POST /api/appeals` (session-less ban appeals), `GET/POST /api/me/appeals` (signed-in auto-mod appeals)
- `GET /api/admin/users/search?q=` (member search with active-ban state)
- `GET/POST /api/chat`, `DELETE /api/chat/:id` (staff), `GET /api/admin/chat` (staff chat log)
- `GET/POST /api/dms`, `GET/POST /api/dms/:id`, `DELETE /api/dm-messages/:id` (author or staff), `GET /api/admin/dms` (staff DM log)
- `POST /api/presence` (heartbeat; signed-in)

The backend is split into `api/*.mjs` modules (shared, session, posts, profiles, moderation, notifications, filter, attachments, subscriptions, bookmarks, polls, gifs, leaderboard, rules, appeals, vision, textmod, chat, dms) imported by `worker.mjs`; keep that split when editing — each topic lives in its module.

## Forum behavior notes

- My posts (v2.5): a tab pair (All posts / My posts) sits right above the home composer — routes (/ and /mine), not a top-bar item. `/mine` filters the feed to the session member's own roots via a server-side `mine=1` param (identity from the session; guests get 401; bare-id cursor pagination).
- Profile colors (v2.5 → any-hex, v3.0.2, migration 0010): profiles may set any `#rrggbb` accent and banner color. The server validates the strict hex form (regex — a matched value cannot carry CSS or markup), stores lowercase hex, and legacy palette keys (forest/coral/… banner green/rust/…) still validate on write (converted to their hex) and normalize on read. The client applies the color as a CSS custom property WRITE (`element.style.setProperty`, a CSSOM assignment — not an inline style string), so the CSP stays pure. Set via `PATCH /api/me` (`profileAccent`, `bannerColor`); the editor offers preset swatches plus a native color input.
- Markdown subset (v2.5): post and reply bodies render **bold**, *italics*, inline `code`, fenced ``` code blocks, `#`-to-`###` headings (h3–h5), `- ` bullet lists, `[links](urls)` (only `http(s)://` or same-origin paths — `javascript:`/`data:` and images `![…]` render as literal text), and the pre-existing `> ` blockquotes. HTML is never interpreted — every body character lands via textContent, so markup stays literal. Snippets/quotes keep raw text.
- Suggestions tab (v2.5): the feed tab pair (All posts / My posts / Suggestions) sits right above the composer on home, /mine, and /suggestions — Suggestions no longer lives only as the header lightbulb.
- Per-user post counter (v2.5): profile payloads carry `postsCount`/`repliesCount` (threads started vs replies written; display-only, unfiltered) shown in the profile heading.
- Mobile PWA (v2.5): the forum installs on phones (manifest.json + apple/mobile-web meta flags + generated PNG icons; standalone display). At ≤640px a bottom app bar (Home / My posts / Suggest / Alerts / Profile-or-Sign-in) replaces the top icon nav, touch targets enlarge, and safe-area insets are respected.
- Milestone badges: profile headings show auto-awarded milestone badges (computation in app.js; display-only) next to flairs.
- Square corners (v2.5, appearance pref): round corners are the default; the account settings panel's "Square corners" checkbox flips the --button-radius token site-wide via a data-corners="square" attribute (client-stored, like the theme).
- GIF marketplace (v2.5): api/gifs.mjs — a shared moderated library (uploads pending; approved-by-hash uploads return the twin with reuse:true) with its moderation desk (GET /api/admin/gifs + approve/reject), serving (`GET /api/gifs/:id`, same hybrid visibility rules as attachments), a lazy grid dialog picker on every composer, and library GIFs attaching to posts/replies BY REFERENCE via `gifIds` (approved rows carry the hash; bytes resolve through canonical lookup; use_count bumps best-effort).
- Content-addressed dedup (v2.5): every attachment's SHA-256 rides intake; bytes identical to a previously approved upload store nothing and auto-approve; serving resolves the canonical by hash with a fail-safe 404 when the canonical vanishes.
- Custom profile CSS (v2.5): members submit raw CSS (≤20 KiB → POST /api/me/css, lands pending, the approved theme keeps serving); the moderation desk reviews it; the approved theme SERVES as a same-origin stylesheet (GET /api/users/:id/profile.css) pre-scoped by the sandbox (scopeProfileCss: selector prefixing, property allow-list, keyframes passthrough, no @import) — no CSP change; url() loads remain CSP-gated same-origin.
- Leaderboard (v2.5 weekly → permanent, owner's call): `GET /api/leaderboard` + the `/leaderboard` page — the top 10 of ALL TIME, scored threads×2 + replies + reactions received; banned members excluded; zero-activity members absent; ranks link to profiles.
- Rules page (v2.5): `/rules` renders the owner's site copy (stored in `site_settings`, migration 0026) through the markdown subset; moderators/admins edit it from the desk (`GET/POST /api/rules`). The word filter applies to the rules too (the owner's call — overrides the old site-copy exemption).
- Search upgrades (v2.5): `/api/search` gains `by=<username>` (author-filtered post results; unknown names = empty, never an error) and `in=replies` (deep reply-TEXT search — flat results carrying their thread root, gated per row through `canViewPost` so hidden/banned chains can't leak). The classic users+posts shape is unchanged when both params are absent.
- View counter (v2.4.3, raw impressions): every detail read by a non-author adds one view (`posts.view_count`, migration 0009; `UPDATE … RETURNING` keeps the payload's count fresh). The eye chip sits in each card's action row, boxed like the action buttons (the same chip box as the reply-count); counts are display-only and affect nothing.
- Posts and replies are capped at 1,000 characters with a live composer counter.
- Replies nest one level (root → reply → reply-to-reply); the feed is sorted by `last_activity_at` (replies bump, reactions do not) with composite `before=<seconds>_<id>` cursors.
- Avatars are moderated: uploads go to a pending set; the previously approved avatar keeps serving until a moderator approves/rejects from the `/api/admin/avatars` queue.
- Accountability archive (v2.4.1): every post deleted by its author or wiped by an account deletion is copied into `post_archive` first (same atomic batch) and served publicly at `/archive` — deletion is never a way to scrub words (rooman98's ask).
- Banning auto-hides posts (v2.4.1): an active ban hides all of that author's content at read time — feed (both boards), replies, detail (hidden-post visibility semantics: author and admins pass; moderators follow `canViewPost`), and edit history. It is read-time only, so unpinning, expiring, or revoking a ban restores the posts without any write.
- Banned-profile banner (v3.1): the public profile payload (`GET /api/users/:username`) carries `banned` + `banExpiresAt` for actively banned members (the same active-ban predicate as every read path); `banReason` rides only for staff viewers, like member search. The client renders a "This user is banned" strip (coral callout, matching the ban screen) under the profile heading — with a reactivation countdown for timed bans and the reason for staff.
- A curated word filter runs on ALL stored member-written text from the `FILTERED_WORDS` secret (comma-separated; `wrangler secret put FILTERED_WORDS` in production, an entry in `.dev.vars` locally; unset = filter off). See `config/filtered-words-template.txt`. Covered: posts/replies (create + edit), bios, flairs, banner text, poll questions/labels, post-report + profile-report reasons, ban/unban reasons, custom profile CSS, appeal bodies, chat messages, DM messages, and the rules (site copy — owner's call). Social handles and usernames are IDENTITY, not prose: they are rejected (400) rather than masked, using the register flow's checks (masked form must survive intact + the stitched/leet-normalized form must contain no entry).
- Filter hardening (v3.1, bypass-proofing): the filter is BYPASS-RESISTANT — the v2.5 exact whole-word pass is unchanged (byte-for-byte), plus skeleton passes over a normalized form that strips zero-width characters, combining marks (NFKD), maps Cyrillic/Greek homoglyphs and leet (@→a, $→s, 0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b, 9→g), drops soft punctuation, and keeps whitespace as separators. Masking is SUBSTRING over the skeleton (compounds like "badass" mask — the aggressive-substring trade: innocent carriers like "class" can mask too, documented in the template, owner's call) with elongation-tolerant regexes (single letters → `letter+`, runs ≥2 → `letter{n,}`, so "hasss" matches "ass" while "as" never does), a delete-1 scramble pass for entries ≥4 letters ("fusckers"→mask), and stitching of consecutive ≤2-skeleton-char tokens ("fu c c kk" masks only the spanning tokens; multi-char tokens break runs, so "pen is" never becomes "penis"). Everything is length-preserving (#-masking, one shared buffer). REGEX ENTRIES (owner's ask): an entry wrapped in slashes (`/\bazz?hole\b/`) compiles as a regex — forced `g`, run against both the lowercased original (span-mapped back) and the skeleton, invalid patterns silently dropped to literals, literal commas written `\x2c`. No real vocabulary is ever committed — tests and the template use synthetic words only (owner's GitHub-account requirement).
- Banned accounts see a dedicated ban screen on failed sign-in with the ban reason and (for temporary bans) a reactivation countdown. Timed bans (v3.0.2): every ban form on the desk (post-report queue and profile-report queue) carries a duration picker (permanent / 1 day / 3 days / 7 days / 30 days); `POST /api/admin/users/:id/bans` accepts an optional `expiresAt` epoch-seconds field validated to between a minute and a year out. Before v3.0.2 the write path never set `expires_at`, so every ban was permanent regardless of intent. Profile-report items also carry the same ban form (they used to be resolve-only).
- A theme toggle switches between light and dark; the choice is stored client-side and persists across reloads.
- Edit history (v2.4.1): every edit snapshots the replaced version into `post_edits` (the first edit preserves the original); the "(edited)" marker gains a public "history" toggle (`GET /api/posts/:id/edits`) so past versions are viewable by anyone who can view the post (per `canViewPost`; hidden posts stay author+admin for history too). Edits can't quietly rewrite context.
- Thread presentation (v2.3): feed cards show a reply-count chip and up to 3 single-line latest-reply previews; sub-replies render cascade-styled on the detail view; a Quote button prefills `> @user: text` into the reply composer and leading `> ` lines render as blockquotes; profile social links collapse into an expandable block.
- Thread subscriptions (v3.0 C1): the subscribe toggle is icon-only (bell ↔ bell-check, like the bookmark toggle) and shows on the DETAIL root AND on feed cards — `withSubscriptionFlags` (api/subscriptions.mjs) batch-decorates feed root rows with the viewer's `subscribed` flag, mirroring `withBookmarkFlags`; the header nav's icon buttons sit at the same gap rhythm as the rest of the header (0.8rem).
- Categories (v3.1, Discourse-style): the board whitelist grew to `general` / `game-dev` / `showcase` / `help` / `suggestions` / `updates` (BOARD_VALUES in api/posts.mjs — the handler layer is the whitelist; there is no DB CHECK). Routes are `/c/<slug>` (with `/suggestions` kept as an alias); the tab pair above the composer is the navigation on home, /mine, and every category page. The no-board GET /api/posts is the "Recent activity" homepage — every category mixed; `?board=<slug>` scopes the feed to that category (activity order + composite cursor, except suggestions: score-sorted). Old posts already read `general`, so they landed in General with no migration. **Updates is a staff-only-topics category**: everyone reads and replies, but POST /api/posts with board=updates 403s members (the composer is hidden for them there). **Suggestions are a special post type**: staff mark threads resolved/declined/reopen (`POST /api/posts/:id/suggestion-status`; columns from migration 0031), the badge chips the card header, and the board sorts by net reaction score (likes minus dislikes, id tiebreak, `before=<score>_<id>` cursor; score instability across page turns accepted). The home composer picks its category with a select; category composers are locked to their category.
- Roles (v3.1 rename): user-facing tiers are member/admin/owner, but the STORED role values are frozen at `member`/`moderator`/`admin` (D1 can't alter CHECK constraints without a full table rebuild). `publicRole()` in api/shared.mjs maps stored→public (`moderator`→`admin`, `admin`→`owner`) at every SQL exit point; writes and SQL literals use the stored vocabulary via `ROLE_OWNER_DB="admin"`/`ROLE_ADMIN_DB="moderator"`. WARNING: publicRole is NOT idempotent — publicRole('admin')='owner' — so only ever feed it raw DB values. Post cards and profiles chip Owner/Admin badges next to the name (`.role-badge`).
- Auto-mod (v3.1, Google Vision): every fresh pending image upload (attachments, avatars, GIFs) gets a background SAFE_SEARCH check via `ctx.waitUntil` (`scheduleVisionCheck` in api/vision.mjs — the upload response never waits on Google). adult or violence at LIKELY+ auto-removes the pending upload, records a `moderation_actions` row, and notifies the member; racy/spoof/medical are display-only. REPORT-TRIGGERED RE-CHECK (v3.1): a filed post report (`POST /api/posts/:id/reports`) sweeps EVERY image on that post — approved attachments and library-GIF reference rows included, bytes resolved through the same canonical fallback as serving — and a profile report (`POST /api/users/:id/reports`) sweeps both avatar sets (approved + pending mirror); a trip on LIVE content removes it (approved attachments DELETE with a status guard, the approved avatar blanks, the pending mirror clears like intake), same `moderation_actions` row so it appeals through the same page and an approval allowlists the hash. Dedup twins share one Vision call per sweep. OCR (v3.1, owner's ask): the SAME annotate call requests TEXT_DETECTION, and the embedded text goes through `evaluateExtractedText` (api/textmod.mjs) — the word filter always (a filtered word inside the pixels is a filtered word), then the OpenAI moderation classifier when configured; a trip removes the image through the identical action/appeal path as a SafeSearch trip, and when both trip the SafeSearch reason wins. The API key rides the `x-goog-api-key` HEADER (never `?key=` — URLs land in logs) and lives ONLY in the `GOOGLE_VISION_API_KEY` secret. Fail-open: a Vision error stores an error row and never removes anything. The KILL SWITCH is a `site_settings` row (`vision_kill_switch`) flipped from the admin desk — no redeploy, effective on the next upload or report, and INDEPENDENT of the key: adding/rotating/deleting the key secret can never reset a tripped switch (owner's explicit requirement).
- Text auto-mod (v3.1, owner's ask: "moderate the forum while mods are asleep"): api/textmod.mjs scores every fresh piece of member text in the background — posts/replies (create + edit) via `scheduleTextCheck` after the write commits, chat messages, DM messages — with the OpenAI Moderation API (`omni-moderation-latest`; the engine was first sketched on Google Perspective, which sunsets entirely 2026-12-31, so only `fetchModerationVerdict` knows the engine — a swap touches that one function). The verdict is OpenAI's own calibrated `flagged`; every category comes enabled by default; no local threshold bars to drift. Posts/replies AUTO-HIDE (`visibility='hidden'`, guarded to still-public rows — never a delete; the hidden-posts desk and an approved appeal restore in one click); chat/DM rows delete (chat has no hidden state — same permanence as staff deletion). One live `moderation_actions` row per entity (kind `auto_text`, verdicts = the flagged categories with scores), a notification tells the member to appeal, and the appeal path is the SAME one image removals use (`GET/POST /api/me/appeals`; approving a post action unhides). Fail-open on any classifier error (content stays up, no row); the kill switch is its own `site_settings` row (`text_mod_kill_switch`, `GET /api/admin/text-mod` + `POST /api/admin/text-mod-kill-switch` from the desk's Auto-mod panel section) — separate from Vision's and independent of the key. The key lives ONLY in the `OPENAI_API_KEY` secret and rides the Authorization Bearer header.
- Appeals (v3.1): auto-mod removals are appealable signed-in (`GET/POST /api/me/appeals`, one appeal per action, 30-day window); bans are appealable from the ban screen WITHOUT a session (`POST /api/appeals` with username + password proof). Approving an auto-mod IMAGE appeal reverses the action and allowlists the image hash (`auto_mod_overrides`) so a re-upload is never re-flagged; approving an auto-mod TEXT appeal reverses the action and, for posts, unhides in the same batch (chat/DM deletions stay gone — the reversal clears the record); approving a ban appeal revokes the ban (posts restore via the read-time hide) and clears that ban's IP-ban rows. One appeal per action/ban (UNIQUE constraints); the desk queue is `GET /api/admin/appeals`.
- IP bans (v3.1, Pone's ask): opt-in per ban (`ipBan` flag on the ban form) — copies the member's known IP hashes into `banned_ips`, refusing sign-in and registration from those networks. Raw IPs are NEVER stored: `CF-Connecting-IP` is HMAC-SHA-256'd over PASSWORD_PEPPER (`requestIpHash`); `known_ips` records hashes best-effort at each sign-in. Unban and ban-appeal approval delete that ban's rows. The network check runs before credential work (no ban oracle). Shared connections (school/home NAT) are blocked too — the form says so.
- Member search (v3.1): `GET /api/admin/users/search?q=` — staff find members by username with active-ban state and reason attached, plus an unban form right in the results.
- Live chat + DMs + presence (v3.1, Desen's ask): polling-based (no Durable Objects). The chat panel (slide-over, header chat button) has a Room/DMs tab pair. The room is one public stream (`GET/POST /api/chat`, guests read; 500-char cap; word-filtered; messages by actively banned members vanish at read time). DMs are 1:1 threads (`dm_threads` keyed by canonical UNIQUE participant pair; started from a profile's Message button; 1000-char cap; author-or-staff deletable). SAME SCRUTINY AS POSTS (owner's explicit call): the desk carries the full chat log (`GET /api/admin/chat`) and DM log (`GET /api/admin/dms`) — banned authors included, both participants named per DM — with in-place deletion; chat/DM deletion is permanent (no archive — posts are the record, chat is the hallway). Online counter: D1 heartbeats (`POST /api/presence`, 60s client tick; 3-minute window); INVISIBLE MODE lurks — the member keeps heartbeating but is excluded from the public count (client-stored toggle, rides every heartbeat).
- Author post editing (v2.4): `PATCH /api/posts/:id` is author-only (any role, covers roots and replies), reapplies the word filter and the 1,000-character limit, stamps `edited_at` (shown as an "(edited)" marker), and never bumps `last_activity_at`; edits are text-only, so attachments stay as originally posted.
- Edit history (v2.4.1): `GET /api/posts/:id/edits` is public to anyone who can view the post; every edit stores the replaced version in `post_edits` (the first edit snapshots the original), surfaced as a "history" toggle next to the "(edited)" marker.
- Author post deletion: `DELETE /api/posts/:id` is author-only (session identity, no role path; delete button on own cards behind a confirm dialog). Deleting a ROOT post deletes the entire thread — every reply (other people's included) plus its reactions, reports, notifications, and attachments, all via foreign-key cascades. Deleting a REPLY preserves the conversation: its sub-replies are reparented to the thread root in the same atomic batch before the delete, so no one else's content is lost.
- Account deletion: `POST /api/me/delete` lets a signed-in member permanently delete their own account (Delete account control in the signed-in account settings, behind a confirm dialog that spells out the blast radius). Everything the account owns goes: their posts — and the whole threads they started, including other people's replies inside those threads — their replies inside other people's threads, reactions, reports they authored, notifications, bans on them, all sessions, and their avatar. Bans/reports they acted on as a moderator survive with the actor columns cleared. Other members' own threads are untouched.

### Image attachments

- Post and reply composers accept up to 3 images, 10 MiB max each; JPEG, PNG, WebP, and GIF are accepted by magic-byte sniffing.
- Intake sanitization (polyglot/metadata defense): every image upload (attachments, gallery images, avatars) is structurally parsed by `sanitizeImage` in api/shared.mjs — JPEG APPn/COM segments (EXIF/XMP/comments), PNG `tEXt`/`zTXt`/`iTXt`/`eXIf`/`tIME` chunks, GIF comment/plain-text extensions, and WebP EXIF/XMP chunks are stripped; bytes after the format's logical end (IEND/EOI/trailer/RIFF size) are truncated; a file that never reaches its end marker 400s even though its prefix sniffs clean. Kept bytes pass through verbatim (CRCs, animation extensions, color profiles intact) — no re-encode, no WASM. Dedup hashes are computed on the SANITIZED bytes, so the same image with junk appended dedups to the same canonical hash.
- Egress re-verification: every image serving path (attachments, gallery, avatars) re-sniffs the stored bytes against the row's claimed MIME via `imageResponse` — a mismatch fails safe to that route's 404 — and serves with a sniffed `Content-Type`, `X-Content-Type-Options: nosniff`, and `Content-Disposition: inline; filename="image"`.
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
- IP bans store keyed HMAC-SHA-256 hashes of `CF-Connecting-IP` (over `PASSWORD_PEPPER`) — raw IPs are never persisted; `known_ips` records them best-effort at sign-in and `banned_ips` blocks networks only for bans that opted in.
- The Google Vision key lives only in the `GOOGLE_VISION_API_KEY` secret (`.dev.vars` locally, `wrangler secret put` in production), is sent as a request HEADER (never a query parameter), and never gates the kill switch — the switch is durable D1 state the desk controls.
- The OpenAI moderation key lives only in the `OPENAI_API_KEY` secret (`.dev.vars` locally, `wrangler secret put` in production) and is sent as the Authorization Bearer header; it gates text auto-mod configuration only — the text kill switch is durable D1 state the desk controls, exactly like Vision's.
- API body sizes, username/password/post/bio/report limits, image magic bytes, and request rates are checked server-side. Cloudflare Rate Limiting bindings enforce limits without a D1 write for every request.
- JSON/API responses and static assets include security headers and a restrictive Content Security Policy.

### Avatar and attachment storage

R2 is not enabled on the connected Cloudflare account right now, so this version stores validated image bytes in D1: avatars (JPEG, PNG, WebP) with a hard 1 MiB per-image limit, and post/reply attachments (JPEG, PNG, WebP, GIF) up to 10 MiB each, chunked across `attachment_chunks` rows because D1 caps a single BLOB/row at ~2 MB. This is suitable as a simple initial backend, not an ideal large-scale media store. The phased migration path to R2 (for when the account has it) is written out in `docs/r2-migration.md` — enable, backfill, switch writes, switch reads, cleanup, each independently reversible — and `wrangler.toml` carries the commented `[[r2_buckets]]` binding.

## Checks

```bash
npm run db:migrate:local
npm test
wrangler deploy --dry-run
```

Run local browser smoke tests for registration/login, posting/replies, reactions, reports, banning/unbanning, password changes, avatar uploads, logout, and reload persistence before opening this to other users. Do not consider the forum production-ready solely because unit tests pass.
