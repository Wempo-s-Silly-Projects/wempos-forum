# Feature slate 2026-11-21-57 (wave 5.7, v5.7.0)

Areas: member profiles, category pages, the account settings page (none
touched in waves 5.5/5.6). Checked against every earlier slate: no badge
progress, no per-category regulars line and no appearance reset has shipped
(closest neighbours: wave 13 F1 Member since / F2 Recent threads on the
profile; wave 4 F3 Reader text size; wave 23 Settings filter).

## F1 — Next badge on your own profile (unique)

What: on your OWN profile only, under the milestone badge, a line
"Next badge: Big Forumer (42 of 100)" with a progress bar. At the top badge
it reads "You have the top badge." Visitors never see it.

Why: the milestone badges (New / Standard / Big / Mega / Famous) graduate
silently; members ask how far the next one is. Counts already ride the
profile payload, so nothing new is fetched or stored. Own-profile only, so
nothing new is shown to anyone else.

Files: new `public/js/badge-progress.js` (`BADGE_TIERS`, `badgeKeyFor`,
`nextBadgeProgress`, `createNextBadge`); `public/js/routes/profile.js`
(profileBadgeFor reads the shared tiers; mount for the owner only);
`public/styles.css`; `public/locales/*.json` (2 keys x 41).

Tests (`tests/wave57-badge-progress.test.mjs`): tier boundaries match the
old thresholds, progress numbers at each edge, top tier, bad counts read 0,
DOM shape (progress max/value, aria-label), own-profile-only wiring, no
storage/api()/innerHTML.

## F2 — Regulars on this page (category pages, unique)

What: on a category page, under the blurb, "Regulars on this page: ana, bo"
— up to 3 members who started 2+ of the topics on the loaded page, most
topics first (ties by name), as links to their profiles. Not shown when
nobody qualifies, and not on the staff-only Updates category.

Why: a quick sense of who is active in a category, from posts the reader is
already looking at. Derived only from the feed payload (which already obeys
the visibility law: hidden, banned and blocked authors never arrive), so no
new query, no storage, no network.

Files: new `public/js/board-regulars.js` (`pickRegulars`,
`createBoardRegulars`); `public/js/routes/feed.js` (mount in
renderCategoryRoute); `public/index.html` (modulepreload);
`public/styles.css`; `public/locales/*.json` (1 key x 41).

Tests (`tests/wave57-board-regulars.test.mjs`): threshold of 2, cap of 3,
sort order, ignores malformed rows, usernames via textContent with encoded
hrefs, null when nobody qualifies, wiring skips staffOnly boards,
page-view-only source pin.

## F3 — Reset appearance (account settings)

What: a "Reset appearance" button at the bottom of the Appearance panel
puts square corners, reader text size and the tab-title unread count back
to their defaults in this browser, updates the controls at once and says
"Appearance is back to the defaults." in a status line.

Why: three device prefs now live in the panel; one click undoes an
experiment (or a shared computer's choices) without hunting each control.
Writes each of this browser's three device-pref keys back to the value its
own control writes for the default (never a removal: the wave 5.6 sweep
keeps device prefs out of every removal); touches no account data, no
network, adds no storage key.

Files: new `public/js/appearance-reset.js` (`APPEARANCE_KEYS`,
`resetAppearance`, `createAppearanceReset`); `public/js/routes/feed.js`
(append to the Appearance panel); `public/index.html` (modulepreload);
`public/styles.css`; `public/locales/*.json` (2 keys x 41).

Tests (`tests/wave57-appearance-reset.test.mjs`): writes exactly the three
keys' defaults and nothing else (theme and account keys survive), resets the html
dataset and strips a title prefix, unticks/resets the panel controls,
status line text, survives blocked storage, wiring, no api()/innerHTML.

## Laws

No server change, no migration, no new storage key, no network call. Every
string via t() in en.json + 40 locales (real translations). User text
(usernames) via textContent only. No wording-ban terms.
