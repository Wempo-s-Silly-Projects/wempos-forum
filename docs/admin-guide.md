# Admin guide

This is for forum staff: admins and the owner. Members never see these tools.
For a section-by-section walk through the moderation desk, see the
[moderation desk reference](moderation.md) — this page is the overview.

## Roles

| Role | Can do |
|---|---|
| Member | Read, post, reply, react, chat, report |
| Admin | Everything a member can, plus the moderation desk, posting on the Updates board, marking suggestions resolved or declined, pinning and locking threads, slow mode, staff picks, tags, and editing any thread's tags and TL;DR |
| Owner | Everything an admin can, plus promoting members to admin and demoting admins |

Notes:

- Staff (admins and the owner) are listed under **Staff** on Who's Online,
  unless they go invisible.
- The owner's account can't be banned, demoted or bulk-hidden from the desk,
  and staff can't use the bulk tools on their own posts.
- Role changes take effect on the member's next request; nobody needs to sign
  out.

## The moderation desk

Open **Moderation desk** from the **Account** menu in the header (on phones,
from **More** in the bottom bar) while signed in as staff. Members never see
the entry. Its sections:

- **Overview** — the front page of the desk, with a tile for each section.
- **Post reports** and **Profile reports** — what members have flagged. Each
  report lets you dismiss it, hide the post, or ban the member. **Recent
  activity** shows the member's 10 newest posts at a glance, and **Hide posts**
  cleans up a spam run (1–50 of their newest public posts) in one step.
  - **Claim** a post report so other staff know you're handling it ("Claimed
    by @name"); anyone on staff can release it, and resolving or dismissing
    the report clears the claim. Profile and DM reports can't be claimed yet.
  - **Staff notes**: inside **Recent activity** you can add short notes
    about the member (up to 500 characters) and delete them. Only staff ever
    see them: not on profiles, feeds, search, exports, agent tools or page
    previews, and never the member they're about.
- **Hidden posts** — everything hidden by staff plus everything by actively
  banned members. Hidden posts can always be restored; nothing is deleted.
- **Bans & members** — ban a member for a set time or permanently, search
  members to unban them. Timed bans lift on their own when they expire.
- **Appeals** — banned members can appeal; approve or deny here.
- **Word filter** — the list of masked words and patterns. Plain words match
  whole words; `/regex/` and `*glob*` entries keep their pattern power. Saving
  an empty list turns the filter off.
- **Rules** — edit the house rules shown on the Rules page.
- **Images**, **Avatars**, **Profile CSS** and **GIF library** — uploads and
  profile styling waiting for approval. Nothing a member uploads goes public
  until it's approved here.
- **Chat log** and **DM log**.
- **DM reports** — 1:1 conversations a member reported with **Report
  conversation**. Read them in the DM log, then resolve.
- **AutoMod** — everything AutoMod did, with its reason. Restore a hide right
  there; lift an AutoMod ban from **Bans & members** like any other ban.
- **Staff picks** — a log of every staff pick and unpick, newest first.
- **Tags** — create the tags members can add to their threads (up to 50 in
  all). Each tag has a slug of 2–24 characters (a–z, 0–9 and `-`), used in
  its page address `/tag/<slug>`, and a label of up to 24 characters.
- **Branding** — the forum's name, tagline and footer. An empty box goes back
  to the default.
- **Visits** — the private visit totals: visits per day, the most visited
  kinds of page and the referring sites, for the last 7 or 30 days. Only
  totals are kept (see [Privacy: what the forum counts](using-the-forum.md#privacy-what-the-forum-counts)).
  If counting is switched off (`ANALYTICS_ENABLED`), the page says so and
  older totals show until they expire.

The full details, including exactly what members see after a hide or a ban,
are in [moderation.md](moderation.md).

### Banning with care

The ban form has an option to also block the member's known networks. It
refuses sign-in and new accounts from every network address they've signed in
from, and unbanning removes it. Shared connections (schools, homes, cafés)
get blocked too, so only use it when you really need it.

## Staff tools on a thread

On a thread's first post, staff get a **Staff** menu inside **More**:

- **Pin** / **Unpin** keeps a thread at the top of the feed.
- **Lock** / **Unlock**: a locked thread shows "This thread is locked" and
  no reply box. Members can't reply on the site or through the agent (MCP)
  reply tool; staff still can. Reading, reactions and edits to existing
  replies carry on, and unlocking brings replies back. You can add an
  optional reason (up to 200 characters, one line). The reason and who
  locked the thread are shown to staff only.
- **Make staff pick** (public Showcase threads only): the thread is shown as
  **Staff pick ⭐** at the top of the Showcase gallery and on This week
  (`/week`). The newest pick wins; a pick that is later hidden, or whose
  author is banned, stops showing on its own. Every pick and unpick goes in
  the desk's **Staff picks** log.
- **Suggestion status** (Suggestions board): mark an idea resolved or
  declined, or reopen it.
- **Slow mode**: one reply every 30 seconds, 1 minute, 5 minutes or
  15 minutes, or off. The thread shows a "Slow mode" note, and a member who
  replies again too soon is asked to wait. Staff are never slowed down.

Staff can also edit any thread's tags and TL;DR from the same thread page.

## AutoMod API

AutoMod is an optional automatic moderator: a program you run yourself polls
the forum and acts on what breaks the rules. It ships **switched off**. (It is
switched on for wempos-forum.com, where the owner runs the program.) The
API answers 404 unless `AUTOMOD_ENABLED = "true"` is set in `[vars]` **and**
the `AUTOMOD_KEY` secret is set (`wrangler secret put AUTOMOD_KEY`). The key
alone never turns it on.

Every request sends `Authorization: Bearer <AUTOMOD_KEY>`. A wrong or missing
key gets 401. AutoMod has no account, no cookies and no session.

- `GET /api/automod/queue?after=<cursor>&limit=<1-50>` lists new posts,
  replies, Lobby messages, wall posts, profile edits and **reported** DM
  conversations, oldest first, and returns the next `cursor`. Leave out
  `after` to start from now. Nothing written by staff ever appears, and no
  DM appears unless one of its two members reported it.
- `POST /api/automod/action` with
  `{"type", "id", "action", "reason", "ban_hours"}`. `type` is one of `post`,
  `reply`, `lobby`, `wall`, `profile` or `dm` (a DM message in a reported
  conversation). `action` is one of:
  - `hide` hides a post or reply, the same way staff hide one.
  - `ban` bans the author. Bans last at most 24 hours (longer requests are
    cut to 24), and the member can appeal like any other ban.
  - `report` flags the item for staff on the desk's AutoMod page.

AutoMod can never act on staff (403). Repeating an action does nothing new.
Every action shows on the desk's **AutoMod** page with its reason, and its
bans read "AutoMod: …". Staff undo anything with the normal Restore and
Unban.

If the key ever leaks, anyone holding it can hide posts and hand out 24-hour
bans to members (never staff) at about 45 actions a minute. Revoke it at
once: `wrangler secret delete AUTOMOD_KEY` switches the API off within
seconds (every `/api/automod/*` path answers 404 again), or
`wrangler secret put AUTOMOD_KEY` with a fresh random value rotates it so
the old key gets 401 (then give your runner the new one). Setting
`AUTOMOD_ENABLED` to anything but `"true"` and redeploying also switches it
off. Then check the desk's **AutoMod** page and use Restore and Unban on
anything the leaked key did.

## What a hide or ban does

Hiding is the forum's main tool, and it's always reversible:

- Hidden posts and posts by actively banned members disappear from every
  public place: feeds, search, profiles, notifications, the Showcase gallery,
  Today's question, This week, tag pages, RSS feeds, link previews, saved
  lists, counts and the leaderboard.
- Staff still see them on the desk, with spoilers shown, so you can judge
  what was really posted.
- When a ban ends or a post is restored, everything comes back on its own.

## Running the forum's traditions

- **Updates board**: only admins can post there. Use it for site news.
- **Suggestions**: members vote with likes and dislikes; mark each idea
  resolved or declined when it's handled.
- **Question of the Day**: the owner posts it as a normal thread whose text
  starts with "QOTD". The forum adds the chip and the home-feed banner
  automatically for the next day.

## When something's wrong

- A bug in the forum: post in **Bugs & Troubleshooting & Help**, or open an
  issue on GitHub.
- A security problem: follow [SECURITY.md](../SECURITY.md) — never post it
  publicly.
- Releases and database changes are handled by the maintainers; see the
  [release checklist](release-checklist.md).
