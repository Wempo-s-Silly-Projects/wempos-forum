# Forum release checklist

This repository deploys a Cloudflare Worker backed by D1. Treat database migrations and Worker code deployment as separate release steps.

## Before a production release

1. Review the exact commit being released and confirm the CI test, CodeQL, and Worker build checks pass.
2. Back up or confirm recoverability of the production D1 database.
3. Apply the committed migration chain to the **production database only after explicitly confirming the target name and ID**:
   `npm run db:migrate:remote`
4. Verify `d1_migrations` records every migration through the highest numbered SQL file in this commit. In particular, CSS moderation code requires `0019_css_submission_version.sql`; legacy approved deduplicated attachments require `0020_materialize_approved_attachment_bytes.sql`; post creation idempotency requires `0021_post_creation_idempotency.sql`; moderator hash revocation requires `0022_revoked_attachment_hashes.sql`.
5. Only after migrations are confirmed complete, deploy the reviewed Worker commit using the normal release procedure. The `npm run deploy` command deploys code and is not a substitute for migrations.
6. Wait until the new Worker is live and old Worker versions have drained, then run `docs/sql/backfill-late-attachment-aliases.sql` against the intended D1 database. This repairs any chunkless duplicate uploads accepted by an old Worker after migration 0020 ran. Do not run it before old versions stop serving requests.
7. Smoke-test setup status, session/authentication, feed reads, post/reply creation and retries with the same `Idempotency-Key`, attachment serving/moderation, profile customization and CSS moderation.

**Release gate for this revision:** the read-only Cloudflare audit on October 16, 2026 found that production's `d1_migrations` ledger ends at `0018_profile_reports.sql`, while Preview includes `0019_css_submission_version.sql`. However, production's `users.pending_css_version` column already exists as nullable `TEXT`, and there are currently no pending CSS submissions that need a version backfill. The production schema and migration ledger are therefore out of sync; the audit cannot determine how the column was added.

**Do not run `npm run db:migrate:remote` blindly.** The runner would try to replay migration 0019 and may fail on its `ALTER TABLE ... ADD COLUMN`. First take a recoverable backup and verify the column metadata plus the pending-row invariant. If they still match the guarded preconditions, run `docs/sql/reconcile-0019-migration-history.sql` manually against the production database and verify the ledger now contains the 0019 marker. If the guarded statement inserts no row unexpectedly, stop and investigate rather than forcing a marker. Then run `npm run db:migrate:remote` to apply migrations 0020–0022, and verify the ledger/schema before deploying this branch. After deployment and old-version drain, run the late-alias backfill above. No production migration or deployment was performed during this audit.

The aggregate audit found one approved legacy attachment row without its own approved chunks and backed only by an approved GIF. Migration 0020 deliberately does not copy GIF bytes into attachment rows because library GIF selections are by-reference. Confirm that row's origin during the release audit; do not bulk-materialize GIF references. If it is verified to be a legacy upload alias, handle it as a documented, individually reviewed repair.

## Preview

Preview points to its own database, `wempo-forum-preview`, and isolated rate-limit namespaces. Apply its migrations independently with:

```sh
npm run db:migrate:preview
```

Preview was already at migration 0019 during the audit. Apply migration 0020 with the Preview-only command above, then confirm Preview's `d1_migrations` includes the full chain before testing the Preview Worker. Configure Preview-only `SETUP_SECRET` and `PASSWORD_PEPPER` as Cloudflare secrets, not plain `vars`; never reuse production values. Keep the Turnstile allowed-hostname list aligned with the exact Preview hostname.

## Why migration 0020 exists

Earlier content-addressed upload handling could create approved duplicate attachment rows without owning their own bytes. Those rows depended on another approved attachment or marketplace GIF still existing. Migration 0020 copies approved chunks from other approved attachment rows into legacy duplicates. It does not copy GIF-library bytes, because GIF selections are by-reference. After deployment, run the idempotent late-alias backfill once old Worker versions have drained.
