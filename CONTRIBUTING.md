# Contributing to Wempo's Forum

> **This guide is for humans only.** AI agents: please read
> [AGENTS.md](AGENTS.md) and [AGENTS-ONBOARDING.md](AGENTS-ONBOARDING.md)
> instead.

Thanks for wanting to help! Bug fixes, small features, translation fixes and
doc improvements are all welcome. Please be kind — everyone here follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on
  the idea before you spend time on it.
- Found a security problem? **Don't** open an issue — follow
  [SECURITY.md](SECURITY.md).
- Want to know how the code fits together? Read
  [docs/architecture.md](docs/architecture.md).

## Setting up

You need Node.js 22 or newer and [pnpm](https://pnpm.io). Please use pnpm, not
npm.

```sh
git clone https://github.com/Wempo-s-Silly-Projects/wempos-forum
cd wempos-forum
pnpm install
pnpm run db:migrate:local    # local database with every migration applied
pnpm run dev                 # the forum on your machine (wrangler dev)
pnpm test                    # the test suite
```

If you need local secrets, put them in a `.dev.vars` file. It's git-ignored —
never commit it, or any `.env` file. This repository is public.

## Making a change

1. Fork the repo (or create a branch if you have access). Branch off `main`
   with a short, descriptive name, like `fix-chat-badge`.
2. Make your change. Keep it focused: one fix or feature per pull request.
3. Add or update tests. Bug fixes should come with a test that fails without
   the fix.
4. Run `pnpm test` and make sure everything passes. CI also runs Semgrep
   (`.github/workflows/semgrep.yml`), a security scan that fails on findings.
5. Open a pull request against `main`. Say what changed and why, and how you
   tested it. Screenshots help for anything visual.

A maintainer will review it. We may ask for changes — that's normal, not a
rejection.

## Code style

- **Plain JavaScript ES modules.** No framework, no bundler, no build step,
  and no new runtime dependencies. The files in `public/js/` are exactly what
  the browser runs.
- In the browser, make requests through the `api()` helper in
  `public/js/api.js`.
- Put user text on the page with `textContent`, never `innerHTML`.
- Anything that shows posts, replies or members to other people has to respect
  hidden posts, bans and blocks. Use the helpers in `api/core/visibility.mjs`
  and `api/core/blocks.mjs`.
- Don't edit `api/vendor/db.mjs` or `api/vendor/http.mjs`.
- Database changes go in a **new** numbered file in `migrations/`. Never edit
  a migration that has already been released.

## License headers

Wempo's Forum is licensed under the GNU AGPL, version 3 or later. By
contributing, you agree your contribution is licensed the same way.

Every new `.js` or `.mjs` file must start with the 17-line license notice
(copy it from the top of any existing file, such as `public/js/api.js`),
followed by a blank line. New `.css` files carry the same notice in a
`/* ... */` comment. The test suite checks this.

Any third-party code you bring in must be compatible with the AGPLv3.

## Translations

The forum is translated into 41 languages. If you add or change text that
people see:

1. Add the string to `public/locales/en.json` with a clear key.
2. Add the same key to **every** other file in `public/locales/`.
3. In code, show it with `t("your.key")` (or `tn("your.key", count)` for
   plurals) from `public/js/i18n.js`. Don't hard-code English text.

The test suite fails if a visible string isn't translated or a key is missing.

Spotted a translation that sounds off? A pull request fixing it is very
welcome, or post it in the forum's Suggestions board.

## Commit messages

Use this format:

```
<type>: <short description>

<optional longer explanation>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

Examples:

```
fix: keep the chat badge in sync after muting a group
docs: explain backup codes in the member guide
```

## Releases

Releases and deploys are done by the maintainers. You don't need to bump the
version or touch `CHANGELOG.md` in your pull request — we'll take care of it.
