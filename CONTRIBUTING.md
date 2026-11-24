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

### Using an AI coding agent (optional)

The rules for AI coding agents are in [AGENTS.md](AGENTS.md); Claude Code,
Gemini CLI, Codex, Cursor, Copilot and other tools that read `AGENTS.md`,
`CLAUDE.md` or `GEMINI.md` pick them up automatically. The project's Claude
Code skills, commands and guard rules ship in `.claude/`.

To work with the same Claude Code setup the maintainer uses (instructions,
the GLM-Flash output style, coding rules and plugin list), install
[claude-setup](https://github.com/Wempo-s-Silly-Projects/claude-setup) into
`~/.claude`. Its installer backs up your existing files first:

```sh
git clone https://github.com/Wempo-s-Silly-Projects/claude-setup ~/claude-setup
bash ~/claude-setup/install.sh
```

Then add the plugins listed in its `PLUGINS.md`.

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

### Coding standards

The style guide for JavaScript is ESLint's **recommended** rule set
(`@eslint/js` `configs.recommended`), configured in
[`eslint.config.js`](eslint.config.js) with ECMAScript 2023 modules and the
right globals for each runtime (browser, Workers, Node for tests). On top of
that:

- the project rules above (no framework or bundler, `textContent` only, the
  shared visibility helpers, the `api()` wrapper);
- every JavaScript file runs in strict mode, because it's an ES module;
- shell scripts must pass [ShellCheck](https://www.shellcheck.net/);
- every `.js`, `.mjs` and `.css` file starts with the license header (see
  below).

These are enforced automatically. `pnpm lint` (ESLint), ShellCheck,
`reuse lint` and the license-header test (part of `pnpm test`) all run in
CI on every push and pull request. A failing check turns the change red, and
red changes don't get merged or deployed. The vendored
files and `docs/` are excluded from ESLint (see the `ignores` list). Any
other exception must be a rare, inline `eslint-disable` comment that says
why.

### Code review

Every change gets reviewed before it's released. The reviewer checks that:

1. it does one thing, matches the description, and doesn't touch unrelated
   files;
2. tests come with it (bug fixes need a test that fails without the fix),
   and `pnpm test` and `pnpm lint` pass in CI;
3. it keeps the security rules: writes go through `requireUser`, reads that
   show content go through the visibility helpers, SQL uses bound
   parameters, user text goes through `textContent`, and no secrets are
   committed;
4. any new input is checked against an allow-list (type, length, format);
5. CodeQL, Semgrep, Gitleaks and the dependency audit report no new
   findings;
6. docs, translations and CHANGELOG.md are updated when behavior changes.

A change is accepted when all six points hold and CI is green.

The project has one maintainer (see [GOVERNANCE.md](GOVERNANCE.md)), so
today the maintainer reviews contributors' pull requests and checks their
own and AI-assisted changes against this same list, with help from
automated review bots. There isn't a second human reviewer yet.

## License headers

Wempo's Forum is licensed under the GNU AGPL, version 3 or later. By
contributing, you agree your contribution is licensed the same way.

Every new `.js` or `.mjs` file must start with the 17-line license notice,
then the two SPDX lines (the license identifier and the copyright line),
then a blank line. Copy all 19 lines from the top of any existing file, such
as `public/js/api.js`. New `.css` files carry the same notice and SPDX lines
in `/* ... */` comments (copy them from `public/styles.css`). The test suite
checks this.

Files that cannot hold a comment (JSON, images, config) get their license
from `REUSE.toml`, and the license texts live in `LICENSES/`. The project
follows the [REUSE](https://reuse.software/) specification; `reuse lint` (run
by CI) must pass. If you add such a file somewhere `REUSE.toml` does not
already cover, add its path there.

Any third-party code you bring in must be compatible with the AGPLv3.

## Translations

The forum is translated into 65 languages. If you add or change text that
people see:

1. Add the string to `public/locales/en.json` with a clear key.
2. Add the same key to **every** other file in `public/locales/`.
3. In code, show it with `t("your.key")` (or `tn("your.key", count)` for
   plurals) from `public/js/i18n.js`. Don't hard-code English text.

The test suite fails if a visible string isn't translated or a key is missing.

Spotted a translation that sounds off? A pull request fixing it is very
welcome, or post it in the forum's Suggestions board.

### Translating

Volunteer translators can work on Hosted Weblate (once the project is live)
or send a pull request that edits `public/locales/*.json`. See
[docs/translating.md](docs/translating.md) for the file rules, the style
guide and the list of locales that need a native speaker most.

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

## Versioning

Wempo's Forum follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
Every release is tagged `vX.Y.Z` and gets a GitHub Release. The live version
is shown at `/api/version`.

SemVer needs a declared public API. For the forum it is:

1. the documented HTTP routes under `/api/` and their JSON request and
   response shapes (see [docs/api.md](docs/api.md));
2. the MCP tool names and their arguments;
3. the self-hosting config vars in `wrangler.example.toml`;
4. the `migrations/` chain, which self-hosters apply in order.

What each part of the number means:

- **MAJOR** — an incompatible change to any of the above: removing or
  renaming a route, a JSON field, an MCP tool or argument, or a config var,
  or a migration that is not purely additive.
- **MINOR** — new features that keep everything above working. Every
  feature release is a MINOR.
- **PATCH** — bug fixes only.

Deprecations: before something in the public API is removed, a MINOR
release marks it in `CHANGELOG.md` under **Deprecated**, at least one MINOR
release before the MAJOR release that removes it.

We considered [CalVer](https://calver.org/) (versions made from release
dates) and did not choose it: people who run their own copy need to know
whether an update is safe to take, and a date does not tell them that.

## Releases

Releases and deploys are done by the maintainers. You don't need to bump the
version or touch `CHANGELOG.md` in your pull request — we'll take care of it.
