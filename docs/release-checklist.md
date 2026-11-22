# Release checklist

The forum is one Cloudflare Worker backed by one D1 database. A release has two separate parts: **database migrations** and **the code deploy**. Deploying code never applies migrations, and migrating never deploys code.

## Before you release

1. Know exactly which commit you're shipping, and make sure `pnpm test` passes on it.
2. Make sure there's a recoverable backup of the production database (`wempo-forum-data`). D1 Time Travel covers this, but check you can restore before you change anything.
3. Look at what's new in `migrations/` since the last release. If there's nothing new, skip to the deploy.

## Applying migrations

1. Check which migrations production has already recorded. Look for each new migration **by name** in the `d1_migrations` table; don't go by the row count alone.
2. Apply the new ones:

   ```sh
   pnpm run db:migrate:remote
   ```

3. Check by name again that every new migration is now recorded, and spot-check that the schema changes (new tables or columns) are really there.

Migrations are numbered and run in order. Never edit a migration that has already shipped; add a new one instead.

## Deploying the code

```sh
pnpm run deploy
```

Always use this script, never a bare `wrangler deploy`. It stamps the build with the commit hash (`COMMIT_SHA`), which `/api/version` reports and which the browser uses to load fresh scripts. Without it, `/api/version` shows an empty commit and visitors can keep running stale code.

If a migration and a code change depend on each other, migrate first, then deploy.

### Reproducing the build

The only built file is the worker bundle. Wrangler makes it from the source
with esbuild, and the browser files in `public/` ship exactly as written.
The tool versions are pinned in `pnpm-lock.yaml`, so anyone can rebuild a
release and compare the result:

```sh
git checkout v5.30.0
pnpm install --frozen-lockfile
pnpm exec wrangler deploy --dry-run --outdir build-a
pnpm exec wrangler deploy --dry-run --outdir build-b
shasum -a 256 build-a/worker.js build-b/worker.js   # the two hashes match
```

Building from the same commit and lockfile gives a byte-identical
`worker.js`. Two things differ between builds, and neither is part of the
deployed code: the `sourceRoot` in `worker.js.map` (it records the output
folder) and the timestamp in the generated `README.md`. The build doesn't
stamp the commit hash into the bundle. `pnpm run deploy` passes it as the
`COMMIT_SHA` variable at deploy time instead.

## After you deploy

1. Open `https://wempos-forum.com/api/version` and confirm `commit` matches the commit you shipped.
2. Smoke-test the basics: sign in through Wempo Accounts (<https://accounts.wempos-forum.com>), read the feed, post a thread and a reply, upload an image, react, open the chat panel, and load a profile.
3. If you're staff, open the moderation desk and check the report and appeal queues load.

## Preview environment

There's a separate `preview` environment in `wrangler.toml` with its own database (`wempo-forum-preview`) and its own rate-limit namespaces, so it never touches production data.

```sh
pnpm exec wrangler d1 migrations apply wempo-forum-preview --env preview --remote
pnpm run deploy -- --env preview
```

Preview needs its own `SETUP_SECRET`, `PASSWORD_PEPPER`, and `TURNSTILE_SECRET`, set as Cloudflare secrets for that environment. Never reuse the production values.

## The scripts in `docs/sql/`

These are one-off, hand-run SQL scripts from an October 2026 repair, when production's migration history had drifted from its real schema. They are **not** migrations: never put them in `migrations/` or run them from CI.

- `preflight-production-migration-history.sql`, `preflight-css-submission-version.sql`: read-only checks of migration history and schema.
- `reconcile-production-migration-history.sql`, `reconcile-0019-migration-history.sql`: record migrations whose schema changes were already present. Only run these after a backup, and only if a preflight shows exactly that drift.
- `backfill-late-attachment-aliases.sql`: copies image bytes into duplicate attachment rows that were missing their own. Safe to re-run.
- `audit-unbacked-approved-attachments.sql`: read-only. It should return zero rows.

You shouldn't need any of them for a normal release.
