# Admin guide

This is for forum staff: admins and the owner. Members never see these tools.
For a section-by-section walk through the moderation desk, see the
[moderation desk reference](moderation.md) — this page is the overview.

## Roles

| Role | Can do |
|---|---|
| Member | Read, post, reply, react, chat, report |
| Admin | Everything a member can, plus the moderation desk, posting on the Updates board, marking suggestions resolved or declined, pinning threads |
| Owner | Everything an admin can, plus promoting members to admin and demoting admins |

Notes:

- Staff (admins and the owner) are listed under **Staff** on Who's Online,
  unless they go invisible.
- The owner's account can't be banned, demoted or bulk-hidden from the desk,
  and staff can't use the bulk tools on their own posts.
- Role changes take effect on the member's next request; nobody needs to sign
  out.

## The moderation desk

Open **Moderation desk** from the header menu while signed in as staff. Its
sections:

- **Overview** — the front page of the desk.
- **Post reports** and **Profile reports** — what members have flagged. Each
  report lets you dismiss it, hide the post, or ban the member. **Recent
  activity** shows the member's 10 newest posts at a glance, and **Hide posts**
  cleans up a spam run (1–50 of their newest public posts) in one step.
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

The full details, including exactly what members see after a hide or a ban,
are in [moderation.md](moderation.md).

### Banning with care

The ban form has an option to also block the member's known networks. It
refuses sign-in and new accounts from every network address they've signed in
from, and unbanning removes it. Shared connections (schools, homes, cafés)
get blocked too, so only use it when you really need it.

## What a hide or ban does

Hiding is the forum's main tool, and it's always reversible:

- Hidden posts and posts by actively banned members disappear from every
  public place: feeds, search, profiles, notifications, the Showcase gallery,
  Today's question, saved lists, counts and the leaderboard.
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
