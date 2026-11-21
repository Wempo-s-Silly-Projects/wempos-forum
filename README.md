# Wempo’s Forum
![GitHub package.json version](https://img.shields.io/github/package-json/v/Wempo-s-Silly-Projects/wempos-forum?style=for-the-badge&link=wempos-forum.com)
![Mozilla HTTP Observatory Grade](https://img.shields.io/mozilla-observatory/grade/wempos-forum.com?style=for-the-badge)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white)](cloudflare.com)
[![Node.js](https://img.shields.io/badge/Node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)](nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=fff)](pnpm.io)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000)](javascript.org)

A small, friendly community forum. It's live at **<https://wempos-forum.com>**.

## What's in it

- **Boards, threads and replies**: start a thread on a board, reply, quote, and follow along.
- **Reactions and polls**: react to posts, or attach a poll to a thread.
- **Images and GIFs**: attach up to three images to a post, or pick from the community GIF gallery.
- **Profiles and walls**: avatars, bios, socials, custom profile styling, and a wall where other members can leave messages.
- **Notifications**: mentions, replies, and wall posts land in your bell.
- **Search and bookmarks**: find old threads and save the ones you want to come back to.
- **Chat**: a floating chat button on every page, with a public Lobby and private direct messages. See [docs/chat-widget.md](docs/chat-widget.md).
- **Who's Online**: a small roster of who's around right now. You can go invisible from your account page.
- **Safety tools**: block members you don't want to hear from, report posts, and turn on two-factor sign-in (authenticator app plus backup codes).
- **Moderation desk**: staff work through reports, bans, ban appeals, auto-moderation, and the word filter in one place.

## Signing in

Accounts live in **Wempo Accounts** at <https://accounts.wempos-forum.com>. Sign in there and you're sent back to the forum already signed in. The old `workers.dev` addresses for both sites redirect to these domains.

## How it's built

- **Cloudflare Workers** serve everything: the API under `/api/*` and the static site from `public/`.
- **Cloudflare D1** (SQLite) stores all data, including image bytes. Schema changes live in numbered files under `migrations/`.
- **Vanilla ES modules** on both sides. No framework, no bundler, no build step: the files in `public/js/` are what the browser runs.
- Rate limits use Workers rate-limit bindings, listed in `wrangler.toml`.

## Running it locally

You need Node.js 22 or newer and [pnpm](https://pnpm.io). Use pnpm for everything, not npm.

```sh
pnpm install                 # install wrangler
pnpm run db:migrate:local    # create the local D1 database and apply every migration
pnpm run dev                 # run the worker locally with wrangler dev
pnpm test                    # run the test suite (node --test)
```

Local secrets go in a `.dev.vars` file. It's git-ignored, so keep it that way and never commit it.

## Deploying

Deploy **only** with:

```sh
pnpm run deploy
```

That script stamps the build with the current commit (`COMMIT_SHA`). The stamp shows up at `/api/version` and in the page's build tag, and the client uses it to know when to load fresh scripts. A bare `wrangler deploy` skips the stamp, so `/api/version` reports an empty commit and browsers can keep running old code. Don't use it.

Deploying code doesn't apply migrations. See [docs/release-checklist.md](docs/release-checklist.md) for the full release steps.

## Secrets

Production secrets (`PASSWORD_PEPPER`, `SETUP_SECRET`, `TURNSTILE_SECRET`) belong to the owner. They are set as Cloudflare secrets and are never committed, printed, or shared. This repository is public: don't commit `.dev.vars`, `.env`, or `.env.*`.

## License

Source: <https://github.com/Wempo-s-Silly-Projects/wempos-forum>

Copyright (C) 2026 ItsWempo

Wempo's Forum is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

The full license text is in the LICENSE file at the root of this
repository.

Modified versions that let users interact with them over a network must
offer those users the corresponding source of the version they are serving
(GNU Affero General Public License, section 13): a visible link to the
source archive, or the repository above, satisfies this duty.
