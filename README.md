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

## Signing in: Wempo Accounts

The forum no longer has a sign-in page of its own. Signing in and account
creation start at `accounts.itswempo.workers.dev` (Wempo Accounts): a sign-in
form (username + password, a Turnstile challenge, optional TOTP step) and a
"Make a Wempo Account" lane for new members. The forum keeps its own
`/api/auth/login` and `/api/auth/register` endpoints as internal plumbing
only — API callers and outage escape hatch, no links to them.

How the handoff works:

1. Opening the forum signed-out sends the browser to Wempo Accounts with
   `?return=` the forum's origin (an exact-match origin, never a URL with
   extra bits on it). An existing Accounts session skips the login form and
   goes straight to the ticket.
2. Accounts mints a one-time ticket — a 64-character hex code that lives at
   most 60 seconds (only its hash is ever stored) — and sends the browser
   back as `<forum origin>/?wt=<code>`.
3. The forum worker redeems the ticket over a service binding with the
   Accounts worker (`/api/auth/sso/redeem`, authenticated by the shared
   relay secret) and mints a normal forum session. A burned or refused
   ticket bounces the browser back to Accounts for a fresh one.

Sign-out posts to `/api/auth/logout` and then hands the browser to
`accounts.itswempo.workers.dev/?signout=1` so the Accounts session clears
too (deliberately no `return=` there — an existing Accounts session would
otherwise ticket straight back in). Two things this is not: signing out of
Accounts itself does not retroactively clear the forum's session, and
signing out here ends only the forum session plus the Accounts session —
GooberCord keeps whatever session it already minted.

Trust-wise: one shared D1 (`users`, `sessions`). The password pepper lives
only on the forum worker; Accounts verifies and sets passwords only through
the forum's token-gated credential relay, and a password hash is written or
read only by this worker. The relay token (shared secret on both workers)
is the same credential that authenticates the SSO redeem — it is read only
as an environment secret and never logged.

## License

Source: <https://github.com/Wempo-s-Silly-Projects/wempos-forum>

Copyright (C) 2026 ItsWempo

Wempo's Forum is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

The full license text follows in the COPYING file at the root of this
repository.

Modified versions that let users interact with them over a network must
offer those users the corresponding source of the version they are serving
(GNU Affero General Public License, section 13): a visible link to the
source archive, or the repository above, satisfies this duty.

Copyright 2026 ItsWempo
Copying and distribution of this file, with or without modification, are
permitted in any medium without royalty provided the copyright notice and
this notice are preserved.  This file is offered as-is, without any
warranty.

