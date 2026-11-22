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

## [5.50.0] - 2026-11-22

### Added
- TL;DR for threads: the person who started a thread (or an admin or the
  owner) can add a short summary, up to 280 characters, shown in a "TL;DR"
  box above the replies. Anyone who can see the thread can read it; a hidden
  thread, a thread by a banned member, or a thread across a block shows no
  summary. The text goes through the word filter like other public text, and
  invisible direction-changing or control characters are refused. Saving an
  empty box removes the summary. Your data export lists the summaries you
  wrote. Needs database migration 0074.
- Edit history now shows what changed: each version marks the words that
  were added (underlined) and removed (struck through) compared with the
  version before it, and a "Current version" row shows the latest edit.
  Spoilers stay hidden on both sides. Very long posts fall back to showing
  the full text. This happens in your browser only; how edits are stored is
  unchanged.

## [5.49.0] - 2026-11-22

### Security
- Security review of v5.45-v5.48 (muting a thread, private notes about
  members and saved searches):
  [docs/security-reviews/2026-11-22-v5.45-v5.48.md](docs/security-reviews/2026-11-22-v5.45-v5.48.md).
  No critical or high findings, so nothing in the forum's behaviour changes
  in this release. One low finding (a note or saved-search name that starts
  with an invisible null character gets a server error instead of a clear
  "not allowed" message) and one low question for the owner (whether the
  data export should list the threads you muted) are recorded, along with
  the owner items carried over from earlier reviews. New tests lock in the
  behaviour the review checked.

## [5.48.0] - 2026-11-22

### Added
- Saved searches: signed-in members get a "Saved searches" panel on the
  search results page. "Save this search" opens a small inline form to name
  the search (up to 40 characters); each saved search is a link that runs it
  again on the normal search page, with a Delete button beside it. You can
  keep up to 20, names are unique per member (ignoring case), and only you
  can ever see them: not other members, not admins or the owner, and they
  appear in no feed, search, agent tool or page preview. Your saved searches
  are in your data export, and deleting your account removes them. New
  routes `GET` and `POST /api/me/saved-searches` and
  `DELETE /api/me/saved-searches/:id` (another member's id answers 404).
  The query, `by` and `in` values are checked with the search route's own
  rules; search itself is unchanged. Needs migration
  `0073_saved_searches.sql`.

## [5.47.0] - 2026-11-22

### Added
- Private notes about members: signed-in members get a "Your private note"
  box on other members' profiles. A note holds up to 280 characters, one per
  member, and only you can ever see it: not the member it is about, not
  other members, not admins or the owner, and it appears in no feed, search,
  agent tool or page preview. You can still read and delete a note about a
  member you blocked or who is banned. Your notes are in your data export;
  notes others keep about you are not. Deleting either account removes the
  note. New routes `GET`, `PUT` and `DELETE /api/users/:username/note`
  (an empty note is refused; use `DELETE`). Needs migration
  `0072_private_notes.sql`.

## [5.46.0] - 2026-11-22

### Added
- Mute a thread: a Mute thread / Unmute thread button on a thread's first
  post. While a thread is muted you get no notifications that come from it:
  replies to you, replies in a thread you subscribed to, @mentions inside it,
  and new-thread alerts from members you follow. Other members are not
  affected, and chat mentions and invite notices still arrive. Deleting the
  thread or your account removes the mute. New routes
  `PUT /api/posts/:id/mute` and `DELETE /api/posts/:id/mute` (thread first
  posts only), and the thread payload gains `viewerMuted` for signed-in
  members. Needs migration `0071_thread_mutes.sql`.
- Thread outline: threads with 8 or more replies get a collapsible "Jump to"
  list showing each reply's author and how long ago it was posted. Picking
  an entry scrolls to that reply and moves focus to it. The list is built in
  the browser from the replies already on the page. Whether it is open or
  closed is remembered in this browser for your account and cleared when you
  sign out.

## [5.45.0] - 2026-11-22

### Security
- Security review of v5.41-v5.44 (staff notes, report claiming, thread slow
  mode, reactions on direct messages and thread tags):
  [docs/security-reviews/2026-11-22-v5.41-v5.44.md](docs/security-reviews/2026-11-22-v5.41-v5.44.md).
  No critical or high findings, so nothing in the forum's behaviour changes
  in this release. One medium finding (several replies sent at the same
  moment can all get past a thread's slow mode) and three low findings are
  left for the owner to decide, along with the three owner items carried
  over from earlier reviews. New tests lock in the behaviour the review
  checked.

## [5.44.0] - 2026-11-22

### Added
- Reactions on direct messages: in a one-to-one conversation, either person
  can like or dislike a message (one reaction each, and pressing it again
  takes it back). Only the two people in the conversation can react or see
  the reactions; reactions are not possible while either one blocks the
  other. Group conversations do not have reactions yet. Your own reactions
  are included in "Download my data".
- Thread tags: staff can create up to 50 tags on the moderation desk. A
  thread's author (or staff) can add up to 3 tags to a thread, shown as
  chips under the first post. Each chip opens the tag's page, `/tag/<name>`,
  which lists the tagged threads newest first. Hidden threads, threads by
  banned members and threads across a block never appear there.

### Changed
- Database migration 0070 adds three new tables (DM message reactions, tags
  and thread tags). It must be applied before this version is deployed.

## [5.43.0] - 2026-11-22

### Added
- Staff notes on members: staff can add and delete short notes (up to 500
  characters) about a member from the member peek on the moderation desk.
  Notes are visible to staff only: they never appear on profiles, in feeds,
  search, exports, the agent (MCP) tools or page previews, not even to the
  member they are about.
- Report claiming: staff can claim a post report so others know it is being
  handled ("Claimed by @name"), and any staff member can release it. Only one
  person can hold a claim; resolving or dismissing the report clears it.
  Profile and DM reports are separate queues and are not claimable yet.
- Thread slow mode: staff can limit a thread to one reply every 30 seconds,
  1 minute, 5 minutes or 15 minutes. The thread shows a "Slow mode" note, and
  a member who replies again too soon (on the website or through the agent
  tools) is asked to wait. Staff are not limited.

### Changed
- Database migration 0069 adds three new tables (member notes, report
  claims, thread slow mode). It must be applied before this version is
  deployed.

## [5.42.0] - 2026-11-22

### Security
- Whole-forum privacy re-audit (done every tenth version): every page, feed
  and list added since v5.32 (RSS feeds, llms.txt, This week, newest
  members, staff picks, invites, search filters, conversation search,
  pinned threads, custom status, poll closing times, bookmark folders,
  following members and notification types) is now listed in
  [docs/visibility-inventory.md](docs/visibility-inventory.md) with the
  filters it applies and the test that checks it. No leaks were found.

### Fixed
- The automated privacy checks now also cover the newest-members list, the
  follow button's state, notification settings, the staff-pick log, and
  what staff and the site owner see on public pages and in other members'
  private folders, follows and settings.

## [5.41.0] - 2026-11-22

### Security
- Security review of v5.37-v5.40 (pinned threads, custom status, poll
  closing times, bookmark folders, following members and notification
  types):
  [docs/security-reviews/2026-11-22-v5.37-v5.40.md](docs/security-reviews/2026-11-22-v5.37-v5.40.md).
  No high or medium findings; three low findings fixed; one new owner
  decision on the data export and the two carried-over owner items remain
  open.

### Fixed
- A custom status can no longer contain the invisible characters that flip
  text direction, which could show a filtered word spelled backwards as the
  real word. Hebrew, Arabic and other right-to-left statuses work as before.
- The 200-member follow limit and the 20-folder bookmark limit now hold even
  when several requests arrive at once.

## [5.40.0] - 2026-11-22

### Added
- Notification types: a new settings panel with one checkbox per kind of
  notification: replies to your posts, new replies in threads you subscribed
  to, mentions in posts and replies, mentions in chat, new threads from
  members you follow, and friends who join with your invite link. Untick a
  kind and the forum stops creating those notifications for you; tick it
  again and new ones arrive as before. Everything starts ticked. Decisions
  about your account, like appeal results, always reach you and can't be
  turned off.
- Easy-reading spacing: a new option under Reading comfort that adds more
  space between letters, words, lines and paragraphs (the WCAG 1.4.12 text
  spacing levels). It is saved in this browser only, like the other Reading
  comfort options, and doesn't change the font.

### Fixed
- "Skip to content" (the first thing the Tab key reaches on every page) now
  moves keyboard focus straight to the main content. Before, it changed the
  page address, which made the forum redraw the page and lose your place.

### Changed
- Database migration `0068_notification_prefs.sql` adds the
  `notification_prefs` table. It is CREATE-only.

## [5.39.0] - 2026-11-22

### Added
- Bookmark folders: sort your saved posts into up to 20 private folders
  (names of 1 to 40 characters). The Saved page shows a row of folder chips;
  use "Add to folder" on a saved post, or open a folder to rename it, delete
  it or remove posts from it. One post can be in several folders, deleting a
  folder keeps its posts saved, and nobody else can see your folders. A post
  that is hidden, deleted, by a banned member or across a block never shows
  in a folder, the same as in the saved list.
- Follow a member: a Follow button on member profiles (for signed-in
  members). When someone you follow starts a new public thread, you get one
  notification. Your Following list is in your settings, with Unfollow, and
  nobody else can see who you follow or who follows you. You can't follow
  yourself, a banned member or anyone you have a block with, and blocking
  someone removes any follow between you in both directions. You can follow
  up to 200 members.

### Changed
- Database migration `0067_folders_follows.sql` adds the `bookmark_folders`,
  `bookmark_folder_items` and `user_follows` tables. It is CREATE-only.

## [5.38.0] - 2026-11-22

### Added
- Pin one of your threads to the top of your profile. Use "Pin to profile"
  next to a thread in your Recent threads; pinning another replaces it, and
  "Unpin" removes it. Only your own public threads can be pinned, and a pin
  stops showing if the thread is hidden or deleted or you are banned.
- Custom status: up to 60 characters and one emoji, shown under your name on
  your profile. Choose when it clears (never, 1 hour, 4 hours, today or
  1 week). Statuses pass the same word filter as posts. They never show for
  banned members or across a block.
- Polls can close on their own: pick a closing time from 1 hour to 30 days
  when adding the poll, or later while it is open. The thread author and staff
  can change or clear it. The poll shows "Closes in …", and once the time
  passes, voting is closed the same way as closing it by hand.

### Changed
- Database migration `0066_profile_extras.sql` adds the `profile_pins`,
  `user_status` and `poll_deadlines` tables. It is CREATE-only.

## [5.37.0] - 2026-11-22

### Security
- Security review of v5.33-v5.36 (RSS feeds, invite links, staff picks, the
  This week page, newest members, search filters and in-conversation search):
  [docs/security-reviews/2026-11-22-v5.33-v5.36.md](docs/security-reviews/2026-11-22-v5.33-v5.36.md).
  No high or medium findings; one owner decision on the data export and the
  carried-over analytics item remain open.

### Fixed
- Invite links now credit the inviter on the first page load after signing
  up: the claim was sent before the session's CSRF token was set, so the
  server refused it.

## [5.36.0] - 2026-11-22

### Added
- Search date range and sort: chips on the search page narrow results to the
  past week, month or year and sort by most relevant or newest. The choice
  rides the URL (`?since=` and `?sort=`) so a filtered search can be shared;
  `/?q=` alone works as before. Every visibility rule still applies.
- Search inside a DM or group conversation from a box in the chat header.
  Only the conversation's own members can search it, messages hidden in the
  chat view stay hidden, and excerpts mask spoilers. Clicking a result jumps
  to that message, loading older messages if needed. Queries are not logged
  or stored.
- Recent searches: your last 8 forum searches appear as chips when the search
  box is focused and empty. They stay in this browser only, can be cleared
  with "Clear recent searches", and are wiped when you sign out.

### Fixed
- In a conversation, "Load older" pages now keep their order and survive the
  5-second refresh, and a reader scrolled up keeps their place.

## [5.35.1] - 2026-11-22

### Security
- Share menu links are built with the URL parser; odd Mastodon hosts are refused.

## [5.35.0] - 2026-11-22

### Added
- A "This week" page at `/week`: the staff pick of the week on top, the most
  replied public threads created or active in the last 7 days, and the newest
  Showcase builds of the week. It shows only what the public feed shows
  (hidden posts, banned members and anyone you blocked or who blocked you
  never appear), previews mask spoilers, and it has its own page title for
  search and share previews. The home page links to it, and it is in the
  sitemap.
- A "New 👋" chip next to the name on posts and replies by accounts younger
  than 7 days. Only the yes/no flag is sent; join dates stay private.
- "Newest members" on the home page: the five newest members, each linking to
  their profile. Banned members are left out, and so is anyone on either side
  of a block with you. No notifications or emails.
- Staff pick of the week: staff (owner and admins) can make one public
  Showcase thread the staff pick from the thread's staff controls. It is
  pinned with a "Staff pick ⭐" label at the top of the Showcase gallery and
  on `/week`; the newest pick wins, and a pick that is later hidden or whose
  author is banned simply stops showing. Every pick and unpick is recorded in
  a new Staff picks log on the moderation desk. Needs migration
  `0065_featured_posts.sql`.

## [5.34.0] - 2026-11-21

### Added
- A Share button on threads (Showcase posts included). It opens your device's
  share sheet when there is one, otherwise a small menu: copy the link, or
  share to X, Bluesky, Reddit or your own Mastodon server. The links carry
  only the thread's address and title; nothing is loaded from those sites.
  The Mastodon server you type is remembered in your browser and forgotten
  when you sign out. Hidden threads, replies and staff views get no button.
- RSS feeds: `/feed.xml` for the latest public topics and `/c/<board>/feed.xml`
  for each board, with the same visibility as the public feed (spoilers
  masked). Pages link to them so feed readers find them automatically.
- Invite a friend: settings show your own `/join?ref=<you>` link. When a new
  member signs up through it, their welcome card says who invited them and
  you get a notification. Only that one link between the two accounts is
  stored, nothing is shown publicly, and nothing happens across a block or
  for a banned member. Needs migration `0064_invites.sql`.
- `/llms.txt`: a short plain-text guide to the forum for AI assistants, built
  from the forum's own name and tagline, with links to the API description,
  MCP endpoint, sitemap and feed. It contains no posts and no member data.
  The API catalog and `robots.txt` point to it.

## [5.33.0] - 2026-11-21

### Security
- A security review of 5.28 to 5.31 (private visit counts, AutoMod being
  switched on, and the per-page titles, share previews and search-engine
  data), written up in `docs/security-reviews/2026-11-21-v5.28-v5.31.md`.
- Fixed: a thread whose first line held a `$'` or similar `$` sequence could
  break its page title and share preview, copying part of the page into
  them. The text now always shows exactly as written. The same fix covers
  the forum name and tagline set on the desk.
- The admin guide now explains how to switch off or replace a leaked
  AutoMod key, and how to undo what it did.

## [5.32.0] - 2026-11-21

### Security
- A whole-forum privacy check of every page, feed, search, notification,
  chat and DM view, page preview, sitemap and agent tool against the
  visibility rules: hidden posts, banned members, blocks in either
  direction, deleted posts and staff-only records.
- Fixed: a thread's search-engine data counted replies from a member you
  blocked (or who blocked you), and replies under theirs, in its reply
  total. It now matches the count you see in the thread list.

### Changed
- The cross-route privacy test now checks one shared set of hidden, banned,
  blocked, deleted and staff-only content against every surface, including
  page previews, the sitemap and every staff-only desk; the full list lives
  in `docs/visibility-inventory.md`.

## [5.31.0] - 2026-11-21

### Added
- Real page titles and descriptions for search engines and link previews.
  Every page now names itself: the home page, each board, each thread (its
  first line as the title and the start of the post as the description) and
  each member's profile, plus a canonical link.
- Link previews. Shared links show a card with the forum's name, the page's
  title and description, and a new share image (`/og-image.png`, made from
  `public/og-image.svg`) through Open Graph and Twitter card tags.
- Structured data for search engines: the site and its organization on
  every page, and each thread as a forum posting with its author, date and
  reply count.

### Changed
- Pages that don't exist, and threads or profiles that can't be shown, ask
  search engines not to index them.

### Security
- Previews follow the same visibility rules as the forum: a hidden thread, a
  banned member's post, a reply under a hidden thread, a deleted thread and a
  member across a block all get the plain site title and description, never
  the post's words. Spoilers are masked before the excerpt is cut, and every
  value is escaped so post text can never add markup to the page.

### For self-hosters
- `OG_IMAGE_URL` (optional, in `wrangler.example.toml`) points link previews
  at your own image; leave it empty to use the forum's `/og-image.png`.

## [5.30.1] - 2026-11-21

### Changed
- AutoMod is switched on for wempos-forum.com: the automatic-moderator API
  (added in 5.18.0) now answers the owner's AutoMod runner. Everything it does
  shows on the desk's AutoMod page with its reason; hides can be restored and
  AutoMod bans (24 hours at most) can be lifted or appealed like any other.
  Self-hosted copies stay off unless they set AUTOMOD_ENABLED themselves.

## [5.30.0] - 2026-11-21

### Added
- Private visit counts. The forum now counts page views as totals only: how
  many times each kind of page (home, a thread, a profile, a board...) was
  opened each day, and which other sites people arrived from (the site's
  name only). It stores no IP address, no account, no browser details, no
  cookie and no record of single visits. Browsers that send Do Not Track or
  Global Privacy Control are never counted, and neither are bots. Totals are
  deleted after 90 days.
- A **Visits** page on the moderation desk (staff only) shows visits per
  day, the most visited kinds of page and the referring sites for the last
  7 or 30 days.
- Self-hosters turn counting on or off with `ANALYTICS_ENABLED` in
  `wrangler.toml` (off in the example file). See `docs/self-hosting.md`.
- Migration `0063_page_view_counts.sql` (new tables only).

## [5.29.0] - 2026-11-21

### Fixed
- In high contrast, a spoiler you have revealed is readable again (dark
  text on light grey, or light text on dark grey, at least 7.6:1). Spoilers
  you have not revealed stay fully blacked out.
- Save as text now leaves out the replies the reply filter is hiding, so
  the file matches what is on screen.
- A link to a reply (`#reply-123`) no longer jumps to a reply the reply
  filter is hiding.
- An automated check on the page's script tags now also catches upper-case
  tags.

## [5.28.0] - 2026-11-21

### Security
- Security review of everything shipped in 5.24–5.27 (reply links, quiet
  hours, save as text, the reading progress bar, reading comfort and high
  contrast). The full write-up is in
  [docs/security-reviews/2026-11-21-v5.24-v5.27.md](docs/security-reviews/2026-11-21-v5.24-v5.27.md).
- Nothing needed fixing. One low-risk note: a thread saved as text while
  the reply filter is in use still includes the replies the filter is
  hiding (they are replies you could already see by clearing the filter).
- New automated checks that a reply link in the address bar can only ever
  pick a reply that is already on the page, that saved thread files never
  include unrevealed spoilers, unsent edits or old versions, that their
  file names can't carry odd or hidden characters, that the settings kept
  after sign-out never hold account details, that high contrast never
  reveals a spoiler or hides the "Source code" link, and that the reading
  progress bar never piles up listeners.

## [5.27.0] - 2026-11-21

### Added
- Reading comfort: a new panel in your account settings, after Appearance,
  with two settings saved in this browser only. Line spacing (Normal,
  Relaxed or Spacious) adds space between lines in posts, chat messages and
  the boxes you type in. Always underline links underlines every link,
  including names and menu links that are normally shown without a line.
- High contrast: Auto, On or Off (Auto by default). It switches to black
  text on white (white on black in the dark theme), solid outlines around
  boxes and buttons, and thicker focus outlines; nothing on the page moves.
  Auto turns it on when your device's settings ask for more contrast, On
  always uses it, and Off never does.
- These choices stay when you sign out, like the text size, and are applied
  before the page draws, so there is no flash. Reset appearance doesn't
  change them.

## [5.26.0] - 2026-11-21

### Added
- Save as text: a "Save as text" button on a thread's first post downloads
  the posts shown on the page as a plain text file (the forum name and
  thread link, then each post's author, date and text). It uses only what
  is on screen: replies hidden by a filter are left out, folded replies
  keep just their name and date, and spoilers you haven't revealed stay
  masked. Nothing is sent or stored.
- Reading progress: a thin bar across the top of a thread page shows how
  far down the thread you've scrolled. It only appears when the thread is
  longer than the screen, doesn't animate if your device asks for reduced
  motion, and is hidden when printing.

## [5.25.0] - 2026-11-21

### Added
- Link to a specific reply: every reply on a thread page has a "Copy link
  to this reply" button. Opening that link scrolls to the reply and
  highlights it for a moment (no animation if your device asks for reduced
  motion). If the reply isn't on the page, nothing happens.
- Quiet hours (off by default): in Settings, pick a start and end hour
  (it can run past midnight, like 22:00 to 7:00). During those hours on
  this device, the unread count in the browser tab title is held back; the
  bell still updates. The setting is stored only in this browser and is
  cleared when you sign out.

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

## [4.45.1] - 2026-11-21

### Removed
- The **Unanswered** feed view (owner's call). Feeds keep Active and Newest;
  old links to the Unanswered view open the default view instead.

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

## [4.4.0] - 2026-11-06

### Added
- Member blocks, a Who's Online roster, and a banner that offers a reload
  when a new version is live.

### Fixed
- Findings from the 4.4 code scan: the DM list, thread-subscription
  notifications, profile post counts and default values in API replies.

Note: the version in `package.json` was only caught up from 3.0.1 to 4.4.0 on
2026-11-15; the 3.1 and 4.0–4.3 releases below were stamped in the code but
never in `package.json`.

## [4.0.0] – [4.3.x] - 2026-11-05 to 2026-11-06

### Added
- 4.0.1: optional two-factor sign-in with an authenticator app, and the
  profile Message button opens the actual DM thread.
- 4.2: a section-based moderation desk and fixes for ban appeals.
- 4.3: the word filter moved into the database, with a desk editor and bulk
  add.

### Changed
- 4.0: the server code was split from a few large files into small modules
  with a shared core, and the responsive layout was rebuilt.
- 4.0: the longest allowed post grew to 4,750 characters.

## [3.1.x] - 2026-11-04

### Added
- Auto-moderation, ban appeals, roles, network bans, categories, and live
  chat with direct messages. Chat has its own full page.

## [3.0.1] - 2026-10-17

### Added
- Strikethrough (`~~text~~`) in posts.
- Author flairs and accent-coloured names on post cards.

### Changed
- The GIF library became the Gallery and now takes JPEG, PNG and WebP images
  as well as GIFs.
- Hidden posts, and posts by banned members, are no longer shown to anyone on
  normal pages, including their author. Moderators and admins find them in a
  new Hidden posts section of the moderation desk.

### Fixed
- A crash when using some buttons (profile reports, custom CSS review, saving
  profile CSS).
- Reaction thumbs that showed up blank.
- The forum rules page not rendering.

## [3.0.0] - 2026-10-16

### Added
- Installable on phones (PWA), with a bottom app bar on small screens and
  larger touch targets.
- A forum rules page and site settings.

The 2.5 features were released to members as part of 3.0.0.

## [2.5.0] - 2026-10-16

### Added
- Profile accent themes, custom profile CSS (sandboxed and approved by a
  moderator), profile banners, flairs and badges, and a post counter on
  profiles.
- A red dot for unread notifications and a "My posts" tab above the composer.
- A markdown subset in posts, and a Suggestions tab in the feed.
- A GIF library with a picker in the composer.
- Following threads, @mentions with notifications, polls with changeable
  votes, private bookmarks, and pinned threads (admins).
- Search by author and through reply text, and a weekly leaderboard.

### Changed
- Identical image uploads are stored once, and an image that was already
  approved is approved again automatically.

## [2.4.3] - 2026-10-16

### Added
- View counts: each card shows how many times a thread was opened by people
  other than its author. Counts are for display only and do not change
  sorting.

## [2.4.2] - 2026-10-16

### Changed
- Version number bump only; the README was updated. No changes for members.

## [2.4.1] - 2026-10-16

### Added
- The Suggestions board, sorted by reactions.
- Authors can delete their own posts and their whole account.
- Public edit history for posts.
- A public archive of deleted posts, for accountability.

### Changed
- Banning a member hides their posts, and replies into a banned member's
  threads are refused.
- Header buttons became compact icons with tooltips, and the Turnstile check
  follows the light or dark theme.

## [2.4.0] - 2026-10-16

### Added
- Authors can edit their posts; edited posts show an "(edited)" marker.

### Fixed
- Image attachment sizing and spacing, including on narrow screens, and the
  character counter when quoting.

## [2.3.0] - 2026-10-15

### Added
- Thread cards show reply counts and previews of the latest replies, replies
  cascade under the post they answer, and posts can be quoted.
- A 1,000-character limit with a live counter in the composer.
- Collapsible social links.

### Fixed
- The word filter matches whole words only.

## [2.2.0] - 2026-10-15

### Added
- The version number is shown in the footer.
- The word filter also checks usernames and bios.

### Security
- Hardening of image attachments after a final review.

## [2.0.0] - 2026-10-15

### Added
- The second-generation forum: threads with replies, bumping, notifications,
  moderation tools and social links on profiles.
- Image attachments (including GIFs) on posts and replies, up to 10 MiB, with
  a moderation queue.
- Dark mode that follows your system setting, with a manual toggle.

## [1.0.0] - 2026-10-14

### Added
- The first release on Cloudflare Workers with a D1 database: accounts, posts,
  reactions, profile avatars, moderation and bans, and a locked first-admin
  setup.
- A Turnstile check against bots.

### Security
- Rate limits on sign-in attempts (per IP and per account), on avatar uploads
  and on reactions.
- Passwords hashed with a server-side pepper; bans and session revocation
  applied atomically.
- Origin and CSRF checks on every request that changes data, security headers
  and HSTS.
