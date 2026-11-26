# Roadmap

What the project means to work on from **November 2026 through November
2027**, and what it has decided **not** to do. This is a plan, not a
promise. Priorities can change, and I will update this file
when they do. Shipped work is listed in [CHANGELOG.md](CHANGELOG.md).

## Goals for the next 12 months

1. **Keep the forum safe and private.** Security reviews of each batch of
   releases continue (see [docs/security-reviews/](docs/security-reviews/)).
   Static and dynamic analysis stays in CI, and the
   [assurance case](docs/assurance-case.md) gets updated whenever the design
   changes.
2. **Make self-hosting easier.** Anyone should be able to run their own copy
   with their own branding and sign-in settings, with optional extras staying
   optional. See [docs/self-hosting.md](docs/self-hosting.md).
3. **Move images out of the database.** Image bytes currently live in D1. The
   plan to move them to Cloudflare R2 is in
   [docs/r2-migration.md](docs/r2-migration.md) (not started yet).
4. **Better translations and accessibility.** Keep improving the 41
   interface languages through community translation, and keep working
   toward WCAG 2.x: keyboard use, screen readers and contrast.
5. **Reduce the bus factor.** Find a second trusted maintainer and write a
   documented hand-over of the hosting credentials, as
   [GOVERNANCE.md](GOVERNANCE.md#continuity-and-bus-factor) describes.
6. **Raise test coverage.** Get statement coverage above 90% (it's about 89%
   today) while keeping branch coverage above 80%.
7. **Keep up with the community.** Fix bugs and build the features people ask
   for in the forum's **Suggestions** board and in GitHub issues.

## Progress since this plan was written

This plan was written at v5.30. Up to v5.63.1:

- **Goal 1 (safe and private):** security reviews covered v5.28 to v5.31 and
  every batch from v5.33 to v5.60 (written up in
  [docs/security-reviews/](docs/security-reviews/)), and whole-forum privacy
  audits ran at v5.32, v5.42, v5.52 and v5.62, each recorded in
  [docs/visibility-inventory.md](docs/visibility-inventory.md).
- **Goal 2 (self-hosting):** the new optional switches (`ANALYTICS_ENABLED`,
  `AUTOMOD_ENABLED`, `OG_IMAGE_URL`) ship off or empty in
  `wrangler.example.toml` and are documented in
  [docs/self-hosting.md](docs/self-hosting.md).
- **Goal 3 (images out of the database):** not started.
- **Goal 4 (translations and accessibility):** new strings ship in all 41
  languages; easy-reading spacing, a fix for the "Skip to content" link and an
  accessibility pass over the reorganized thread page, settings and menus
  shipped.
- **Goal 7 (community requests):** shipped, among others: share buttons, RSS
  feeds, invite links, the This week page, staff picks, following members,
  bookmark folders, custom status, poll closing times, notification types,
  thread tags, muting threads, private notes, saved searches, thread TL;DRs,
  thread locks and slow mode, plus a settings page and tidier navigation.
  The full list is in [CHANGELOG.md](CHANGELOG.md).
- Goals 5 and 6 have no change to report.

Since 2026-11-22 I have paused new features. A list of features
that overlap or are hard to find, with options for each will be ready soon: [docs/trim-list.md](docs/trim-list.md). Nothing on it has
been decided.

## Non-goals (what we will not do)

- **No ads, trackers or selling data.** We collect as little as we
  can, and nothing that sends data to a third party is ever turned on by
  default. The private visit counts keep daily totals only (no IP address,
  account, cookie or record of single visits), and Do Not Track and Global
  Privacy Control turn them off for that browser.
- **No framework, bundler or build step on the browser side.** The browser
  runs the files in `public/js/` exactly as written, as plain JavaScript
  modules.
- **No other storage platforms.** Data stays in Cloudflare D1, with R2 for
  images. There are no plans for KV or an outside database.
- **No old versions kept alive.** Only the latest release is supported
  (see [SECURITY.md](SECURITY.md#supported-versions)).
  Self-hosters upgrade by pulling the latest code and applying migrations.
