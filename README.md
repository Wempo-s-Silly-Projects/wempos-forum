# Wempo’s Forum
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/ci/Wempo-s-Silly-Projects/wempos-forum.svg?variant=secondary&amp;size=sm&amp;mode=dark"><img alt="CI" src="https://www.shieldcn.dev/github/ci/Wempo-s-Silly-Projects/wempos-forum.svg?variant=secondary&amp;size=sm&amp;mode=light"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/badge/Hosting-Cloudflare_Workers-F38020.svg?logo=cloudflare&amp;variant=branded&amp;size=sm&amp;mode=dark"><img alt="Hosting · Cloudflare Workers" src="https://www.shieldcn.dev/badge/Hosting-Cloudflare_Workers-F38020.svg?logo=cloudflare&amp;variant=branded&amp;size=sm&amp;mode=light"></picture>

A small, friendly community forum. Come say hi at
**<https://wempos-forum.com>**.

Accounts live in **Wempo Accounts** at <https://accounts.wempos-forum.com>:
sign in there and you land back on the forum already signed in.

## Pick your page

| You are... | Start here |
|---|---|
| New to the forum, or just browsing | [Using the forum](docs/using-the-forum.md) |
| An admin or the owner | [Admin and moderation guide](docs/admin-guide.md) |
| Here to write code or translations | [CONTRIBUTING.md](CONTRIBUTING.md), then [Architecture](docs/architecture.md) |
| Reporting a security problem | [SECURITY.md](SECURITY.md) (privately, please) |
| Curious what changed | [CHANGELOG.md](CHANGELOG.md) |
| An AI agent | [AGENTS.md](AGENTS.md) and [AGENTS-ONBOARDING.md](AGENTS-ONBOARDING.md) |

## A quick tour

- **Boards and threads.** General, Game development, Showcase,
  Help & Bugs, Suggestions, and Updates (news from the
  admins). Start a thread, reply, quote, react, attach a poll (with an
  optional closing time), add tags and a short TL;DR, and share a thread or
  follow it by RSS.
- **Friendly writing tools.** Drafts save themselves, a live preview shows your
  post before it goes out, `@` suggests members to mention, `||spoilers||` stay
  covered until tapped, and you can paste or drop images (up to three per
  post) or pick from the community GIF gallery. Edit history shows what
  changed, word by word.
- **Easy reading.** "New" marks on replies you haven't seen, a thread
  at-a-glance strip, a "Jump to" outline on long threads, folding, a reply
  filter, Read aloud (on-device voices only), and J/K keyboard navigation.
- **Keeping up.** Subscribe to or mute a thread, follow members, sort saved
  posts into folders, save searches, and choose which kinds of notification
  reach you.
- **Chat.** A chat button on every page with a public Lobby, direct messages
  (with reactions and search), and group chats of up to 10 people.
- **Profiles.** Avatars, bios, pronouns, a custom status, a pinned thread,
  custom profile styling, milestone badges, recent threads, a wall where
  friends can leave messages, and private notes only you can see.
- **Community traditions.** Question of the Day threads from the owner, a
  This week page, a staff pick in the Showcase, an all-time leaderboard, and
  invite links for friends.
- **Your language.** The whole interface comes in 65 languages, including
  four right-to-left ones (Arabic, Hebrew, Persian and Urdu).
- **Your data, your call.** Two-factor sign-in, blocking, reporting, a
  settings page that keeps everything in one place, and a "Download my
  data" button. Visits are counted as private daily totals only, and Do Not
  Track and Global Privacy Control are respected. See
  [Using the forum](docs/using-the-forum.md) for the full list.

## Running it locally

You need Node.js 22 or newer and [pnpm](https://pnpm.io). Use pnpm for
everything — not npm.

```sh
pnpm install                 # installs wrangler (the only dependency)
pnpm run db:migrate:local    # creates a local D1 database and applies every migration
pnpm run dev                 # runs the worker locally with wrangler dev
```

Local secrets go in a `.dev.vars` file. It's git-ignored — keep it that way.

## Running the tests

```sh
pnpm test                    # node --test, the whole suite
```

The suite runs in plain Node with an in-memory database, so it doesn't need
the dev server or any network access.

## Deploying (maintainers)

Deploy only with `pnpm run deploy`, never a bare `wrangler deploy` — the script
stamps the build with the current commit so browsers know when to load fresh
code. Database migrations are a separate step. The full steps are in
[docs/release-checklist.md](docs/release-checklist.md).

## More docs

- [Using the forum](docs/using-the-forum.md) — for members and guests
- [Admin and moderation guide](docs/admin-guide.md) and the
  [moderation desk reference](docs/moderation.md)
- [Chat and Who's Online](docs/chat-widget.md)
- [Architecture overview](docs/architecture.md)
- [Public API](docs/api.md) — read endpoints, the MCP tool server, discovery
- [Running your own Wempo's Forum](docs/self-hosting.md) — host your own copy
- [Translating the forum](docs/translating.md) — help translate it into your language
- [Release checklist](docs/release-checklist.md) and the
  [versioning policy](CONTRIBUTING.md#versioning)
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) ·
  [Code of Conduct](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)
- [Governance](GOVERNANCE.md) · [Roadmap](ROADMAP.md) ·
  [Security requirements](docs/security-requirements.md) ·
  [Assurance case](docs/assurance-case.md)

## Feedback & bugs

Found a bug or have an idea? Open an issue at
<https://github.com/Wempo-s-Silly-Projects/wempos-forum/issues/new/choose>,
or post on the forum's **Help & Bugs** or **Suggestions**
boards. Security problems go privately instead — see [SECURITY.md](SECURITY.md).

## License

Wempo's Forum is free software, licensed under the **GNU Affero General Public
License, version 3 or (at your option) any later version**. The full text is in
[LICENSE.txt](LICENSE.txt).

Source: <https://github.com/Wempo-s-Silly-Projects/wempos-forum>

Copyright (C) 2026 ItsWempo

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

If you run a modified version that people use over a network, the AGPL
(section 13) asks you to offer those users the source of the version you're
running. The footer's **Source code** link does this: it points at the
repository at the running commit, or at your own copy once you set
`SOURCE_URL` (see [self-hosting](docs/self-hosting.md#sharing-your-source-code)).

## Contributors
<a href="https://github.com/inttter/md-badges/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Wempo-s-Silly-Projects/wempos-forum" />
</a>
