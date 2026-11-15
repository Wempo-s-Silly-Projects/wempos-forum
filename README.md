# Wempo's Forum
This is my forum code:3 Yeah any ways here's how it was made: Cloudflare Workers, Cloudflare D1, and Static Assets. The frontend calls the same-origin `/api/*` endpoints which are handled by `worker.mjs`; posts, replies, reactions, profiles, sessions, reports, and bans stay in the D1 store.
## Requirements

- Node.js 22 or newer (preferably the latest version (as of writing Node.js 25 is EOL, so the only viable option is Node.js 22, 24, or 26 LTS))
- pnpm is preferred
- Access to a Cloudflare account that owns the D1 store `wempo-forum-data`
- Cloudflare Wrangler is installed.

## Local development
1. Install pnpm if you haven't already (if u have skip to step 2)
   ```bash
   npm install corepack
   corepack enable pnpm
   ```
3. Install dependencies:

   ```bash
   pnpm install
   wrangler login
   ```

4. Create a long random setup secret. For local-only development, create a `.dev.vars` file in the repo root:

   ```dotenv
   SETUP_SECRET=
   PASSWORD_PEPPER=
   ```

   Paste seperate and randomly generated values. Use 32–4096 characters for `SETUP_SECRET` and 32–256 for `PASSWORD_PEPPER`. `.dev.vars` is ignored by Git and WILL never be committed. Keep a secure backup of `PASSWORD_PEPPER`; changing or losing it prevents existing accounts from authenticating because it is part of each password hash.

5. Apply the schema to the local D1 store and run the forum:

   ```bash
   pnpm run db:migrate:local
   pnpm run dev
   ```

6. Open the local URL printed by Wrangler. The first-owner setup form stays locked until both `SETUP_SECRET` and `PASSWORD_PEPPER` are configured with valid values. Use the setup secret in the setup form, then sign in normally.

Local development uses a local D1 store by default. The migration does not touch production unless you use the remote migration command.

## Checks

```bash
pnpm run db:migrate:local
pnpm test
wrangler deploy --dry-run
```
