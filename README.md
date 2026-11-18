# Wempo's Forum

A classic discussion-board forum — boards, threads, posts, reactions,
attachments, leaderboards, bans and appeals — served by a Cloudflare Worker
backed by D1, with a vanilla JS frontend that talks to same-origin `/api/*`
endpoints handled by `worker.mjs`.

- **Live:** <https://wempos-forum.itswempo.workers.dev>
- **Source:** <https://github.com/Wempo-s-Silly-Projects/wempos-forum>

The forum is one of three apps on one shared D1 database and one identity
layer. Signing in happens at [Wempo
Accounts](https://accounts.itswempo.workers.dev): the forum has no sign-in
page of its own. Signed-out visitors bounce to Accounts with `?return=` set
to the forum's origin; Accounts mints a one-time 60-second ticket (only its
hash is stored) and sends the browser back as `?wt=<code>`; the forum
worker redeems the ticket over a service binding and mints a normal forum
session. Sign-out ends the forum session and hands the browser to Accounts
to clear that session too. Password hashes are written and read only by the
forum worker — Accounts verifies and sets passwords through the forum's
token-gated credential relay, and the relay token doubles as the SSO redeem
secret, read only from environment secrets, never logged.

## Features

- Boards, threads, posts, replies, reactions, attachments
- Member profiles, avatars, accent colors, username changes
- Bookmarks, blocks, archive, leaderboard
- Mod tooling: bans, appeals, reports, members admin
- Turnstile at the door, optional TOTP, per-lane rate limiters

## Quick start (local dev)

Requirements: Node.js 22 or newer (22/24/26 LTS), [pnpm](https://pnpm.io),
and a Cloudflare account if you want to bind your own D1 store.

```bash
corepack enable pnpm          # skip if you already have pnpm
pnpm install
```

For local-only development create a `.dev.vars` at the repo root with two
randomly generated secrets (`.dev.vars` is git-ignored and never
committed; keep a backup of `PASSWORD_PEPPER` — losing it means existing
accounts can no longer authenticate):

```dotenv
SETUP_SECRET=
PASSWORD_PEPPER=
```

Use 32–4096 characters for `SETUP_SECRET` and 32–256 for `PASSWORD_PEPPER`.

Apply the schema to the local D1 store and run:

```bash
pnpm run db:migrate:local
pnpm run dev
```

Open the local URL Wrangler prints. The first-owner setup form needs both
`SETUP_SECRET` and `PASSWORD_PEPPER` configured; after setup you sign in
through Wempo Accounts.

Run the checks:

```bash
pnpm test
pnpx wrangler deploy --dry-run
```

Migrations applied without `--remote` stay local; production only moves
under the owner's remote migration ritual.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributing guide.

## License

AGPL-3.0-or-later — see the [LICENSE](LICENSE) file (full text in
[COPYING](COPYING)). If you run a modified version over a network, you owe
your users the source of that version (AGPLv3 section 13).

Copyright (C) 2026 ItsWempo
