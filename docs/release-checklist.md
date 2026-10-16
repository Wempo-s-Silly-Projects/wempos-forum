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

**Release gate for this revision:** the read-only Cloudflare audit on October 16, 2026 found production `wempo-forum-data` at migration `0018_profile_reports.sql`, while Preview had applied migration `0019_css_submission_version.sql`. Do not deploy this revision to production until migrations 0019 and 0020 have been deliberately applied to the intended production database and verified. No production migration or deployment was performed during this audit.

## Preview

Preview points to its own database, `wempo-forum-preview`, and isolated rate-limit namespaces. Apply its migrations independently with:

```sh
npm run db:migrate:preview
```

Confirm Preview's `d1_migrations` includes the full chain before testing the Preview Worker. Configure Preview-only `SETUP_SECRET` and `PASSWORD_PEPPER` as Cloudflare secrets, not plain `vars`; never reuse production values. Keep the Turnstile allowed-hostname list aligned with the exact Preview hostname.

## Why migration 0020 exists

Earlier content-addressed upload handling could create approved duplicate attachment rows without owning their own bytes. Those rows depended on another approved attachment or marketplace GIF still existing. Migration 0020 copies approved chunks into each legacy duplicate, so later deletion of the original item cannot make the duplicate attachment unreadable.
