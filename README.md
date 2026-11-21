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
- **Writing tools**:
  - Your unsent post or reply is saved as a draft in your browser, so a refresh never loses it. When a draft comes back, a note says when it was saved, with a "Discard draft" button.
  - Paste or drag an image into the post or reply box. It waits in a "ready to attach" strip until you press Attach, and nothing uploads until you post.
  - The character counter stays quiet until you're close to the limit. Screen readers hear it once near the end and once at the limit, not on every key.
  - Cancelling an edit after you've changed the text asks before throwing your changes away.
  - Type `@` and a letter to pick a member to mention. A preview pane shows your post as it will look.
  - Hide a punchline or plot twist with `||spoiler||` text, which stays covered until a reader taps it.
  - Press Ctrl+Enter (Cmd+Enter on a Mac) to post from the box you're typing in.
  - A "Formatting help" panel under the composer lists every bit of markup the forum understands.
  - Select part of a reply before you press Quote, and only that part is quoted.
  - Typing in Japanese, Chinese or Korean is safe: pressing Enter to confirm a word never sends a chat message or picks a mention by accident.
- **Reading tools**:
  - When you come back to a thread, replies you haven't seen get a "New" mark, with a button to jump to where you left off. This is remembered in your browser only.
  - A strip above the replies shows how many people are talking, a rough read time, and a link to the most-liked reply.
  - Long threads have "Jump to latest reply" and "Back to the first post" buttons. If you've replied, "Jump to my reply" takes you to your newest reply. "Next reply from the author" steps through the replies of the person who started the thread.
  - Replies from the person who started the thread carry an "Author" chip, and your own posts carry a "You" chip.
  - Fold a reply to shrink it down to its author line, or use "Fold all replies" on a long thread. Folding only changes your view.
  - "Show spoilers" uncovers every spoiler in a post at once. Spoilers stay covered in every preview: feed snippets, notifications, search results, profile excerpts and quotes.
  - Click an image to open the viewer, then step through the post's other images with the arrow buttons or arrow keys.
  - "Listen" reads a post aloud, using only voices that run on your device.
  - On a thread page, press J and K to move between posts. A "Keyboard shortcuts" list beside that hint shows every key the forum knows.
- **Browsing the feed**:
  - The front page and each board have Active, Newest and Unanswered views. Unanswered lists threads with no replies yet; replies you can't see don't count.
  - The feed shows 20 threads at a time, and "Load older posts" brings the next 20. On the last page the list says you've reached the end and offers a Back to top button.
  - Very long posts (over 900 characters or 14 lines) are folded in the feed behind Show more / Show less. The thread page always shows the whole post.
  - The Suggestions board is ordered by votes (likes minus dislikes), and each card shows its place: #1, #2, and so on.
  - Reply counts on the feed are worked out faster than before.
- **Sharing**: copy a link to any post or reply in one click. Fenced code blocks also get a copy button.
- **Your language, your size**: the forum is translated into 21 languages, with a language menu in the header. Arabic and Hebrew display right-to-left. You can also pick Default, Large or Larger text.
- **Reactions and polls**: react to posts, or attach a poll to a thread. Poll results show each option's percentage, and the option you picked carries a "Your vote" chip. You can change your vote any time. While you set up a poll, a preview shows it as you type, and two options that say the same thing get a warning.
- **Images and GIFs**: attach up to three images to a post, or pick from the community GIF gallery. Uploads over the limit are refused sooner, before the forum does any work on them. The gallery picker keeps a "Recently used" row and can sort by newest or most used.
- **Profiles and walls**: avatars, bios, socials, custom profile styling, a "Member since" date, a list of the member's recent threads, and a wall where other members can leave messages. Wall posts support the same formatting as forum posts.
- **Community traditions**: Question of the Day threads (a thread that starts with "QOTD") get a chip, and the home feed shows a "Today's question" banner with a "You answered" chip once you've replied. The showcase board opens with an image gallery of its threads.
- **Notifications**: mentions, replies, and wall posts land in your bell. Several replies on the same thread are grouped into one row. Tick "Unread only" on the Notifications page to see just what's new.
- **Search and bookmarks**: find old threads and save the ones you want to come back to. Your search words are highlighted in the results. Saved posts can be narrowed to one board, and "Remove all saved from" a board clears that board's saved posts in one go, after asking first.
- **Chat**: a floating chat button on every page, with a public Lobby, private direct messages, and group chats of up to 10 people. You can send images in DMs and pin up to 5 chats to the top. Mute a chat to stop it counting toward the chat button's unread badge. Whoever made a group chat can rename it. Tick "Unread only" to list just the chats with new messages. The chat list and its unread counts load faster than before. See [docs/chat-widget.md](docs/chat-widget.md).
- **Who's Online**: a small roster of who's around right now, split into Staff and Members, each with a count. You can go invisible from your account page.
- **New here**: new accounts get a welcome card with a few places to start, and everyone gets a "New tricks to try" card. Each one goes away for good when you dismiss it.
- **Your settings, your data**: account settings have a "Find a setting" box and a "Jump to a section" list. "Download my data" saves a copy of what you wrote and set (profile, posts and replies, saved posts, followed threads, blocks, wall posts you wrote, and messages you sent). It never includes passwords, two-factor secrets, sign-in sessions, network addresses, image files, or anything other members wrote.
- **Signing out cleans up**: signing out clears your drafts, read marks, pinned and muted chats, gallery recents and dismissed cards from this browser, even if the sign-out request fails. Device settings like theme, text size and language stay.
- **Safety tools**: block members you don't want to hear from, report posts, and turn on two-factor sign-in (authenticator app plus backup codes).
- **Moderation desk**: staff work through reports, bans, ban appeals, auto-moderation, and the word filter in one place. See [docs/moderation.md](docs/moderation.md).

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
