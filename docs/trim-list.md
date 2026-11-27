# Trim list (proposal for the owner)

**Status: DECIDED and applied (after v5.97).** Each row went its "lean" way;
the Decision column in the summary records what was done. Nothing members
relied on was removed and no table was dropped.
Written for v5.59 (ORGANIZE #4, owner order 2026-11-22, feature freeze). It
lists every feature that overlaps another, has no clear entry point, or
duplicates a capability, so the owner can choose what to keep, merge, hide or
remove. Each row offers options with their cost; the "lean" column is only the
writer's suggestion, never a decision. Builds on [the feature map](ia-map.md)
(section numbers below point at it). File references are against the v5.58.0
tree (commit f24fff5).

## How usage was measured (and why it mostly wasn't)

- No new tracking was added, and production was not queried (rule for this
  wave).
- The local D1 database (`.wrangler/state`, read from a copy) holds **0 rows
  in every table** and only 47 migrations, so it gives no usage signal.
- The forum stores no click or view analytics per control, by design (FSF
  privacy posture: limit collection). So the only signals available are:
  - **stored rows**: features that keep server rows (bookmarks, follows,
    subscriptions, mutes, folders, saved searches, notes) *could* be counted
    later by the owner with a read-only `COUNT(*)` on the live database;
    the table is named in each row so the owner can run it;
  - **browser-only**: features that store nothing on the server (jumps,
    folds, read aloud, progress bar) have no usage signal at all;
  - **code weight**: lines of client code, as a rough maintenance cost.
- "Cost" below means the work and risk of each option: lines touched, tests
  that must change, strings in 41 locales, and what members lose.

## Summary

| # | Candidate | Kind | Usage signal | Options | Lean | Decision |
|---|---|---|---|---|---|---|
| 1 | Thread jump controls (4 buttons + glance jump + outline + J/K) | overlap | none (browser-only) | keep / merge into one "Jump to" / remove buttons | merge into "Jump to" | Done: one **Jump to** (quick jumps + outline); J/K kept |
| 2 | Glance read time vs reading progress bar | overlap | none | keep / drop read time / drop bar | drop the read time line | Done: read time dropped |
| 3 | Three "keep up" models: Follow, Subscribe, Saved boards | overlap (naming) | rows: `follows`, `thread_subscriptions` | keep / rename + explain / merge | keep, rename and explain | Keep |
| 4 | "Save post" vs "Save as text" | name clash | rows: `bookmarks`; none for text | keep / rename one / hide text in More | rename "Save as text" → "Download as text" | Done: renamed **Download as text** |
| 5 | Bookmark folders vs saved-by-board chips | overlap | rows: `bookmark_folders` vs none | keep / merge into one filter row / remove one | merge into one filter row | Done: one filter row |
| 6 | Copy link (card) vs Share menu Copy link | duplicate | none | keep v5.58 state / remove card copy | remove card copy where Share exists | Done in v5.58 |
| 7 | "Open post" self-link on the thread page | duplicate | none | keep hidden / remove | remove (already hidden) | Skipped: live code that hides the self-link, low value |
| 8 | Notification controls in six places | overlap | rows: muted kinds, `thread_mutes` | keep / group in one panel | group in one settings panel | Done: tab unread moved beside quiet hours (Notifications) |
| 9 | Recent searches vs saved searches | overlap | rows: `saved_searches`; recent is browser-only | keep / merge / remove recent | keep both, explain | Keep |
| 10 | Text size, reading comfort, high contrast, corners, reset | overlap (settings sprawl) | none (browser-only) | keep / merge into one "Display" panel | merge into one panel | Done: one Appearance panel, reset covers every display choice |
| 11 | Home discovery stack (highlights, QOTD, newest members, showcase, This week, leaderboard) | overlap | none | keep / fold into This week / hide some | fold home boxes into one "This week" card | Done: one **This week** card on home |
| 12 | Four places to write (threads, profile wall, chat lobby, DMs) | overlap | rows: `posts`, `wall_posts`, `chat_messages`, `dm_messages` | keep / remove wall / remove lobby | keep (different audiences) | Keep |
| 13 | Summaries: TL;DR, glance, Save as text | overlap | rows: `thread_summaries` | keep / drop glance | keep TL;DR, see #1/#2 for glance | Keep |
| 14 | Folding: fold all, fold one, long-post fold, reply filter | overlap | none | keep / merge fold all into filter row | keep, group in one toolbar | Done: one toolbar (Jump to, Fold all, filter) |
| 15 | Quote vs Quote selection | overlap | none | keep / merge into one button | already one button; keep | Keep |
| 16 | My posts in four places (header, phone bar, feed tab, `/mine`) | duplicate | none | keep / drop the feed tab | drop the feed tab | Done: feed tab dropped; `/mine` works |
| 17 | Notifications bell vs phone-bar Alerts, tab unread count | duplicate | none | keep / drop tab unread | keep (opt-in, per device) | Keep |
| 18 | Agent surfaces: MCP, WebMCP, RSS, llms.txt, discovery | overlap | none | keep / drop WebMCP | keep; consider dropping WebMCP | Keep |
| 19 | Server `unanswered=1` filter with no client view | orphan | none | keep / remove param | keep for old links, or remove | Keep |
| 20 | Archive page vs Newest view + load older | overlap (naming) | rows: `post_archive` | keep / rename | rename to make its purpose plain | Done: renamed **Deleted posts** (`/archive` unchanged) |
| 21 | Private notes on profiles | orphan-ish | rows: `private_notes` | keep / move to More | keep | Keep |
| 22 | Who's Online card vs chat widget | overlap | rows: `presence` | keep / merge into chat | keep | Keep |

Total: **22 candidates**. Gaps the owner asked to see are listed at the end.

## Details

### 1. Thread jump controls

- **What**: on a long thread, "Jump to latest", "Jump to my reply", "Next
  reply by the author", "Back to the first post", the glance strip's
  "top reply" jump, the collapsible thread outline, and J/K keys.
- **Where**: `public/js/routes/post.js` (buttons, §4 rows 28-35),
  `latest-reply.js` (122 lines), `thread-outline.js` (165),
  `post-keys.js` (99), `thread-glance.js` (93), `reply-anchor.js` (112).
- **Overlaps**: all seven move the reader to a reply. The outline already
  lists every reply, so the buttons repeat a subset of it.
- **Usage signal**: none; browser-only, stores nothing except the outline's
  open/closed state per member (`forum-thread-outline:u<id>`).
- **Options and cost**:
  - Keep: no work; the thread page stays busy (§4 counts four jump buttons
    at depth 0).
  - Merge into one "Jump to" control (outline + latest / mine / author as
    its first entries): about 200 lines moved, the four buttons' tests
    rewritten, a few strings reused; J/K stays (keyboard users).
  - Remove the four buttons, keep outline + J/K: smallest diff (~150 lines
    out), but members who used "my reply" lose it unless the outline marks
    their replies.
- **Lean**: merge into one "Jump to" control (already named in §7 of the
  feature map).

### 2. Glance read time vs reading progress bar

- **What**: the glance strip says "about N min read"; a thin bar at the top
  shows how far down the page you are.
- **Where**: `thread-glance.js`, `reading-progress.js` (86 lines,
  `aria-hidden`).
- **Overlaps**: both answer "how long is this thread".
- **Usage signal**: none.
- **Options and cost**: keep (no work); drop the read-time line (a few
  lines, one string in 41 locales unused, one test edited); drop the bar
  (86 lines, its test file, no strings; screen readers lose nothing since
  it is hidden from them).
- **Lean**: drop the read-time line; the bar is quieter and always current.

### 3. Three "keep up" models

- **What**: Follow a member (profile), Subscribe to a thread (thread More
  menu), and Saved posts filtered by board (`/bookmarks?board=`).
- **Where**: `follows.js` + `api/follows.mjs`; `api/subscriptions.mjs`
  (+ the thread More menu); `saved-boards.js` (81 lines).
- **Overlaps**: three verbs (Follow, Subscribe, Save) for "tell me about
  this later", each with its own entry point. Note: "saved boards" is a
  filter over bookmarks, not a board subscription, which the feature map's
  wording can suggest.
- **Usage signal**: rows in `follows` and `thread_subscriptions` (owner can
  count); none for board chips.
- **Options and cost**: keep (no work); rename and add one help line each
  (strings only, 41 locales); merge Follow and Subscribe into one
  "Following" list (new page = new feature, not allowed in the freeze).
- **Lean**: keep; clarify names and help text.

### 4. "Save post" vs "Save as text"

- **What**: "Save post" bookmarks the thread; "Save as text" downloads a
  `.txt` of the visible posts.
- **Where**: `render.js` (bookmark), `thread-text.js` (175 lines).
- **Overlaps**: same verb, different features (feature map §5.3). Both now
  sit in the More menu (Following vs Reading groups).
- **Usage signal**: `bookmarks` rows; none for the download.
- **Options and cost**: rename "Save as text" to "Download as text"
  (one string in 41 locales, one test pin); remove the download (175 lines
  plus tests; members lose an offline copy; "Download my data" covers only
  their own posts).
- **Lean**: rename.

### 5. Bookmark folders vs saved-by-board chips

- **What**: two chip rows on `/bookmarks`: member-made folders and
  automatic board chips.
- **Where**: `bookmark-folders.js` (189 lines) + `api/bookmark-folders.mjs`;
  `saved-boards.js` (81).
- **Overlaps**: two ways to narrow the same list.
- **Usage signal**: `bookmark_folders` rows (owner can count); board chips
  none.
- **Options and cost**: keep (no work); one combined filter row (layout
  only, ~100 lines touched, tests for both rows edited); remove board chips
  (81 lines, linkable `?board=` URLs stop filtering); remove folders (189
  lines + API + table left in place: no migration, data kept but unused).
- **Lean**: one combined filter row.

### 6. Copy link on the card vs Share's Copy link

- **What**: a copy-link icon on every card, and Share's fallback menu also
  offers Copy link.
- **Where**: `copy-link.js` (91), `share.js` (268).
- **State**: v5.58 already shows one path on the thread page (feature map §4
  row 12). Feed and reply cards keep the icon (Share is root-only).
- **Options and cost**: keep the v5.58 state (no work); remove the card copy
  wherever Share exists (already done) and keep it elsewhere: no further
  work.
- **Lean**: keep the v5.58 state; listed so the owner can confirm the
  removal candidate in feature map §7 is closed.

### 7. "Open post" on the thread page

- **What**: a link to the page you are on.
- **State**: hidden on the thread page since v5.58; feed cards keep it.
- **Options and cost**: keep hidden (no work); delete the hidden branch
  (a few lines and one test).
- **Lean**: remove the dead branch in a cleanup wave.

### 8. Notification controls in six places

- **What**: notification kinds (settings), quiet hours (settings, device),
  unread count in the tab title (settings, device), Mute thread (thread
  More), "Unread only" (notifications page), chat mutes (chat widget).
- **Where**: `notification-prefs.js` (111), `quiet-hours.js` (156),
  `tab-unread.js` (93), `api/thread-mutes.mjs`, `notification-filter.js`
  (66), `chat-mutes.js`.
- **Overlaps**: all shape "what interrupts me", split across settings
  panels and pages; quiet hours and tab unread live in different settings
  groups.
- **Usage signal**: the stored muted kinds and `thread_mutes` rows (owner
  can count); quiet hours and tab unread are browser-only.
- **Options and cost**: keep (no work); move the three device controls into
  the Notifications settings group (layout only, settings-group tests
  edited, no strings); remove quiet hours (156 lines; members who rely on
  it lose it).
- **Lean**: group them under Notifications.

### 9. Recent searches vs saved searches

- **What**: recent searches are chips under the header search box (this
  browser only); saved searches are a named list on the results page
  (server rows).
- **Where**: `recent-searches.js` (156), `saved-searches.js` (174) +
  `api/saved-searches.mjs`.
- **Usage signal**: `saved_searches` rows; recent is browser-only.
- **Options and cost**: keep (no work); merge into one list with a pin
  action (new behaviour, out of scope in the freeze); remove recent
  (156 lines, storage-wipe sweep entry removed with it).
- **Lean**: keep both; they answer different needs (quick repeat vs named).

### 10. Display settings sprawl

- **What**: square corners, text size, line spacing, underline links, easy
  reading, high contrast, and a reset button, across the Appearance and
  Reading comfort panels.
- **Where**: `text-size.js` (79), `reading-comfort.js` (144),
  `high-contrast.js` (97), `appearance-reset.js` (73).
- **Overlaps**: one subject in two panels; reset covers only some of them.
- **Usage signal**: none (browser-only, device prefs by law).
- **Options and cost**: keep (no work); one "Display" panel and a reset that
  covers all of them (layout + reset scope, tests edited, one or two
  strings); remove easy reading or underline links (small, but they are
  accessibility aids).
- **Lean**: one panel; remove nothing.

### 11. Home discovery stack

- **What**: on home: introduction, highlights with a This week link, today's
  QOTD, newest members, showcase gallery (Showcase board), plus This week
  and Leaderboard pages in Browse.
- **Where**: `routes/feed.js` (renderHomeHighlights, QOTD slot),
  `week.js`, `traditions.js`, `api/week.mjs`, `api/traditions.mjs`,
  `api/newcomers.mjs`, `api/staff-picks.mjs`, `api/leaderboard.mjs`.
- **Overlaps**: This week already lists the staff pick and top threads;
  home repeats part of it above the feed, pushing posts down.
- **Usage signal**: none stored per view.
- **Options and cost**: keep (no work); fold the home boxes into one
  "This week" card linking to `/week` (layout, home tests edited, strings
  reused); hide QOTD or newest members (a few lines each).
- **Lean**: one card on home.

### 12. Four places to write

- **What**: threads, profile walls, the chat lobby, and DMs.
- **Usage signal**: rows in `posts`, `wall_posts`, `chat_messages`,
  `dm_messages` (owner can compare counts).
- **Overlaps**: wall and lobby are both short public messages outside
  threads.
- **Options and cost**: keep (no work); remove walls (`wall.js` 146 +
  `api/wall.mjs` + export section + tests; data left in place, no
  migration); remove the lobby (chat widget split, large).
- **Lean**: keep; each has a different audience. Use the row counts to
  revisit.

### 13. Thread summaries

- **What**: the author's TL;DR, the glance strip, and Save as text.
- **Overlaps**: the glance and the TL;DR both sit above the replies and
  both summarise.
- **Usage signal**: `thread_summaries` rows.
- **Options and cost**: see #1 (glance jump) and #2 (read time); if both go,
  the glance is only "N people talking" and could be dropped (93 lines).
- **Lean**: keep TL;DR; decide the glance with #1 and #2.

### 14. Folding and filtering replies

- **What**: Fold all, fold one reply, long-post fold in the feed, and the
  reply filter box.
- **Where**: `reply-fold.js` (110), `long-post.js` (65),
  `reply-filter.js` (115), `post.js:144-148`.
- **Usage signal**: none.
- **Options and cost**: keep (no work); put Fold all and the filter in one
  toolbar with the "Jump to" control from #1 (layout only).
- **Lean**: group, remove nothing.

### 15. Quote vs Quote selection

- **What**: Quote quotes the whole reply; with text selected it quotes the
  selection.
- **Where**: `quotes.js`, `quote-selection.js` (64).
- **State**: already one button with two behaviours.
- **Lean**: keep; listed for completeness.

### 16. My posts in four places

- **What**: header link (v5.56), phone bar item, the "My posts" feed tab,
  and the `/mine` URL.
- **Overlaps**: header and phone bar now come from one list (v5.58); the
  feed tab repeats them on home.
- **Options and cost**: keep (no work); drop the feed tab (a few lines,
  feed tab tests edited, `/mine` keeps working).
- **Lean**: drop the feed tab.

### 17. Notifications bell, phone Alerts, tab unread

- **What**: the bell (desktop), Alerts in the phone bar, and the opt-in tab
  title count.
- **State**: bell and Alerts are one control per screen size (v5.58 list).
  Tab unread is opt-in and per device.
- **Lean**: keep.

### 18. Agent surfaces

- **What**: `/mcp` (agent tools), WebMCP (`webmcp.js`, 155 lines,
  experimental browser API), RSS feeds and `/llms.txt` (`api/feeds.mjs`),
  the discovery routes (`api/discovery.mjs`).
- **Overlaps**: WebMCP repeats public read actions the MCP server and RSS
  already give.
- **Usage signal**: none stored.
- **Options and cost**: keep (no work); drop WebMCP (155 lines, its tests,
  one modulepreload line if present; no member-facing change).
- **Lean**: keep; WebMCP is the one to drop if the owner wants less code.

### 19. `unanswered=1` server filter

- **What**: the feed API still filters unanswered threads; the client view
  was removed in v5.0.0 (`public/js/feed-views.js:27`).
- **Where**: `api/posts-feed.mjs:227-249,428`.
- **Usage signal**: none (no client sends it; old links fall back,
  `router.js:30`).
- **Options and cost**: keep (no work; cursor fuzz covers it); remove the
  param (touches `api/posts-feed.mjs`, the cursor fuzz test and the
  feed-page-size pins; risk to the feed SQL).
- **Lean**: keep; the cost of touching the feed SQL is higher than the gain.

### 20. Archive page

- **What**: the accountability archive of deleted posts (`api/archive.mjs`),
  in Browse next to Suggestions and Leaderboard.
- **Overlaps**: the name reads like "old threads", which the Newest view
  and Load older already cover.
- **Usage signal**: `post_archive` rows.
- **Options and cost**: keep (no work); rename to "Deleted posts archive"
  (strings in 41 locales).
- **Lean**: rename.

### 21. Private notes on profiles

- **What**: a note about a member only you can see (`private-note.js`,
  `api/private-notes.mjs`).
- **Entry point**: only on someone else's profile; nothing lists your notes.
- **Usage signal**: `private_notes` rows.
- **Options and cost**: keep (no work); list notes in Settings (new view,
  out of scope in the freeze).
- **Lean**: keep.

### 22. Who's Online card vs chat widget

- **What**: a roster card (`who-online.js`, `who-online-groups.js`) and the
  chat widget's Who's Online tab.
- **Usage signal**: `presence` rows (live state, not usage).
- **Options and cost**: keep (no work); show the roster only inside chat
  (layout; members without chat open lose the glance).
- **Lean**: keep.

## v5.58 gaps for the owner

Not trim candidates; listed because the owner asked to see them. Both would
add something, so both wait for the owner (feature freeze).

1. **No tag index page.** Tag pages (`/tag/<slug>`) are reachable only from
  tag chips on threads (feature map §6.4). Adding an index is a new page.
  **Done:** `/tags`, in Browse, lists every tag.
2. **Phones have no language picker.** **Done in v5.60.** The header's picker
  (`routes/account-nav.js`) is not in the phone bar or its More menu, so a
  phone reader cannot change the language from the bar.

## What happens next

Decided: the owner took every row's lean (see the Decision column). No table
was dropped (data stays; no migration).
