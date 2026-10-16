# Forum release checklist

This repository deploys a Cloudflare Worker backed by D1. Treat database migrations and Worker code deployment as separate release steps.

## Before a production release

1. Review the exact commit being released and confirm the CI test, CodeQL, and Worker build checks pass.
2. Back up or confirm recoverability of the production D1 database.
3. Apply the committed migration chain to the **production database only after explicitly confirming the target name and ID**:
   `npm run db:migrate:remote`
4. Verify `d1_migrations` records every migration through the highest numbered SQL file in this commit. In particular, CSS moderation code requires `0019_css_submission_version.sql`; legacy approved deduplicated attachments require `0020_materialize_approved_attachment_bytes.sql`.
5. Only after migrations are confirmed complete, deploy the reviewed Worker commit using the normal release procedure. The `npm run deploy` command deploys code and is not a substitute for migrations.
6. Smoke-test setup status, session/authentication, feed reads, post/reply creation, attachment serving, profile customization and CSS moderation.

**Release gate for this revision:** the read-only Cloudflare audit on October 16, 2026 found that production's `d1_migrations` ledger ends at `0018_profile_reports.sql`, while Preview includes `0019_css_submission_version.sql`. However, production's `users.pending_css_version` column already exists as nullable `TEXT`, and there are currently no pending CSS submissions that need a version backfill. The production schema and migration ledger are therefore out of sync; the audit cannot determine how the column was added.

**Do not run `npm run db:migrate:remote` blindly.** The runner would try to replay migration 0019 and may fail on its `ALTER TABLE ... ADD COLUMN`. First take a recoverable backup and verify the column metadata plus the pending-row invariant. If they still match the guarded preconditions, run `docs/sql/reconcile-0019-migration-history.sql` manually against the production database and verify the ledger now contains the 0019 marker. If the guarded statement inserts no row unexpectedly, stop and investigate rather than forcing a marker. Then run `npm run db:migrate:remote` to apply migration 0020, and verify both ledger entries/schema before deploying this branch. No production migration or deployment was performed during this audit.

The aggregate audit found one approved legacy attachment alias without its own approved chunks, backed only by an approved GIF. Migration 0020 materializes the bytes for that row so that attachment no longer depends on another row's lifecycle.

## Preview

Preview points to its own database, `wempo-forum-preview`, and isolated rate-limit namespaces. Apply its migrations independently with:

```sh
npm run db:migrate:preview
```

Preview was already at migration 0019 during the audit. Apply migration 0020 with the Preview-only command above, then confirm Preview's `d1_migrations` includes the full chain before testing the Preview Worker. Configure Preview-only `SETUP_SECRET` and `PASSWORD_PEPPER` as Cloudflare secrets, not plain `vars`; never reuse production values. Keep the Turnstile allowed-hostname list aligned with the exact Preview hostname.

## Why migration 0020 exists

Earlier content-addressed upload handling could create approved duplicate attachment rows without owning their own bytes. Those rows depended on another approved attachment or marketplace GIF still existing. Migration 0020 copies approved chunks into each legacy duplicate, so later deletion of the original item cannot make the duplicate attachment unreadable.
