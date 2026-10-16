# Forum release checklist

This repository deploys a Cloudflare Worker backed by D1. Treat schema/data reconciliation, numbered migrations, and Worker deployment as separate release steps.

## Before a production release

1. Review the exact commit and confirm test, CodeQL/security, and Worker build checks pass.
2. Confirm that a recoverable backup exists for the intended D1 database.
3. Run the read-only `docs/sql/preflight-production-migration-history.sql` against the exact database ID from `wrangler.toml`. Record its output before running any migration file. If `has_0019_column = 1`, also run `docs/sql/preflight-css-submission-version.sql`; that conditional query must only run after the first preflight confirms the nullable column exists.
4. Compare each schema-ready flag and media count with the expected state. Stop if any schema-ready flag is false, the conditional CSS query reports missing versions, or approved upload aliases lack bytes and another approved attachment source. GIF-backed aliases are intentionally by-reference and must not be materialized as uploads.
5. Only after backup, preflight review, and explicit release approval, use `docs/sql/reconcile-production-migration-history.sql` to record schema effects that are already present. This is a manual recovery script, not a numbered migration; never put it in CI or `migrations/`. Verify its final ledger output contains 0019 through 0023 and investigate any missing marker. If the preflight does not match the currently documented divergence exactly, stop and reconcile the actual schema by hand instead.
6. Once the ledger is verified through `0023_post_archive_deleted_by.sql`, run `npm run db:migrate:remote` to apply numbered migrations 0024 and 0025 in order. Verify the ledger and schema after each migration before proceeding. Do not run the ordinary migration command on a ledger that still ends at 0018: production already contains schema effects from 0021, 0022, and 0023, so replaying those files can fail on duplicate columns or tables.
7. After migration checks pass, deploy the reviewed Worker commit using the normal release procedure. `npm run deploy` deploys code and is not a substitute for migrations.
8. Wait until the new Worker is live and old Worker versions have drained, then run `docs/sql/backfill-late-attachment-aliases.sql` against the intended D1 database. Then run the read-only `docs/sql/audit-unbacked-approved-attachments.sql`; expect zero rows. If it returns rows, investigate and repair them individually before considering the release complete.
9. Smoke-test setup status, session/authentication, feed reads, root/reply creation and exact retries with the same `Idempotency-Key`, changed-payload retries, post deletion/retry behavior, attachment upload/serving/moderation, GIF approval/reapproval, profile customization, and CSS moderation.

## Recorded production discrepancy (October 16, 2026)

The read-only Cloudflare audit found the production ledger ending at `0018_profile_reports.sql`, but its schema already has `users.pending_css_version`, `posts.idempotency_key` and its unique partial index, `revoked_attachment_hashes`, and the two `post_archive` deletion-attribution columns. Preview's ledger includes 0019, while Preview has not received 0020 onward. This is a ledger/schema divergence, not permission to assume each numbered migration ran normally.

Production's `pending_css_version` column is nullable `TEXT`, and no pending CSS submission is missing a version token. The preflight and reconciliation script verify preconditions again. They are for a carefully reviewed maintenance window with a confirmed backup. No production migration, SQL write, or deployment was performed during this audit.

The media audit found two approved attachment records without local approved chunks whose hashes match approved GIF-library rows. These remain by-reference GIF aliases; do not copy GIF bytes into them based solely on the lack of local chunks. The read-only audit for approved uploads lacking any known source returned no unsafe upload aliases. The 37 hidden legacy posts observed during audit were not modified or cleaned up because their intent cannot be safely inferred from visibility alone.

## Preview

Preview uses its own database, `wempo-forum-preview`, and isolated rate-limit namespaces. Apply migrations independently with:

```sh
npm run db:migrate:preview
```

Preview was at migration 0019 during the audit. Apply migrations 0020–0025 with the Preview-only command and confirm its ledger includes the full chain before testing the Preview Worker. Configure Preview-only `SETUP_SECRET` and `PASSWORD_PEPPER` as Cloudflare secrets, not plain `vars`; never reuse production values. Keep the Turnstile allowed-hostname list aligned with the exact Preview hostname.

## Why migration 0020 exists

Earlier content-addressed upload handling could create approved duplicate attachment rows without owning their own bytes. Those rows depended on another approved attachment or marketplace GIF still existing. Migration 0020 copies approved chunks from other approved attachment rows into legacy upload duplicates. It does not copy GIF-library bytes because GIF selections are by-reference. After deployment, run the idempotent late-alias backfill once old Worker versions have drained.
