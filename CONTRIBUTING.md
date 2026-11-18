# Contributing to Wempo's Forum

Thanks for wanting to help. The forum is a Cloudflare Worker (vanilla
imperative JS, no frontend framework, no build step) with a D1 database, so
the setup is light.

## Setup

1. Install [pnpm](https://pnpm.io) (the only package manager this repo
   uses — never `npm`/`npx`):

   ```bash
   corepack enable pnpm
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. For local-only development, create a `.dev.vars` file at the repo root.
   Generate separate random values: 32–4096 characters for `SETUP_SECRET`
   and 32–256 for `PASSWORD_PEPPER`:

   ```dotenv
   SETUP_SECRET=
   PASSWORD_PEPPER=
   ```

   `.dev.vars` is git-ignored and never committed. Keep a secure backup of
   `PASSWORD_PEPPER`: changing or losing it prevents existing accounts from
   authenticating, because it is part of every password hash.

4. Apply the schema to the local D1 store and run the forum:

   ```bash
   pnpm run db:migrate:local
   pnpm run dev
   ```

5. Open the local URL Wrangler prints. The first-owner setup form stays
   locked until both secrets are configured with valid values; use the
   setup secret in the form, then sign in through Wempo Accounts.

Local development uses a local D1 store by default; migrations applied
without `--remote` never touch the production database.

## Tests

The suite is `node --test`, wired as `pnpm test`. Some suites pin vendored
modules byte-for-byte and keep the shared-table SQL in contract parity with
the sibling repos; run the whole suite before you push, not just one file:

```bash
pnpm test
pnpx wrangler deploy --dry-run
```

## Ground rules

- **AGPL-3.0-or-later.** By contributing you agree your work is licensed
  under the same license as the repo (see [LICENSE](LICENSE)).
- **Vanilla imperative JS.** No new frameworks, no build pipeline. Vendored
  verbatim files are byte-parity pins — never edit them by hand.
- **Migrations are append-only.** Add a new numbered migration; never edit
  an applied one.
- **Secrets stay out.** No keys, peppers, or tokens in code or commits;
  secrets ride `.dev.vars` or environment bindings only.
- The house code style favors small files, early returns, immutable data,
  and named constants over magic numbers.

## Commit format

Conventional, one line:

```
<type>: <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

## Issues

Open a GitHub issue on
<https://github.com/Wempo-s-Silly-Projects/wempos-forum> with what you
did, what you expected, and the actual result. Security reports: please
use a private channel rather than a public issue.
