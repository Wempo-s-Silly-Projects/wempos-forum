# Architecture overview

A short tour of how Wempo's Forum is put together, for developers. If you want
to change something, read [CONTRIBUTING.md](../CONTRIBUTING.md) too.

## The big picture

```
browser ──▶ Cloudflare Worker (worker.mjs) ──▶ D1 database (FORUM_DB)
               │                                   ▲
               ├─ /api/*      → api/*.mjs handlers │
               ├─ /mcp, /sitemap.xml, /.well-known/*, markdown for agents
               └─ everything else → static files in public/
                                                   │
Wempo Accounts (separate worker, same database) ───┘
   └─ asks this worker to check passwords over a private service binding
```

- **One Cloudflare Worker** serves the whole site, hosted on Cloudflare's
  servers at `wempos-forum.com`.
- **One D1 database** (Cloudflare's SQLite) holds everything — users, posts,
  chat, notifications, and even image bytes (split into chunks, because D1
  rows are capped at about 2 MB). Moving images to R2 is planned; see
  [r2-migration.md](r2-migration.md).
- **No framework, no bundler, no build step**, on either side. Both the
  server and the browser run plain ES modules exactly as they're written.

## Server: `worker.mjs` and `api/`

`worker.mjs` is the entry point. For each request it applies rate limits
(Workers rate-limit bindings listed in `wrangler.toml`), then hands `/api/*`
paths to feature handlers, one module per area:

| Area | Modules |
|---|---|
| Posts and threads | `posts.mjs`, `posts-feed.mjs`, `posts-write.mjs`, `replies.mjs`, `boards.mjs`, `polls.mjs`, `suggestions.mjs`, `traditions.mjs` |
| People | `profiles.mjs`, `profile-threads.mjs`, `profile-css.mjs`, `avatars.mjs`, `wall.mjs`, `blocks.mjs`, `leaderboard.mjs` |
| Sign-in and accounts | `session.mjs`, `accounts.mjs`, `relay.mjs`, `twofa.mjs`, `export.mjs` |
| Chat | `chat.mjs`, `dm-groups.mjs`, `dm-images.mjs` |
| Notifications and saving | `notifications.mjs`, `mentions.mjs`, `subscriptions.mjs`, `bookmarks.mjs`, `search.mjs` |
| Media | `attachments.mjs`, `gifs.mjs` |
| Moderation | `moderation.mjs`, `mod-tools.mjs`, `reports.mjs`, `bans.mjs`, `appeals.mjs`, `members-admin.mjs`, `filter.mjs`, `filterstore.mjs`, `modlogs.mjs`, `archive.mjs`, `rules.mjs` |
| Machine readers | `discovery.mjs` (sitemap, OpenAPI, `.well-known`), `mcp.mjs` (the `/mcp` tool server) |

The public read API and the `/mcp` tool server are described for outside
readers in [api.md](api.md).

Shared building blocks live in `api/core/`: sessions and CSRF (`auth.mjs`),
roles (`roles.mjs`), the visibility rules (`visibility.mjs`, `blocks.mjs`),
errors (`http.mjs`, `error-codes.mjs`), password hashing, TOTP, image
checks, and pagination cursors. `api/vendor/` holds two vendored files that
are never edited.

### The visibility rule

Anything that shows posts, replies, people or chat to a non-staff viewer must
leave out hidden posts, posts by actively banned members, and anything across
a block (in either direction). That's enforced at read time with the shared
helpers in `api/core/visibility.mjs` and `api/core/blocks.mjs`, so a ban or
hide never edits or deletes the content — lift it and everything comes back.

### Sign-in

Accounts live in Wempo Accounts (<https://accounts.wempos-forum.com>), a
separate worker on the same database. It never sees password hashes: it asks
this worker (`api/relay.mjs`) to check or set a password over a private
service binding, guarded by a shared secret. After sign-in the member is sent
back to the forum with a session.

## Browser: `public/`

- `public/index.html` is the single page shell. The worker serves it for any
  page route; `public/js/router.js` decides which view to draw (and unknown
  paths get a real 404).
- `public/js/app.js` boots the app; views live in `public/js/routes/`, the
  moderation desk in `public/js/desk/`, and each feature has its own small
  module (drafts, read aloud, chat widget, mention picker, and so on).
- Every request goes through one `api()` wrapper in `public/js/api.js`, built
  on `fetch`.
- User text is put on the page with `textContent`; markdown is rendered by
  `public/js/markdown.js` into DOM nodes, never raw HTML.
- Translations: `public/js/i18n.js` loads a table from `public/locales/`
  (41 languages, `en.json` is the source) and handles plurals and
  right-to-left layouts.
- Device-only preferences (theme, text size, language) are kept in the
  browser's local storage.

## Data and migrations

The schema is built from numbered SQL files in `migrations/`, applied in order
by `wrangler d1 migrations apply`. A shipped migration is never edited; a
change always gets a new file. Applying migrations and deploying code are
separate steps — see the [release checklist](release-checklist.md).

## Tests

`pnpm test` runs Node's built-in test runner over `tests/`. Server tests run
the real handlers against an in-memory SQLite database built from
`migrations/` (`tests/helpers/d1.mjs`, `tests/helpers/seed.mjs`); browser
modules are tested against a small fake DOM (`tests/helpers/fake-dom.mjs`).
No browser or network is needed.

Security analysis tools (ESLint, CodeQL, ShellCheck, Gitleaks, pnpm audit,
OWASP ZAP) and how to run each one are listed in
[security-tooling.md](security-tooling.md).

## Deploys

`pnpm run deploy` deploys the worker and stamps it with the current commit,
which `/api/version` reports. The browser uses that stamp to notice when new
code is live and load fresh scripts.
