# Feature slate 2026-11-22-c (engagement opt-ins, v5.75.0, MINOR) — APPROVED

## Owner decisions (Nov 22 14:20, "all 4 opt in choices")
- **C1a, existing members: reset.** No grandfathering, no data write. Everyone is hidden until they opt in.
- **C1b, guests:** the roster is shown to signed-in members only. `GET` of the roster for a guest returns an empty list plus a sign-in hint, not a 401, so the widget's layout stays stable.
- **C2, leaderboard:** opt-in to appear, and the link moves from the main nav into the More menu. The route `/leaderboard` keeps working.
- **C3/C4, counts:** ONE device switch, "Show reaction and view counts", default **off**. When off, reaction buttons show no number and their aria-label and title carry the label only. The view chip is not rendered.

Source: read-only engagement audit (Nov 22), its 4 HIGH items. Owner approval to draft: Nov 22 14:08, "both" (this slate plus the v5.73.1 GIF fix). Nothing gets built until the owner answers the questions marked OWNER below.

Law: Defaults law (activity-revealing = OPT-IN, never default-on), FSF privacy posture. Migrations are CREATE-only with a fresh number (next free locally: 0078; verify against the remote ledger with the ritual before naming).

## C1: Who's Online becomes opt-in
- **Now:** the first heartbeat inserts `invisible = 0` (`api/chat.mjs` `PRESENCE_KEEP_SQL`), so every member is listed to everyone, guests included; the Invisible toggle is opt-out (`routes/feed.js` `renderInvisibleToggle`).
- **Change:** a new table `presence_listed (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, listed_at INTEGER NOT NULL)` (migration 0078, CREATE-only). `PRESENCE_SELECT_SQL` adds `AND EXISTS (SELECT 1 FROM presence_listed l WHERE l.user_id = p.user_id)`. The setting flips from "Invisible" to "Show me in Who's Online" (default off). Turning it on inserts a row; off deletes it. The CSRF, ban and rate-limit write path is reused.
- `presence.invisible` stays as a legacy column (never dropped); the new rule is the only gate.
- **OWNER C1a:** existing members. (a) **Reset**: everyone starts hidden until they opt in. Needs no data write and is the default here. (b) **Grandfather**: current visible members stay listed. That needs a one-time `INSERT INTO presence_listed SELECT … WHERE invisible = 0` under the remote ritual.
- **OWNER C1b:** should signed-out guests see the roster at all? Recommendation: signed-in members only.

## C2: Leaderboard becomes opt-in
- **Now:** every member with activity is ranked (`api/leaderboard.mjs`), with no way out.
- **Change:** a new table `leaderboard_optin (user_id PK, opted_at)` (same migration). The query adds `AND EXISTS (… leaderboard_optin …)` inside the inner SELECT. The existing visibility, ban and block filters stay untouched. New account setting "Include me on the leaderboard" (default off). With 0 opt-ins the page shows an empty-state line.
- **OWNER C2:** keep the leaderboard in the main nav, or move it under Explore or More?

## C3: Like/dislike counts
- **Now:** raw counts on every card (`public/js/render.js` ~328-346).
- **Change:** a device preference "Show reaction counts" (localStorage, device-pref exception, not account data). When off, the buttons keep working and announce state, but the number and the count in aria-label and title are dropped.
- **OWNER C3:** default on (today's look) or off? The defaults law covers activity-revealing features, and counts reveal other people's aggregate activity. Recommendation: **off**, with your call.

## C4: View counts
- **Now:** an eye chip with the raw count on every card, including 0 (`render.js` ~351-358; "front and center" was your v2.4.3 ask).
- **Change:** the same device preference as C3, or a separate "Show view counts" one.
- **OWNER C4:** one switch for both counts, or two? Default?

## Strings (all 65 locales, really translated)
New keys: `settings.presenceListed`, `settings.presenceListedHint`, `settings.leaderboardOptin`, `settings.leaderboardOptinHint`, `leaderboard.empty`, `settings.showCounts` (plus `settings.showViews` if C4 gets its own switch). Retired: the Invisible-toggle copy, kept until no code paints it.

## Tests (RED first)
- The roster lists only opted-in, non-banned, fresh-heartbeat members; a guest sees what C1b decides.
- The leaderboard excludes non-opted members while keeping the visibility, ban and block filters (extend wave40 cross-route visibility); bind budget is unchanged.
- Opt-in writes need CSRF and a non-banned member and are rate-limited; a delete when no row exists is a no-op (row-count-aware fakes).
- The counts pref hides numbers in text, aria-label and title, and buttons stay functional.
- The new migration is CREATE-only with a fresh number; local and remote are applied by the ritual before deploy.
- i18n parity across 65 locales.

## Ship-review
New reads (roster, leaderboard): checks 1 and 2 apply. New writes: check 3. Migration: check 7. Strings: check 6. Storage (device pref): check 5, exempt as a device preference.
