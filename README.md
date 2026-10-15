# Wempo's Forum

A small, server-backed forum using Cloudflare Workers, D1, and static assets. The existing frontend calls the same-origin `/api/*` endpoints handled by `worker.mjs`; posts, replies, reactions, profiles, sessions, reports, and bans persist in D1.

## Requirements

- Node.js 22 or newer
- Access to the Cloudflare account that owns the D1 database `wempo-forum-data`
- Wrangler login (`npx wrangler login`)

## Local development

1. Install dependencies:

   ```sh
   npm install
   npx wrangler login
   ```

2. Create a long random setup secret (at least 32 characters) with a password manager. For local-only development, create a `.dev.vars` file in the repository root:

   ```dotenv
   SETUP_SECRET=
   PASSWORD_PEPPER=
   ```

   Paste separate, randomly generated values after each equals sign. Use 32–4096 characters for `SETUP_SECRET` and 32–256 for `PASSWORD_PEPPER`. `.dev.vars` is ignored by Git and must never be committed. Keep a secure backup of `PASSWORD_PEPPER`; changing or losing it prevents existing accounts from authenticating because it is part of each password hash.

3. Apply the schema to the local D1 database and run the app:

   ```sh
   npm run db:migrate:local
   npm run dev
   ```

4. Open the local URL printed by Wrangler. The first-admin setup form stays locked until both `SETUP_SECRET` and `PASSWORD_PEPPER` are configured with valid values. Use the setup secret only in the setup form, then sign in normally.

Local development uses a local D1 database by default. The migration does not touch production unless you explicitly use the remote migration command.

## Deploy

The Wrangler configuration is already pointed at the account's existing D1 database, `wempo-forum-data`. Before deployment, confirm that the database ID in `wrangler.toml` matches the database you intend to use.

1. Set both secrets for the deployed Worker (Wrangler prompts for each value):

   ```sh
   npx wrangler secret put SETUP_SECRET
   npx wrangler secret put PASSWORD_PEPPER
   ```

   Use separate random values for local and production. Back up `PASSWORD_PEPPER` securely and never rotate it after accounts exist without a password-hash migration; losing it prevents those accounts from authenticating.

2. Apply the migration to the remote database only after reviewing it:

   ```sh
   npm run db:migrate:remote
   ```

3. Deploy:

   ```sh
   npm run deploy
   ```

Never run the remote migration against a database that contains data you do not intend this forum to use. The migration creates tables and indexes but does not create or promote an account by itself.

## API coverage

- `GET /api/session`, `GET /api/setup/status`
- `POST /api/setup`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/posts`, `GET /api/posts/:id`, `POST /api/posts`, `POST /api/posts/:id/replies`
- `PUT /api/posts/:id/reaction`, `GET /api/search`, `GET /api/users/:username`
- `PATCH /api/me`, `POST /api/me/avatar`, `PATCH /api/me/password`
- `POST /api/posts/:id/reports`, `GET /api/admin/reports`, `POST /api/admin/reports/:id/resolve`
- `GET /api/admin/bans`, `POST /api/admin/users/:id/bans`, `DELETE /api/admin/users/:id/bans`
- `GET /api/avatars/:userId`

## Security notes

- Passwords use per-account random salts, a deployment-held HMAC pepper, and PBKDF2-HMAC-SHA-256; plaintext passwords are never persisted. PBKDF2 is capped at 100,000 iterations to stay within the Cloudflare Workers Web Crypto implementation's iteration ceiling. This is a platform-constrained tradeoff versus higher PBKDF2 work factors on traditional servers, partially offset by the pepper and rate limits.
- Session IDs are cryptographically random, only their SHA-256 hashes are stored, and browser cookies are HttpOnly and SameSite=Lax. HTTPS responses set Secure.
- State-changing requests require the exact same Origin plus a CSRF token tied to the session.
- The first administrator requires the out-of-band `SETUP_SECRET`; a database uniqueness constraint prevents duplicate administrator accounts.
- Cloudflare rate-limit bindings are location-local and eventually consistent, so limits are abuse controls rather than exact accounting. Report creation, avatar uploads (5/minute), and reactions (30/minute) also have per-account limits in addition to the broader per-IP write limit.
- SQL values are parameterized, roles are checked server-side, and hidden posts/moderator endpoints enforce access checks.
- API body sizes, username/password/post/bio/report limits, image magic bytes, and request rates are checked server-side. Cloudflare Rate Limiting bindings enforce limits without a D1 write for every request.
- JSON/API responses and static assets include security headers and a restrictive Content Security Policy.

### Avatar storage

R2 is not enabled on the connected Cloudflare account right now, so this first version stores validated JPEG, PNG, and WebP avatar bytes in D1, with a hard 1 MiB per-image limit. This is suitable as a simple initial backend, not an ideal large-scale media store. Move avatar objects to an R2 bucket before growing the forum or accepting larger uploads.

## Checks

```sh
npm run db:migrate:local
npm test
npx wrangler deploy --dry-run
```

Run local browser smoke tests for registration/login, posting/replies, reactions, reports, banning/unbanning, password changes, avatar uploads, logout, and reload persistence before opening this to other users. Do not consider the forum production-ready solely because unit tests pass.
