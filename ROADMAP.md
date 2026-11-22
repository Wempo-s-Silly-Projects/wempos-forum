# Roadmap

What the project means to work on from **November 2026 through November
2027**, and what it has decided **not** to do. This is a plan, not a
promise. Priorities can change, and the maintainer will update this file
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

## Non-goals (what the project will not do)

- **No ads, trackers or selling data.** The forum collects as little as it
  can, and nothing that sends data to a third party is ever turned on by
  default.
- **No framework, bundler or build step on the browser side.** The browser
  runs the files in `public/js/` exactly as written, as plain JavaScript
  modules.
- **No other storage platforms.** Data stays in Cloudflare D1, with R2 for
  images. There are no plans for KV or an outside database.
- **No voice or video chat** (WebRTC), and no real-time voice signaling.
- **No public developer platform for third-party bots or apps.** The public
  read API and the MCP tool server stay as documented in
  [docs/api.md](docs/api.md), but there are no plans for a bot or app
  marketplace.
- **No old versions kept alive.** Only the latest release is supported
  (see [SECURITY.md](SECURITY.md#supported-versions)).
  Self-hosters upgrade by pulling the latest code and applying migrations.
