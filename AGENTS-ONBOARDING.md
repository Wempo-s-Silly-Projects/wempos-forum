# Onboarding for AI agents

You've just landed in the Wempo's Forum repo. Read [AGENTS.md](AGENTS.md)
first — it holds the rules (pnpm only, deploy script, license headers,
never-touch files, the D1 ritual, Section Q). This page is the practical part:
where things live, how the code is written, and how to test it.

Humans: [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/](docs/) are for you.

## What this is

A community forum served by one Cloudflare Worker with one D1 database. Live at
<https://wempos-forum.com>. Sign-in is handled by Wempo Accounts
(<https://accounts.wempos-forum.com>, a separate repo) on the same database.
For the bigger picture read [docs/architecture.md](docs/architecture.md).

## Repo layout

| Path | What's there |
|---|---|
| `worker.mjs` | The Worker entry. Routes `/api/*` to the handlers in `api/`, serves `public/` as static assets, and re-exports what tests import. |
| `constants.mjs` | Shared SQL and constants used by the worker and tests. |
| `api/*.mjs` | One module per feature area (`posts-feed.mjs`, `replies.mjs`, `chat.mjs`, `notifications.mjs`, `moderation.mjs`, ...). Each exports a `handle…Routes` function. |
| `api/core/` | Shared leaves: `auth.mjs` (sessions, CSRF), `visibility.mjs`, `http.mjs`, `roles.mjs`, `crypto.mjs`, `passwords.mjs`, `error-codes.mjs`, `cursors.mjs`, `shapers.mjs`, `images.mjs`, `spoilers.mjs`, `totp.mjs`. |
| `api/vendor/` | `db.mjs`, `http.mjs` — **never touch** (see AGENTS.md). |
| `public/index.html` | The single page shell. |
| `public/js/` | Browser code. `app.js` boots, `router.js` maps paths to views, `routes/` holds the page views, `desk/` the moderation desk, `api.js` the fetch wrapper, `i18n.js` translations, plus one small module per feature. |
| `public/locales/*.json` | 65 translation tables; `en.json` is the source. |
| `public/styles.css`, `public/responsive.css` | All styling. |
| `migrations/` | Numbered D1 migrations, applied in order. Never edit one that has shipped; add a new one, numbered one above the highest file here. |
| `tests/` | `node --test` suite, one file per feature or wave. Helpers live in `tests/helpers/`. |
| `docs/` | Human docs. `docs/drafts/` holds feature slates. `docs/sql/` holds one-off repair scripts (not migrations). |
| `scripts/` | Small maintenance scripts (e.g. `import-graph.mjs`). |
| `wrangler.toml` | Bindings: D1, rate limiters, assets, the `preview` environment. |

## Code conventions

- **Vanilla ES modules, no bundler, no build step.** The files in `public/js/`
  are exactly what the browser runs. No framework and no client-side
  packages. The Worker uses a few small server-side packages (see
  `package.json`); dev tools are `wrangler`, ESLint and `fast-check`.
- **One network path on the client.** Every request goes through the `api()`
  wrapper in `public/js/api.js` (it uses `fetch`, adds the CSRF token, and maps
  error codes to translated messages). Don't call `fetch` directly and don't
  use XHR.
- **Build DOM with `textContent`, never `innerHTML`** for anything that holds
  user text. Rendered markdown goes through `public/js/markdown.js` /
  `render.js`, which build nodes safely.
- **Every visible string is translated.** Use `t("key")` / `tn("key", count)`
  from `public/js/i18n.js`. Add the key to `public/locales/en.json` **and** to
  every other locale file. `tests/i18n.test.mjs` fails on painted English
  literals or missing keys.
- **The visibility law.** Any query that returns posts, replies, users or chat
  to someone who might not be staff must hide content that is hidden, by an
  actively banned member, or across a block. Use the helpers in
  `api/core/visibility.mjs` (`canViewPost`, `viewablePostSql`,
  `ACTIVE_BAN_SQL`) and `api/core/blocks.mjs` rather than writing your own
  filter. The `wempos-forum-visibility-law` skill has the full checklist.
- **Roles.** The database stores `member`, `moderator`, `admin`; the public
  names are member, admin, owner (`api/core/roles.mjs` maps them). Staff means
  admin or owner.
- **Errors.** Throw `HttpError` from `api/core/http.mjs`; error messages that
  the client translates have a code in `api/core/error-codes.mjs`.
- **License header** on every new `.js`/`.mjs`/`.css` file (see AGENTS.md).
- **Commits**: `type: description` (feat, fix, refactor, docs, test, chore,
  perf, ci), with no attribution trailer.

## Testing

```sh
export PATH="$HOME/Library/pnpm/bin:$PATH"   # if pnpm isn't on PATH
pnpm install
pnpm test                                    # runs node --test
pnpm lint                                    # ESLint (CI runs it too)
node --test tests/chat.test.mjs              # one file
```

Helpers in `tests/helpers/`:

- `d1.mjs` — an in-memory D1 fake backed by `node:sqlite`. `loadSchema()`
  applies every file in `migrations/`; `makeEnv()` builds a Worker `env` with
  the database, rate limiters and assets.
- `seed.mjs` — `seedUser`, `seedPost`, `seedBan`, `forgeSession` (a signed-in
  session), `makeRequest` and `call(env, path, options)` to drive the real
  worker handlers.
- `fake-dom.mjs` — a small DOM for testing `public/js` modules without a
  browser.
- `timing.mjs`, `markdown-fuzz.mjs`, `string-literals.mjs` — timing pins,
  fuzz inputs, and the literal scanner used by the i18n tests.

Write the failing test first, then the fix. The `wempos-forum-test-harness`
skill explains the helpers in more depth.

Running locally: `pnpm run db:migrate:local`, then `pnpm run dev`
(`wrangler dev`). Local secrets go in `.dev.vars` (git-ignored, never commit).

## Project skills

Project skills live in `.claude/skills/wempos-forum-*` and ship with the repo,
so every clone has them. Invoke the one that matches your task:

| Skill | Use it when |
|---|---|
| `wempos-forum-patterns` | Editing `worker.mjs`, `api/*.mjs` or `public/js`; placing tests; writing commits |
| `wempos-forum-test-harness` | Adding or fixing tests, faking D1, forging a session |
| `wempos-forum-visibility-law` | Writing any query that returns posts/users/chat |
| `wempos-forum-ritual` | Any remote D1 migration |
| `wempos-forum-feature-wave`, `wempos-forum-wave-lead` | Planning or leading a feature wave |
| `wempos-forum-ship-review` | Giving a SHIP/BLOCK verdict on a commit range |
| `wempos-forum-fleet-ops`, `wempos-forum-agent-fanout` | Fielding seats, briefs, the taskboard |
| `wempos-forum-chat-widget` | The chat panel and Who's Online |
| `wempos-forum-cross-app-signin` | Sign-in between the forum and Wempo Accounts |
| `wempos-forum-mcp-tools`, `wempos-forum-agent-discovery` | `/mcp`, robots/sitemap, markdown-for-agents, `.well-known` |
| `wempos-forum-bot-ops` | The forum's helper bot |
| `wempos-forum-owner-web-edits` | Before any push or deploy, or whenever `origin/main` has moved (the owner sometimes edits `main` in the GitHub web editor) |

## Before you finish

1. `pnpm test` and `pnpm lint` are green.
2. Your diff touches only the paths your task named.
3. New files carry the license header; new strings exist in every locale.
4. You haven't pushed, merged or deployed unless your task said to.
