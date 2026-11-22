# Feature map (information architecture)

Where every user-facing control lives today, who sees it, and how many clicks
deep it is. Written for v5.55 (ORGANIZE #1, owner order 2026-11-22) as the
input for the organize waves that follow. File:line references are against the
v5.54.0 tree (commit 472e7a7) unless a row says "v5.55".

Legend:

- **Who**: G = guest, M = signed-in member, A = the post's author, S = staff
  (admin/owner). "M+" means every signed-in member.
- **Depth**: clicks before the control is usable. 0 = on screen when the page
  loads, 1 = behind one toggle/disclosure, 2 = behind two.
- **Flags**: OVERLAP = does the same job as another control on the same page;
  ORPHAN = no obvious entry point (hard to discover).

## 1. Site shell (every page)

| Control | Where | Who | Depth | Notes |
|---|---|---|---|---|
| Skip to content | `public/index.html:85` | G M | 0 (keyboard) | |
| Brand / home link | `index.html:88` | G M | 0 | |
| Site search (+ submit) | `index.html:93-96` | G M | 0 | |
| Theme toggle | `index.html:103` | G M | 0 | |
| Suggestions link | `routes/account-nav.js:134` | G M | 0 | OVERLAP with mobile bar item |
| Archive link | `account-nav.js:139` | G M | 0 | |
| Leaderboard link | `account-nav.js:143` | G M | 0 | |
| Rules link | `account-nav.js:147` | G M | 0 | |
| Sign in | `account-nav.js:155` | G | 0 | OVERLAP with mobile bar Sign in |
| Language picker | `account-nav.js:162,248` | G M | 0 | |
| Profile link | `account-nav.js:171` | M | 0 | |
| Saved posts link | `account-nav.js:178` | M | 0 | |
| My posts link | `account-nav.js` (v5.56) | M | 0 | v5.56: the desktop entry |
| Settings link | `account-nav.js` (v5.56) | M | 0 | v5.56: opens the settings hub `/?settings` |
| Notifications bell | `notifications.js:115` | M | 0 | OVERLAP with mobile bar item |
| Moderation desk link | `account-nav.js:195` | S | 0 | |
| Sign out | `account-nav.js:204` | M | 0 | |
| Mobile bar (Home, My posts, Suggestions, Notifications, Sign in) | `index.html:107-120` | G M | 0 (narrow screens) | My posts is otherwise only a feed tab |
| Chat widget launcher + panel (lobby, DMs, Who's Online) | `chat-widget.js` | M | 0 / 1 | |
| Status / error bars | `index.html:125-126` | G M | — | |
| Report dialog | `index.html:135` | M | 1 (from Report) | |
| Confirm dialog (delete/block) | `index.html:182` | M | 1 | |

## 2. Home / feed (`/`, `/c/<board>`, `/mine`, search)

| Control | Where | Who | Depth | Notes |
|---|---|---|---|---|
| Introduction | `routes/feed.js:88` | G M | 0 | |
| Newcomer cards | `feed.js:106` | M (new) | 0 | |
| Feed tabs (Recent activity / My posts) | `feed.js:371` | M | 0 | |
| Composer (category select, attach, gallery, poll) | `feed.js:117`, `routes/composer.js:122-162` | M | 0 | Poll and gallery open dialogs (depth 1) |
| Today's QOTD | `feed.js:471` | G M | 0 | |
| Highlights + "This week" link | `feed.js:493`, `week.js:82` | G M | 0 | Only entry point to `/week` |
| Showcase gallery | `feed.js:509` | G M | 0 | |
| Feed views (Active / Newest …) | `feed-views.js:37` | G M | 0 | |
| Search filters + saved searches + recent searches | `feed.js:130-134` | G M | 0 (search only) | |
| Post cards (see §4 card actions) | `render.js:198` | G M | 0 | Every card carries the full action row |
| Load older posts | `feed.js:144` | G M | 0 | |
| **Account settings** (one `<details>` at the bottom of home) | `feed.js:151-263` | M | 1 + scroll | v5.56: moved to the hub `/?settings` (header Settings link); home keeps one link here. The panels below sit in four groups: Appearance & reading, Notifications, People & privacy, Account & data |
| ↳ Settings filter + section jump links | `feed.js:262` | M | 1 | |
| ↳ Appearance: corners, text size, tab unread, reset | `feed.js:176-183` | M | 1 | |
| ↳ Reading comfort: line spacing, underline links, easy reading, contrast | `feed.js:188-196` | M | 1 | |
| ↳ Quiet hours | `feed.js:200` | M | 1 | |
| ↳ Notification preferences | `feed.js:207` | M | 1 | |
| ↳ Change password | `feed.js:209` | M | 1 | |
| ↳ Two-factor + backup codes | `feed.js:230`, `routes/twofa.js:39` | M | 1 | |
| ↳ Sessions (sign out others) | `feed.js:233`, `account-security.js:71` | M | 1 | |
| ↳ Blocked members | `feed.js:236`, `routes/blocks.js:32` | M | 1 | |
| ↳ Following | `feed.js:238`, `follows.js:83` | M | 1 | |
| ↳ Presence (visible / invisible) | `feed.js:285` | M | 1 | |
| ↳ Download my data | `feed.js:249`, `data-export.js:45` | M | 1 | |
| ↳ Invite link | `feed.js:251` | M | 1 | |
| ↳ Delete account | `feed.js:252-257` | M | 1 | |

## 3. Other pages

| Page | Controls | Where | Who | Notes |
|---|---|---|---|---|
| Profile `/users/<name>` | Chat, Block, Follow, Report profile, private note, pinned thread, status form, avatar/banner/CSS editor, wall (post, pin), recent threads | `routes/profile.js:117-290`, `profile-editor.js`, `wall.js` | G M A | Own-profile editing panels stack under the header (many panels, depth 0) |
| Notifications `/notifications` | Mark all read, open notification, open thread | `notifications.js:185-239` | M | |
| Saved `/bookmarks` | Folder filter, create/remove folder, saved boards, load more | `routes/feed.js:548-640`, `bookmark-folders.js`, `saved-boards.js` | M | |
| Tag `/tag/<slug>` | Thread rows, load more | `routes/pages.js:89`, `tags.js:126-160` | G M | Reached from tag chips only |
| Week `/week` | Week summary, staff pick | `routes/pages.js:78`, `week.js` | G M | ORPHAN-ish: only the home highlights link |
| Archive, Leaderboard, Rules | load more archive | `routes/pages.js:37-155` | G M | |
| Moderation desk `/admin/*` | Sections (reports, appeals, automod, media, chat log, members, staff tools, tags, staff picks, rules, CSS) | `routes/admin.js`, `desk/*.js` | S | |

## 4. Thread page `/posts/<id>` (v5.54 inventory)

Rendered top to bottom by `routes/post.js:66-183`; the root card by
`render.js:198-579`.

| # | Control / panel | Where | Who | Depth | Flags |
|---|---|---|---|---|---|
| 1 | "Conversation" heading | `post.js:69` | G M | 0 | |
| 2 | Author, badges, time, (edited) | `render.js:209-271` | G M | 0 | |
| 3 | Edit history toggle (diff) | `render.js:274-278` | G M | 1 | already collapsed |
| 4 | Pinned / suggestion / QOTD chips | `render.js:281-302` | G M | 0 | |
| 5 | Body, attachments (lightbox) | `render.js:305-322`, `:81` | G M | 0 | |
| 6 | Poll (vote, unvote, close, deadline) | `polls.js:88,164` | G M S | 0 | |
| 7 | Like / Dislike | `render.js:328-347` | G(disabled) M | 0 | |
| 8 | View count chip | `render.js:352-358` | G M | 0 | |
| 9 | Save post (bookmark) | `render.js:362-373` | M | 0 | name clash with "Save as text" |
| 10 | Reply count chip | `render.js:377-386` | G M | 0 | |
| 11 | Open post link | `render.js:387-393` | G M | 0 | OVERLAP: links to the page you are on |
| 12 | Copy link | `render.js:396` | G M | 0 | OVERLAP with Share menu's own Copy link |
| 13 | Show spoilers | `render.js:398` | G M | 0 | |
| 14 | Read aloud | `render.js:400-401` | G M | 0 | |
| 15 | Report | `render.js:402-412` | M | 0 | |
| 16 | Edit / Delete | `render.js:419-447` | A | 0 | |
| 17 | Subscribe | `render.js:454-468` | M | 0 | |
| 18 | Mute thread | `render.js:472-482` | M | 0 | |
| 19 | Pin, Lock, Staff pick, Resolve/Decline/Reopen | `render.js:530-575` | S | 0 | |
| 20 | Save as text | `post.js:72-73` | G M | 0 | |
| 21 | Slow-mode note | `post.js:76` | G M | 0 | |
| 22 | Slow-mode form | `post.js:79-81` | S | 0 | full form always open |
| 23 | Lock note + staff reason | `post.js:84-93` | G M S | 0 | |
| 24 | Tag chips | `post.js:347` | G M | 0 | |
| 25 | Tag editor (checkbox form) | `post.js:350` | A S | 0 | full form always open |
| 26 | TL;DR box (+ editor) | `post.js:104-106` | G M A S | 0 | |
| 27 | Share (+ fallback menu) | `post.js:109-110` | G M (public roots, not staff) | 0 / 1 | sits alone between TL;DR and glance |
| 28 | Thread at a glance (people, read time, top-reply jump) | `post.js:113` | G M | 0 | OVERLAP: read time vs reading progress bar; top-reply jump vs outline |
| 29 | J/K hint + shortcut sheet | `post.js:119-121` | G M | 0 / 1 | sheet only on threads with replies |
| 30 | Jump to latest / my reply / next author reply | `post.js:134-142` | G M | 0 | OVERLAP: four jump buttons + outline + J/K |
| 31 | Fold all, reply filter | `post.js:144-148` | G M | 0 | |
| 32 | Thread outline | `post.js:150` | G M | 1 | already collapsed by default (remembered per member, `forum-thread-outline:u<id>`) |
| 33 | Reply cards (Reply, Quote, copy reply link, fold, sub-replies) | `post.js:126-157`, `render.js:487-524` | G M | 0 | |
| 34 | "New since last visit" markers | `post.js:163` | M | 0 | |
| 35 | Load older replies, back to first post | `post.js:165-174` | G M | 0 | OVERLAP: first-post jump vs J/K |
| 36 | Reply composer | `post.js:176` | M | 0 | |
| 37 | Reading progress bar | `post.js:182` | G M | 0 | |

Root-card action row, interactive controls at depth 0 (v5.54): guest 6
(like, dislike, open, copy, spoilers?, read aloud, save as text), member 10,
author of the thread 12, staff up to 16, plus the share button, the slow-mode
form and the tag editor as separate blocks.

### v5.55 target (this wave)

- Header area: card header, body, poll, then **tag chips and the TL;DR inside
  the root card**, above one action row.
- Action row: at most 4 interactive controls: **Like, Dislike, Share (when the
  thread can be shared), More**. View and reply-count chips stay (not controls).
- **More** (one disclosure button, `aria-expanded`/`aria-controls`, Escape
  closes and returns focus), grouped:
  - Reading: Read aloud, Show spoilers, Save as text
  - Following: Subscribe, Mute thread, Save post (bookmark)
  - Sharing: Copy link, Open post link
  - This post: Edit, Delete, Report, Edit tags (a collapsed disclosure holding
    the tag editor)
  - **Staff** (nested disclosure, staff only): Pin, Lock, Staff pick,
    Resolve/Decline/Reopen, slow-mode form
- Collapsed by default: More, Staff, Edit tags, edit history (already),
  outline (already; its existing remembered key is reused, no new key).
- Feed cards and reply cards are unchanged in this wave.

## 5. Overlaps found

1. Copy link (card) and the Share menu's Copy link: two controls with the same
   accessible name on a thread page (`render.js:396`, `share.js:156`).
2. Open post link on the thread page points at the page itself (`render.js:387`).
3. "Save post" (bookmark) vs "Save as text": same verb, different features.
4. Navigation: four jump buttons, the glance's top-reply jump, the outline and
   J/K keys all move through replies (`post.js:113-174`).
5. Glance read time vs the reading progress bar (`post.js:113,182`).
6. Mobile bar duplicates header links (Suggestions, Notifications, Sign in).
7. My posts: feed tab and mobile bar only; not in the desktop header.
   (v5.56: now also a header link.)
8. Follow (profile), Subscribe (thread) and Saved boards are three "keep up
   with" models with three different entry points.

## 6. Orphans found

1. Account settings: no nav entry; a collapsed `<details>` under the home feed
   (`feed.js:151`). (v5.56: fixed by the header Settings link and the hub.)
2. `/week`: only the home highlights link (`week.js:82`).
3. Keyboard shortcuts sheet: only on threads that have replies (`post.js:121`).
4. Tag pages: only reachable from tag chips (no tag index for members).
5. `/join?ref=`: only via someone's invite link (by design).

## 7. Candidates for the next organize waves

- **v5.56 (account/settings)**: give Settings its own entry in the account nav
  and split the 14 stacked panels into a few groups (Appearance & reading,
  Notifications, Privacy & safety, Account).
- **v5.57/v5.58 (navigation/menus)**: fold the header's section links
  (Suggestions, Archive, Leaderboard, Rules, This week) into one "Browse" menu;
  give My posts a desktop entry; reconcile the mobile bar.
- **Thread follow-up**: merge the jump buttons and the glance top-reply jump
  into one "Jump to" control; apply the same More menu to reply cards and feed
  cards.

Removal candidates (owner approval needed, NOT done): the self-link "Open post"
on the thread page; the duplicate card Copy link when Share is present.
