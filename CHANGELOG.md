# Changelog

All notable changes to Wempo's Forum, newest first. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). What counts as
the public API, and what MAJOR, MINOR and PATCH mean here, is in the
[versioning policy](CONTRIBUTING.md#versioning).

The live version is shown at <https://wempos-forum.com/api/version>.

## [Unreleased]

### Changed
- Rewrote the README, agent guides and moderation docs; added
  `CONTRIBUTING.md`, `SECURITY.md`, this changelog, and human guides for
  members, admins and developers under `docs/`.

## [5.24.0] - 2026-11-21

### Security
- Security review of everything shipped in 5.20–5.23 (SHA-256 two-factor,
  the source code link, the ZAP and fuzz checks, print styles and pronouns).
  The full write-up is in
  [docs/security-reviews/2026-11-21-v5.20-v5.23.md](docs/security-reviews/2026-11-21-v5.20-v5.23.md).
- Fixed: pronouns are now checked against the word filter every time a
  profile is shown, the same as flair. Before, pronouns saved before a word
  was added to the filter kept showing that word.
- New automated checks that two-factor's algorithm can't change while it is
  on (even when two tabs race), that Download my data never contains
  two-factor secrets, that pronouns with HTML in them show as plain text,
  that a `javascript:` or `http:` `SOURCE_URL` never becomes the source code
  link, that printing never hides that link, and that the new CI workflows
  stay read-only with every action pinned. No database migration in this
  release.

## [5.23.0] - 2026-11-21

### Added
- **Print-friendly threads.** Printing a thread (or saving it as a PDF) now
  leaves out the header, menus, buttons, reply box, chat and footer, and
  prints the thread title and every post with its author and date, in black
  on white. Folded replies and long posts print in full, a post stays on one
  page where it fits, and links to other sites print their address after the
  link text. This is a stylesheet change only.
- **Optional pronouns on profiles.** Members can add pronouns in the profile
  editor (letters, spaces, / and - only, up to 24 characters). They show next
  to the name on the profile, are empty unless you set them, and clearing the
  field removes them. They are included in Download my data and deleted with
  the account. Blocked members don't see them, the same as the rest of the
  profile. New API route: `PUT /api/me/pronouns`. Database migration
  `0062_profile_pronouns` adds one new table.

## [5.22.0] - 2026-11-21

### Changed
- The weekly ZAP security scan now checks a copy of the forum that it starts
  inside the scan job, instead of the live site. Cloudflare answered the
  scanner at the live site with its bot-check page, so the forum itself was
  never scanned. Details are in
  [Security tooling](docs/security-tooling.md).

### Added
- Fuzz tests (`tests/fuzz-*.test.mjs`) that throw random and malformed input
  at username checks, the page router, two-factor code checks, the source
  link, post excerpts, the JSON body reader, and the sign-in, sign-up,
  search and new-post routes. They run with `pnpm test` with a fixed seed
  and a bounded number of runs, so they add under a second. They found no
  bugs. `fast-check` is a new development-only dependency (MIT license);
  nothing changes for people running the forum. No database migration in
  this release.

## [5.21.0] - 2026-11-21

### Added
- A **Source code** link in the footer of every page. It opens the forum's
  source code at the exact version that is running, as the GNU AGPL
  (section 13) asks. People who run their own copy and change it can point
  the link at their own source with the new `SOURCE_URL` setting; see
  "Sharing your source code" in
  [Running your own Wempo's Forum](docs/self-hosting.md). Only `https://`
  addresses are accepted.
- A [versioning policy](CONTRIBUTING.md#versioning): what counts as the
  public API, and what a MAJOR, MINOR or PATCH release means for it.

### Changed
- Every source file now also carries machine-readable SPDX license and
  copyright lines, and the repository follows the
  [REUSE](https://reuse.software/) specification: license texts live in
  `LICENSES/`, `REUSE.toml` covers files that cannot hold a comment, and a
  new CI check runs `reuse lint`. The license itself is unchanged
  (AGPL-3.0-or-later). No database migration in this release.

## [5.20.0] - 2026-11-21

### Added
- Two-factor sign-in can now use SHA-256 instead of SHA-1. It is opt-in: when
  you set up two-factor, tick **Use SHA-256**, but only if your authenticator
  app supports it (Aegis, 2FAS, 1Password and Bitwarden do; Google
  Authenticator does not). Setup asks for a code from your app before it
  turns on, so a wrong choice fails there, never at sign-in. Everyone already
  using two-factor keeps SHA-1 and nothing changes for them. Your data export
  now shows which algorithm you use (never the secret).

### Changed
- Database migration `0061_totp_algorithm.sql` adds one new table,
  `totp_algorithms`; no existing table changes. Self-hosters: apply it before
  deploying this version.

## [5.19.0] - 2026-11-21

### Added
- You can now give your forum its own name, tagline and footer. Staff set
  them on a new **Branding** page on the moderation desk, and the name shows
  up in the header, the browser tab, the home page, two-factor app entries
  and the pages written for search engines and agents. Empty boxes keep the
  defaults, so wempos-forum.com looks exactly the same. See "Name your forum"
  in [Running your own Wempo's Forum](docs/self-hosting.md).

## [5.18.0] - 2026-11-21

### Added
- AutoMod, an optional automatic moderator, server side. **It ships switched
  off** and stays off until the owner turns it on. When on, a program the
  owner runs can read new posts, replies, Lobby messages, wall posts and
  profile edits, then hide a post, ban a member for at most 24 hours, or flag
  something for staff. It never acts on staff, it can only read a DM
  conversation after one of its members reports it, and every AutoMod ban can
  be appealed like any other. See the AutoMod API section of the
  [admin guide](docs/admin-guide.md).
- **Report conversation** in 1:1 DMs. Reported conversations land on a new
  **DM reports** page on the moderation desk.
- A new **AutoMod** page on the moderation desk lists everything AutoMod did
  and why. Staff undo its hides and bans with the usual Restore and Unban.

## [5.17.0] - 2026-11-21

### Added
- You can now run your own copy of Wempo's Forum. The forum's address, the
  Wempo Accounts sign-in address and the Turnstile settings now come from
  each copy's own settings instead of being built in, and a new guide,
  [Running your own Wempo's Forum](docs/self-hosting.md), walks through
  setting one up with Wempo Accounts alongside it. `wrangler.example.toml`
  and `.dev.vars.example` list every setting.
- Turnstile is optional for your own copy: it runs only when a Turnstile
  secret is set. Rate limits are always on.

### Changed
- robots.txt is now served by the forum itself, so its sitemap link always
  names the right address. Nothing changes on wempos-forum.com.

## [5.16.0] - 2026-11-21

### Security
- Polls: closing a poll now takes effect immediately for every vote in
  flight, so no vote can change or be taken back on a poll that has just
  closed.
- Added regression tests for poll permissions, signing out other devices,
  and the staff-only Updates and Polls boards.

## [5.15.0] - 2026-11-21

### Added
- New staff-only Polls board: polls that drive decisions for changes to the
  forum. Everyone can read and vote; only the owner and admins start topics.

## [5.14.0] - 2026-11-21

### Added
- Backup codes left: with two-factor sign-in on, Settings now shows how many
  unused backup codes you still have, warns when 3 or fewer remain, and says
  so plainly when none are left.
- Sign out my other devices: Settings shows how many other devices or
  browsers are signed in to this forum and a "Sign out everywhere else"
  button. The device you are using stays signed in.
- Image viewer: an "Actual size" button shows a picture at its real size
  (scroll to look around), handy for screenshots with small text. Click the
  picture or move to the next one to go back to fitting the screen.

## [5.13.0] - 2026-11-21

### Added
- Polls can be closed: the thread's author (or staff) can close voting and
  reopen it later. Results stay visible to everyone; a closed poll says
  "Voting is closed." and no longer takes votes.
- Take back my vote: if you voted on an open poll, you can now withdraw your
  vote entirely instead of only moving it.
- Moderation desk: when several open reports point at the same post, each of
  its cards shows how many, so a pile-up stands out.

## [5.12.0] - 2026-11-21

### Security
- Security review of the 5.9 to 5.11 changes (new-messages line, search
  "Jump to" row, wall Reply, the visibility fixes and the staff-only question
  of the day). No problems were found; new automated checks now guard the
  chat-mention bell filter, the question-of-the-day role check and the
  public reply counts so they stay correct.

## [5.11.0] - 2026-11-21

### Changed
- Only the owner and admins can set "Today's question". A member's post that
  starts with "QOTD" now stays an ordinary thread and no longer replaces the
  question of the day on the home page.

## [5.10.0] - 2026-11-21

### Fixed
- **Privacy fixes from a full visibility check.** Every page and tool that
  shows posts, replies, members or chat was checked again:
  - The deleted-posts archive no longer shows replies from a thread that
    moderators had hidden, or posts by a banned member who later deleted
    their account.
  - A chat @mention in your notifications no longer names a member who is
    banned or who you've blocked (or who blocked you).
  - The "who's online" lists no longer show a member you've blocked, or who
    blocked you.
  - Leaderboard and profile counts no longer include replies under hidden
    threads or under posts by banned members.

## [5.9.0] - 2026-11-21

### Added
- **New messages line** in direct messages and group chats: opening a chat
  with unread messages shows "3 new messages" right above the first one you
  hadn't read, and it stays put while you read.
- **Search results at a glance**: a "Jump to:" row under the search heading
  counts the replies, members and posts found and takes you straight to each
  section.
- **Reply on a wall post**: a Reply button on other members' wall posts puts
  their @name in the wall box for you. Nothing is sent until you post.

## [5.8.0] - 2026-11-21

### Fixed
- The composer's caps guard ("Lower the caps") no longer lowercases links typed
  with an upper-case scheme (like `HTTPS://...`); they stay exactly as typed.

### Security
- Security review of everything shipped in 5.5–5.7, with new automated checks
  for category regulars, the reply filter, Reset appearance and 404 handling.

## [5.7.0] - 2026-11-21

### Added
- **Next badge** on your own profile: which milestone badge comes next and how
  close you are, with a progress bar. Only you see it.
- **Regulars on this page**: category pages show up to three members who
  started two or more of the topics on screen.
- **Reset appearance** in account settings puts square corners, text size and
  the tab-title unread count back to their defaults.

## [5.6.0] - 2026-11-21

### Fixed
- Going Back after deleting a thread no longer reopens it; links to deleted
  posts show the normal 404 page.
- Old error and "Saving…" messages no longer linger after a later Lobby send
  succeeds.
- J/K keyboard navigation skips replies hidden by the reply filter or inside
  folded groups.
- Added checks that device settings (theme, text size, language and more) are
  only cleared when you sign out, and then only account data.

## [5.5.0] - 2026-11-21

### Added
- **Caps guard** in the composer: mostly-capitals text gets a gentle
  **Lower the caps** offer, with Undo.
- **Filter replies** on thread pages with three or more replies.

## [5.4.0] - 2026-11-21

### Fixed
- `/c/constructor` and other odd category addresses now show the 404 page.

### Security
- Security review of 5.0–5.3, with new checks for strange or encoded
  addresses, plain-text-only language files, and the tab-title unread count.

## [5.3.0] - 2026-11-21

### Added
- Opt-in unread count in the browser tab title, like "(3) Wempo's Forum"
  (Settings → Appearance; off by default).

### Changed
- Steadier timing tests that no longer fail on a busy machine.

## [5.2.0] - 2026-11-21

### Added
- The "Page not found" view gets a big 404, plus links back to the home feed
  and to search the forum for the words in the missed address.

### Fixed
- Unknown pages, unknown language files and unknown `/.well-known/` addresses
  now answer with a real 404 instead of the app shell.

## [5.1.0] - 2026-11-21

### Added
- 20 more languages, for 41 in total: Filipino, Malay, Swahili, Swedish,
  Norwegian Bokmål, Danish, Finnish, Czech, Slovak, Hungarian, Romanian,
  Croatian, Serbian (Latin), Bulgarian, Greek, Catalan, Bengali, Tamil,
  Persian and Urdu (the last two right to left).

## [5.0.0] - 2026-11-21

The big one, rolling up everything from 4.5 to 4.45.

### Removed
- The **Unanswered** feed view (owner's call). Feeds keep Active and Newest.

## [4.45.0] - 2026-11-21

### Fixed
- A whole-forum privacy audit: blocks now apply everywhere (Lobby, DMs and
  their previews, leaderboard, archive, profile themes); notifications, counts,
  poll results and rankings ignore hidden posts and banned accounts; banned
  accounts never show as online; the feed's last full page ends cleanly.

## [4.44.0] - 2026-11-21

### Added
- Notifications grouped under Today, Yesterday and Earlier.

### Fixed
- Saved replies under someone you blocked stay out of your Saved page.
- Banned members no longer linger on the Who's Online list.

## [4.43.0] - 2026-11-21

### Added
- Each notification shows when it arrived ("5 min. ago").

## [4.42.0] - 2026-11-21

### Added
- **Unread only** checkbox on the Notifications page.

### Changed
- Guides updated to cover the features from 4.31–4.41.

## [4.41.0] - 2026-11-21

### Added
- Saved posts can be filtered by board, with "Remove all saved from" a board.
- Live poll preview, with a warning for duplicate options.
- Who's Online split into Staff and Members.

### Fixed
- Saved replies under hidden threads stay out of your Saved page.

## [4.40.0] - 2026-11-21

### Added
- An end-of-feed line with a **Back to top** button.

### Fixed
- Drafts with a future date are cleaned up instead of never expiring.

## [4.39.0] - 2026-11-21

### Changed
- Suggestions are ordered by votes (likes minus dislikes) again, and show rank
  numbers (#1, #2, ...).

## [4.38.0] - 2026-11-21

### Added
- Feed view chips: Active, Newest and Unanswered (Unanswered was later removed
  in 5.0.0).

## [4.37.0] - 2026-11-21

### Added
- Very long posts fold in the feed behind Show more / Show less.

### Fixed
- The feed always pages 20 threads at a time.

## [4.36.0] - 2026-11-21

### Added
- A "Restored your unsent draft" note with a Discard button.

### Fixed
- Cancelling an unchanged edit no longer asks for confirmation.
- Posts with too many images are refused sooner.

## [4.35.0] - 2026-11-21

### Added
- Paste or drop images straight into the post box.
- Confirmation before discarding a changed edit.

### Changed
- A quieter "characters left" counter, friendlier for screen readers.

## [4.34.0] - 2026-11-21

### Added
- A **Keyboard shortcuts** list.

### Changed
- Much faster home feed reply counts.

## [4.33.0] - 2026-11-21

### Changed
- Lighter chat polling, and a faster DM list.

## [4.32.0] - 2026-11-21

### Added
- **Unread only** in the chat list.

### Fixed
- Signing out now clears every bit of account data the forum keeps in your
  browser.

## [4.31.0] - 2026-11-21

### Added
- Mute a chat; rename a group chat you made.

## [4.30.0] - 2026-11-21

### Added
- **Next reply from the author** to step through the thread starter's replies.

### Changed
- Guides updated.

## [4.29.0] - 2026-11-21

### Added
- Quote just the part of a reply you selected.

### Fixed
- Signing out on a shared computer clears your data from it.
- Wall formatting, image viewer and Fold all fixes.

## [4.28.0] - 2026-11-21

### Added
- **Formatting help** cheat sheet under the post box.

## [4.27.0] - 2026-11-21

### Added
- **Fold all replies**.

### Fixed
- Keyboard and screen reader fixes across spoilers, the image viewer,
  notifications, the GIF gallery, settings search and the moderation desk.

## [4.26.0] - 2026-11-21

### Added
- A better image viewer, a "Recently used" row and Newest/Most used sorting in
  the GIF gallery.

## [4.25.0] - 2026-11-21

### Added
- A welcome card for new members and a "New tricks to try" card for everyone.

## [4.24.0] - 2026-11-21

### Added
- Post with Ctrl+Enter (⌘+Enter on a Mac).

### Fixed
- Long posts full of formatting marks no longer slow the forum down.
- No more broken symbols at the end of previews.

## [4.23.0] - 2026-11-21

### Added
- **Download my data**.
- "Find a setting" and "Jump to a section" in account settings.

## [4.22.0] - 2026-11-21

### Added
- **Show spoilers** button; spoilers stay hidden in every preview.

## [4.21.0] - 2026-11-21

### Added
- Notifications grouped by thread, easier-to-read poll results, and search
  highlights your words.

## [4.20.0] - 2026-11-21

### Added
- **Jump to my reply**.

### Fixed
- Spoilers stay hidden in previews.

## [4.19.0] - 2026-11-21

### Added
- Question of the Day: a QOTD chip, a "Today's question" banner and a
  "You answered" chip.
- A Showcase gallery.

## [4.18.0] - 2026-11-21

### Added
- "Member since" and **Recent threads** on profiles; formatting on wall posts.

## [4.17.0] - 2026-11-21

### Added
- Fold a reply; **Back to the first post** on long threads.

### Fixed
- Pinned chats, Read aloud and J/K with Caps Lock fixes.

## [4.16.0] - 2026-11-21

### Added
- A **You** chip on your own posts.

### Fixed
- Pressing Enter to pick a character in Japanese, Chinese or Korean input no
  longer sends your message.

## [4.15.0] - 2026-11-21

### Added
- Copy buttons on code blocks.

### Changed
- Threads open a bit faster.

## [4.14.0] - 2026-11-21

### Added
- **Jump to latest reply**.
- Moderation: a recent-activity peek on reports and one-step spam cleanup,
  both reversible.

## [4.13.0] - 2026-11-21

### Added
- J and K to move between posts.

### Changed
- Clearer pinned-chat button; accessibility fixes.

## [4.12.0] - 2026-11-21

### Added
- An **Author** chip on thread replies.
- **Read aloud**, using on-device voices only.

### Fixed
- An accessibility pass over copy link, chat focus and spoilers.

## [4.11.0] - 2026-11-21

### Added
- Reply to a Lobby message; filter your chat list.

### Fixed
- The Lobby shows its history when you open chat, and the chat badge counts
  everything.

## [4.10.0] - 2026-11-21

### Added
- Pinned chats and access to older group chats.

### Fixed
- Unread counts match what you can actually see.

## [4.9.0] - 2026-11-21

### Added
- **Copy link** on posts and replies; text size options.

### Fixed
- Drafts belong to the account that wrote them and are cleared on sign out.

## [4.8.0] - 2026-11-21

### Added
- Error messages in your language, times in your language's format, spoiler
  tags, and a post preview.

### Fixed
- Right-to-left layouts.

## [4.7.0] - 2026-11-21

### Added
- Group chats (up to 10 people), images in DMs, and optional message effects.

## [4.6.0] - 2026-11-21

### Added
- The forum in 21 languages, with right-to-left support for Arabic and Hebrew.

## [4.5.0] - 2026-11-21

### Added
- Drafts that save themselves, @mention suggestions, "New since your last
  visit" markers, and a thread at-a-glance strip.

## [4.0.0] – [4.4.0] - 2026-11-05 to 2026-11-06

### Added
- 4.2: a section-based moderation desk and fixes for ban appeals.
- 4.3: the word filter moved into the database, with a desk editor and bulk
  add.
- 4.4: member blocks, a Who's Online roster, and a banner that offers a reload
  when a new version is live.

### Changed
- 4.0: the server code was split from a few large files into small modules
  with a shared core, and the responsive layout was rebuilt.

## [3.0.0] – [3.1.x] - 2026-10-16 to 2026-11-04

### Added
- 3.0: installable on phones (PWA), forum rules page and site settings.
- 3.1: auto-moderation, ban appeals, roles, network bans, categories, and live
  chat with direct messages.

### Fixed
- 3.0.1: fixes for live issues and gallery images; hidden posts moved to the
  moderation desk.

## [2.x] - 2026-10-10 to 2026-10-16

### Added
- The first versions of the forum: boards, threads and replies, a version
  stamp in the footer, public edit history, view counts, profile accent themes,
  a "My posts" tab, a markdown subset, the Suggestions board, image
  attachments, the GIF library, custom profile CSS, search by author and reply
  text, and a leaderboard.
