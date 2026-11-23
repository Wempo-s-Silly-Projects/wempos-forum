# Changelog

All notable changes to Wempo's Forum, newest first. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). What counts as
the public API, and what MAJOR, MINOR and PATCH mean here, is in the
[versioning policy](CONTRIBUTING.md#versioning).

The live version is shown at <https://wempos-forum.com/api/version>.

## [Unreleased]

## [5.87.0] - 2026-11-22

### Added

- Modules: an instance owner can switch whole features on or off from the
  desk (Modules page), or hard-off with `MODULE_<ID>=off`. Covers AutoMod,
  visit counts, site health, chat, polls, walls, fun extras, Saturday Fools,
  link previews and embeds; a module that is off answers 404 and its browser
  code never loads. Every existing feature stays on by default; new optional
  features will ship off. `GET /api/site` lists the modules that are on.
  See `docs/modules.md`.

## [5.86.0] - 2026-11-22

### Added

- Saturday Fools: one harmless, purely cosmetic gag on each visitor's local
  Saturday, switched per deployment (`SATURDAY_FOOLS`) with an owner-only
  off switch in the desk. Every gag keeps accessible names, has no flashing,
  and never changes what a form submits. The first one is scheduled for
  Saturday 2026-11-28 and is removed the next day.
- A translation guide (`docs/translating.md`) for volunteers, and a plan for
  a built-in, optional translation module.

## [5.85.1] - 2026-11-22

### Fixed

- A test regex flagged by code scanning (no change to the site). v5.85.0 was
  held back by the release gate; this release ships its changes.

## [5.85.0] - 2026-11-22

### Added

- Saved posts can be searched (MiniSearch), terminal-session code blocks show
  a prompt column, an opt-in "Keep screen awake" button sits on threads, and
  newcomers get a short guided tour (Driver.js).
- The image viewer has a fullscreen button.
- Photos that still carry GPS location after resizing are refused before
  upload, so a location never leaks by accident.

### Changed

- Pages load much less code up front: staff tools, fun extras, media embeds,
  the mention picker, the profile editor and the chat widget now load only
  when used (first load about 484 KB down to 285 KB compressed). The Worker
  is minified.
- No third-party script any more: the cdnjs polyfill is replaced by a small
  self-hosted core-js build that only older browsers download, and the page's
  Content-Security-Policy allows scripts from this site only.
- Animated APNG/WebP detection uses is-animated and checks the whole file.
- Cookie handling, HTML escaping, BOM stripping, feed caching and error
  logging use small well-tested libraries instead of hand-written code.

## [5.84.3] - 2026-11-22

### Fixed

- Anubis now actually gates the site. It reads the visitor address from
  `Cf-Connecting-Ip`; before, it refused every check and the site fell back
  to ALTCHA.
- The Internet Archive (Wayback Machine), Google, Bing and Apple crawlers
  are let through again. Cloudflare gives Anubis a shared address instead
  of the visitor's, so the Worker now checks the real network itself: the
  crawler's user agent must match AND the request must come from that
  crawler's own network, so a faked user agent does not help.

## [5.84.2] - 2026-11-22

### Fixed

- Anubis refused every check because the Worker did not send `X-Real-IP`, so
  the site silently fell back to ALTCHA. The Worker now sets it from the
  visitor's real address (never from a header the visitor sent).

## [5.84.1] - 2026-11-22

### Changed

- This site now runs Anubis as its human check (owner decision). Browsers
  solve a short proof-of-work challenge once; AI scrapers are refused; the
  Internet Archive and search engines are let through. If Anubis cannot be
  reached, the site falls back to the self-hosted ALTCHA check.

## [5.84.0] - 2026-11-22

### Added

- Anubis support: the Worker can now gate page loads and anonymous API reads
  through the unmodified Anubis program (forward-auth mode, behind a
  Cloudflare Tunnel and Access). Sign-up, sign-in, posts and replies need
  an Anubis pass or a solved ALTCHA check. If Anubis cannot be reached, the
  site falls back to ALTCHA. This deployment still runs ALTCHA until the
  live test passes.
- Self-hosting guide: how to run Anubis (`docs/self-hosting.md`).

### Security

- The Anubis proxy refuses foreign redirects, forwards only Anubis's own
  cookies, caps request bodies and serves its pages with a strict CSP.

## [5.83.0] - 2026-11-22

### Added

- Serbian now comes in both scripts: Српски (Cyrillic, the default for "sr")
  and Srpski (latinica). If you picked Serbian before, you will now see
  Cyrillic; choose Srpski (latinica) to keep Latin letters.
- With "reduce motion" on, GIFs now hold still in the image lightbox, the staff
  GIF queue and the traditions gallery too.
- Download my data includes your profile header choice, and the API schema
  documents it.

### Fixed

- The "human check failed" message was out of date in every language; it is
  re-translated everywhere.
- Clearer security wording in several languages (two-factor, passphrase and
  secret wording), and plural forms for counts in Belarusian and Bosnian.

### Changed

- Security docs no longer describe Cloudflare Turnstile; they describe the
  ALTCHA check, the Anubis rollout and the Worker's real outbound requests.

## [5.82.1] - 2026-11-22

### Security

- Security review of 5.73.2 to 5.82.0, written up in
  `docs/security-review-v5.74-v5.82.md`, with new regression tests.

### Fixed

- Signing out now also clears the emoji picker's recently used emoji, so the
  next person on a shared browser no longer sees them.

## [5.82.0] - 2026-11-22

### Added

- A human-check mode switch for self-hosters: `HUMAN_CHECK` = `anubis`
  (the default), `altcha` or `off`. Anubis, a whole-site proof-of-work gate,
  becomes the default once its server is connected; ALTCHA stays as the
  lighter per-form option.

### Changed

- This site keeps the ALTCHA check for now (`HUMAN_CHECK = "altcha"`); a test
  stops production from ever running in Anubis mode without the Anubis
  server behind it.
- `.dev.vars.example` and the self-hosting guide describe the new modes; the
  retired Turnstile settings are gone (a legacy `TURNSTILE_SECRET` still
  derives the ALTCHA key).

## [5.81.0] - 2026-11-22

### Added

- Composer and chat input: a keyboard-accessible formatting toolbar
  (Ctrl/Cmd+B, I and K), pasting rich text converts it to Markdown, and an
  emoji picker whose search speaks your language. The picker loads only when
  you first press its button and fetches only your language's data.
- Mention suggestions are ranked by fuzzy matching.
- A side-by-side preview you can resize, and text boxes that grow as you type.

### Changed

- Toolbar, emoji and mention inserts go through the browser's own editing, so
  Undo (Ctrl/Cmd+Z) works on them.

## [5.80.0] - 2026-11-22

### Added

- Account security: passkeys as an extra sign-in method, human-readable
  recovery codes, an in-page TOTP enrolment QR, a password strength meter and
  a passphrase suggester (both run only in your browser).
- Self-hosted proof-of-work human check (ALTCHA) replaces Cloudflare
  Turnstile; no third-party script or frame is loaded any more.
- Profiles: identicon avatars when no picture is uploaded, a square crop
  before avatar upload, contrast warnings for profile colours, and
  member-picked header patterns.
- Reader safety: an opt-in blur for strong language, a warning before
  following lookalike (homograph) links, text-only link previews fetched only
  when you click, and post language hints for screen readers.

### Changed

- The member CSS sandbox now parses with css-tree instead of hand-written
  rules.
- TOTP codes can no longer be replayed inside their time window.

### Security

- `challenges.cloudflare.com` is gone from the Content-Security-Policy.
- Link previews are SSRF-guarded: private, loopback and link-local addresses
  are refused.

## [5.79.1] - 2026-11-22

### Fixed
- The offline page (`/offline.html`) was answered as a 404 by the worker's not-found handling, so the new service worker could not cache it and offline support never activated. Real standalone pages are now served as themselves.

## [5.79.0] - 2026-11-22

### Added
- **Make it a Quote:** turn any post, reply or lobby message you can see into a shareable PNG card — avatar on the left fading into a dark background, the quote on the right with the author's name and @handle. Download it or copy the image. Spoilers stay masked; right-to-left text renders correctly (vendored canvas-txt and bidi-js).
- **Math, diagrams and logs in posts:** `$…$` / `$$…$$` math (KaTeX, self-hosted fonts), ```mermaid diagrams (strict mode, pan and zoom for big ones), coloured ```ansi / ```console logs (ansi_up) and collapsible trees for long ```json blocks (json-formatter-js). DOMPurify adds a final safety pass on everything these produce.
- **Click-to-load embeds and players:** standalone YouTube links show a local placeholder and only load youtube-nocookie after you press play; same-origin video (HLS via hls.js), audio waveforms (WaveSurfer), an accessible player skin (Plyr) and click-to-load 3D models (model-viewer). Nothing contacts a third party before you click.
- **Keyboard and navigation polish:** shortcuts (g h, g c, /, ? for help, with an off switch), a thin loading bar, badge tooltips, the "Jump to" outline follows your reading position, smooth list changes, sortable leaderboard and admin tables, counting-up scores and a header that tucks away on small screens — all still under reduced motion.
- **Offline and sync:** a service worker caches the app's static files for faster repeat visits and shows an offline page (never caches your private data); drafts move to IndexedDB; "Download my data" now streams a ZIP including your own uploaded images; signing out, theme and unread counts sync across open tabs; network hiccups retry safe requests automatically.
- **Fun extras (all off by default):** confetti for new badges, animated badge art, highlight underlines, a typed headline, synthesized notification sounds, a sketch tool for attachments and a few easter eggs — find them under Settings → Appearance.

### Security
- The page policy allows only what the new embeds need: youtube-nocookie frames after a click, local `blob:` media, and one hashed WaveSurfer style. No unsafe-inline or eval anywhere.

### Dependencies
- Vendored (all AGPL-compatible): canvas-txt, bidi-js, DOMPurify, KaTeX, Mermaid, svg-pan-zoom, ansi_up, json-formatter-js, hls.js, Plyr, WaveSurfer, model-viewer, tinykeys, NProgress, Floating UI, AutoAnimate, tablesort, CountUp.js, Headroom.js, idb-keyval, client-zip, nanoevents, canvas-confetti, Lottie (light), rough-notation, vanilla-tilt, TypeIt, Splitting, ZzFX, cursor-effects, Matter.js and signature_pad.

## [5.78.0] - 2026-11-22

### Added
- Admin "Site health" page (staff desk) showing how fast the forum feels to real visitors: the 75th-percentile Core Web Vitals (LCP, INP, CLS, FCP, TTFB) per page type over the last 7 and 28 days, banded good / needs improvement / poor.
- Anonymous, self-hosted measurement with the vendored web-vitals library (Apache-2.0): only the metric, its value and the page type are sent to the forum's own Worker, once per page view, and stored as daily totals (new `web_vitals_daily` table, migration 0079, kept 90 days). No account, IP address, user agent, cookie or URL is stored, nothing goes to a third party, and browsers sending Global Privacy Control or Do Not Track are skipped entirely. Described under Settings → Your data.

## [5.77.0] - 2026-11-22

### Added
- Oversized photos are shrunk in the browser before upload (longest side 2560 px, ~2 MB target; avatars ~1 MB) with the vendored browser-image-compression; GIFs and animated PNG/WebP are sent untouched.
- Uploaded images now carry their width and height, so threads no longer jump while images load (new `image_dimensions` table, migration 0080).

### Security
- Every image intake route (post attachments, GIF gallery, avatars, DM images) checks the file's real bytes with file-type before accepting it; the browser does a quick matching check first. SVG stays refused everywhere.

### Dependencies
- Worker: `file-type`, `image-dimensions` (MIT). Browser: `browser-image-compression` 2.0.2 (MIT, vendored).

## [5.76.1] - 2026-11-22

### Security
- JSON request bodies are parsed with secure-json-parse, refusing `__proto__` / `constructor.prototype` payloads at any depth.
- Token comparisons no longer leak length through an early return (UTF-8, padded, `crypto.subtle.timingSafeEqual` where available).
- State-changing requests marked `Sec-Fetch-Site: cross-site` or `same-site` are refused before the existing exact-origin check.
- Content-Type headers are parsed with the content-type package; JSON look-alikes and non-UTF-8 charsets on JSON routes get 415.
- The WebMCP `goTo` navigation only accepts internal paths.

### Changed
- Post, reply, chat, DM, bio and MCP bodies drop a leading byte-order mark and normalise CRLF/CR line endings to LF before length limits apply.

### Dependencies
- Added `secure-json-parse` (BSD-3-Clause) and `content-type` (MIT) to the Worker.

## [5.76.0] - 2026-11-22

### Added
- Animated GIFs in post attachments and the GIF gallery/picker now show a still first frame when the reader's device asks for reduced motion, with a play/pause "GIF" button on post attachments (same behaviour chat already had). The lightbox keeps the original image.

### Changed
- Chat and posts now share one still-frame implementation (`still-gif.js`). Only same-origin images are drawn, so a canvas is never tainted; anything else stays a plain image.

## [5.75.0] - 2026-11-22

### Added
- The forum now has a favicon: every page links the SVG icon with a PNG fallback.
- Optional unread badge on the browser-tab icon: when the "unread count in tab" setting is on, a hidden tab shows your unread notifications and direct messages (capped at 9+) on its icon. It follows quiet hours, never makes a network request, and restores the plain icon when you come back or the count reaches zero.

### Changed
- Prism's highlighted-text test now reads the token stream instead of stripping markup with a regex (CodeQL hygiene).

## [5.74.1] - 2026-11-22

### Fixed
- IPv6 network bans now key on the /64 prefix (parsed with ipaddr.js), so a banned member can no longer evade a ban by rotating their IPv6 interface address. IPv4 and IPv4-mapped addresses keep the exact previous key, and pre-existing full-address IPv6 ban rows still match during the transition.

### Dependencies
- Added `ipaddr.js` (MIT) as the Worker's first runtime dependency.

## [5.74.0] - 2026-11-22

### Added
- Code blocks that name their language after the opening fence (for
  example ```` ```js ````) are now colour-highlighted, with line numbers on
  blocks of five lines or more and the language shown when you hover or
  focus the block. Colours meet 4.5:1 contrast in light and dark themes,
  get stronger when your system asks for more contrast, and go plain in
  forced-colours mode. The highlighter (Prism 1.30.0, MIT licence, shipped
  unminified) loads only on pages with such a block; the copy button still
  copies exactly what was written, and very long blocks stay plain.

## [5.73.2] - 2026-11-22

### Fixed
- Chat GIFs no longer play on their own when your device asks for reduced
  motion. Each GIF shows a still first frame; select it to play it, and select
  it again to pause. GIF picker thumbnails stay still too.

### Changed
- Rewrote the README, agent guides and moderation docs; added
  `CONTRIBUTING.md`, `SECURITY.md`, this changelog, and human guides for
  members, admins and developers under `docs/`.

## [5.73.1] - 2026-11-22

### Security
- Security review of v5.71 to v5.73
  (`docs/security-review-v5.71-v5.73.md`): one medium issue, fixed below.
  Also checked the sixteen new language files (no markup, hidden or
  direction-changing characters; placeholders match English), the
  no-module notice, the two-state theme setting and the direct-message
  bubble change. New pins in `tests/wave5731-security-review.test.mjs`.

### Fixed
- The page's script policy allowed any script on the cdnjs code host,
  which also hosts libraries known to get around such policies. It now
  allows only the polyfill path the forum actually loads.

## [5.73.0] - 2026-11-22

### Changed
- Short direct messages now sit in a bubble only as wide as the text. Long
  messages still wrap at the old width cap, and your own bubbles line up at
  the end of the row in right-to-left languages too.

### Added
- Browsers too old to run the forum's modules now show a short notice with a
  link to get an up-to-date browser, instead of a blank page.

## [5.72.0] - 2026-11-22

### Added
- Eight more interface languages: Bislama (Bislama), Bosnian (Bosanski),
  Breton (Brezhoneg), Burmese (မြန်မာ, Myanmar script), Chamorro (Finu'
  Chamoru), Chechen (Нохчийн мотт), Chichewa (Chichewa) and Chuvash
  (Чӑвашла). Each is listed by its own name in the language picker, reads
  left to right, and is picked up automatically when the browser asks for
  it. The interface now comes in 65 languages. All eight translations await
  review by native speakers.

## [5.71.2] - 2026-11-22

### Added
- Older browsers that can't or won't update get missing JavaScript features from the cdnjs polyfill service, loaded before the forum's modules. Only HTML pages allow `https://cdnjs.cloudflare.com` in `script-src`; JSON, feeds and images keep the stricter policy, and the vendored framework file is unchanged.

## [5.71.1] - 2026-11-22

### Fixed
- The light/dark toggle now follows your device again when you click back
  to the look your device uses. Before, one click pinned the theme for good
  and later device changes were ignored.
- The image viewer, the chat panel and Who's Online no longer spill past
  the right edge by the width of a scrollbar on browsers that show one.

### Changed
- Worker deploys upload source maps and fail if one cannot be resolved, so
  error stack traces point at the original files and lines.

## [5.71.0] - 2026-11-22

### Added
- Eight more interface languages: Aragonese (Aragonés), Armenian
  (Հայերեն, Armenian script), Assamese (অসমীয়া), Avar (Авар мацӏ),
  Aymara (Aymar aru), Bambara (Bamanankan), Bashkir (Башҡорт теле) and
  Belarusian (Беларуская). Each is listed by its own name in the language
  picker, reads left to right, and is picked up automatically when the
  browser asks for it. The interface now comes in 57 languages. All eight
  translations await review by native speakers.

## [5.70.1] - 2026-11-22

### Security
- Security review of v5.67 to v5.70
  (`docs/security-review-v5.67-v5.70.md`): no vulnerabilities found and
  no code changed. Checked the eight new language files (no markup,
  hidden or direction-changing characters; placeholders match English),
  how the interface loads and shows them, the profile-update write limit
  and the sign-up account read.

### Tests
- New regression pins for those checks
  (`tests/wave5701-security-review.test.mjs`).

## [5.70.0] - 2026-11-22

### Fixed
- Muted text on hidden-post cards now meets WCAG AA contrast. The light
  theme's muted colour is a touch darker (4.53:1 on hidden-post cards,
  6.19:1 on ordinary cards); dark and high-contrast themes are unchanged.

## [5.69.0] - 2026-11-22

### Added
- Four more interface languages: Abkhaz (Аҧсуа, Cyrillic script), Afar
  (Qafar af), Amharic (አማርኛ, Ethiopic script) and Akan. Each is listed by
  its own name in the language picker, reads left to right, and is picked
  up automatically when the browser asks for it. The interface now comes
  in 49 languages. All four translations await review by native
  speakers.

### Fixed
- Plural forms no longer borrow the browser's own language rules for a
  language the browser has no plural data for (Abkhaz and Afar); those
  use the one/other split from CLDR instead.

## [5.68.0] - 2026-11-22

### Added
- Four more interface languages: Afrikaans, Albanian (Shqip),
  Azerbaijani (Azərbaycanca, Latin script) and Basque (Euskara). Each is
  listed by its own name in the language picker, reads left to right, and
  is picked up automatically when the browser asks for it. The interface
  now comes in 45 languages.

## [5.67.0] - 2026-11-22

### Security
- Profile updates (`PATCH /api/me`) are now rate-limited with the shared
  write limit, per member, like other profile writes. A signed-in member
  could previously send profile edits without limit, each one queueing an
  AutoMod review row.

### Fixed
- The account returned right after sign-up now reads all 27 social link
  fields from the one shared list, so the column lists can no longer drift
  apart. A brand-new account has no social links, so nothing visible
  changes.

### Tests
- New pins: profile updates answer 429 and write nothing once the write
  limit is spent, and use the write limiter keyed by member; the sign-up
  read selects exactly the shared social columns and nothing else.

## [5.66.0] - 2026-11-22

### Security
- Security review of v5.62.0 through v5.65.0: no critical, high or medium
  findings. Visibility, input validation, link building, SQL binds, error
  text and the v5.63.1 test fixes all checked.

### Fixed
- The profile editor's format hint for 14 social link fields (YouTube,
  Reddit, GitHub, Discord, Tumblr, Indiegogo, Shopify, Substack,
  Kickstarter, Cameo, SoundCloud, Patreon, Cash App, Venmo) works again.
  Browsers had been ignoring those patterns as invalid. The server checks
  were always in force.

### Tests
- New regression pins for all 27 social fields: every one refuses
  `javascript:` links, full web addresses, whitespace, a trailing newline
  and look-alike Unicode letters; error messages never echo the input; the
  profile update keeps its same-origin and CSRF checks and stays under the
  database's bound-parameter limit; every column keeps its 120-character
  cap; the best-effort thread bump never wraps the reply insert.

## [5.65.0] - 2026-11-22

### Added
- 17 more profile social links (owner exception to the feature freeze):
  Facebook, Tumblr, Substack, SoundCloud, Spotify (artist id), Linktree,
  Beacons, Cameo, Shopify, Kickstarter, Indiegogo, and the payment-link
  group Patreon, Ko-fi, Buy Me a Coffee, PayPal, Cash App and Venmo.
  Members enter a handle only; the forum builds each link from a fixed
  template, so a typed web address is never stored or shown. Payment links
  only open the service; the forum never handles payments (a translated
  note says so in the editor). Same visibility, export and account-deletion
  behaviour as the existing social links. Migration
  `0077_social_links_more.sql` adds one column per network.
- Social links on profiles now carry `rel="me nofollow noopener ugc"`.

## [5.64.0] - 2026-11-22

### Changed
- Docs brought up to date with v5.63.1 (no code or behaviour changes; the
  owner's feature freeze holds):
  - [docs/using-the-forum.md](docs/using-the-forum.md) explains the header,
    Browse and Account menus and the phone bar, the settings page and its
    four groups, the thread page's More menu, sharing and RSS feeds, invite
    links, This week, searching (filters, recent and saved searches), tags,
    TL;DRs, locked threads and slow mode, muting threads, following members,
    bookmark folders, custom status, private notes, poll closing times,
    notification types and DM reactions and search. The list of what
    "Download my data" includes is corrected.
  - [docs/admin-guide.md](docs/admin-guide.md) matches the desk's sections
    (Staff picks, Tags, Branding and Visits added; report claims and staff
    notes explained), says where the desk entry now lives, and gains a
    "Staff tools on a thread" section (pin, lock, staff pick, suggestion
    status, slow mode).
  - [docs/architecture.md](docs/architecture.md) lists the modules added
    since v5.30, the RSS/llms.txt, page-head and visit-count steps, and
    migrations 0060 to 0076.
  - [docs/self-hosting.md](docs/self-hosting.md) documents `OG_IMAGE_URL`
    and the optional AutoMod switch, and points at the desk by its real
    name; `wrangler.example.toml` comments refreshed and its `VERSION`
    brought up to this release.
  - [ROADMAP.md](ROADMAP.md) records what shipped since it was written and
    that the [trim list](docs/trim-list.md) awaits the owner's decision.
  - The README's feature tour matches the current forum.

## [5.63.1] - 2026-11-22

### Fixed
- Two test files stripped HTML comments in a single pass, which code scanning
  (CodeQL) flagged as incomplete sanitization. They now repeat until no comment
  is left. Test-only change; nothing members see is different.

## [5.63.0] - 2026-11-22

### Fixed
- Deleting your account no longer fails on a database built only from this
  repo's migrations (local, test or self-hosted). An old table still
  pointed at two chat tables that only the retired GooberCord app ever
  created, so the delete was refused and rolled back. New migration
  `0076_gc_fk_targets.sql` adds empty stand-ins for those two tables. It
  changes nothing where the real tables still exist. A new test deletes an
  account that has a row in every table linked to members and checks that
  nothing is left behind.
- A reply is no longer reported as failed when only the thread re-ordering
  step after it fails. The reply was already saved. The site now logs that
  step's failure, still sends notifications and answers normally, so an
  agent retrying through the MCP tool no longer posts the reply twice.
  Replies with images now publish first and re-order the thread after.
- On phones the bottom bar shows Home and Sign in straight away instead of
  staying empty until your session loads; the full bar replaces them.

## [5.62.0] - 2026-11-22

### Security
- Whole-repo visibility audit (the every-10th-release check), covering
  everything shipped or moved since v5.52:
  [docs/visibility-inventory.md](docs/visibility-inventory.md) now has 125
  rows (was 113). No leaks found. The reorganized thread page, settings
  hub, header menus and phone bar show staff tools and the moderation desk
  entry to staff only, the settings hub holds only your own panels, and
  the navigation reuse never keeps a staff entry, profile link or bell
  after a sign-out or role change. The data export, checked again as one
  surface, still carries only your own rows. Nothing on the server changes
  in this release.
- The cross-route visibility sweep now also renders the moved client
  surfaces from the same test data for a guest, a member, both sides of a
  block, an admin and the owner, and checks the settings, desk and My posts
  page shells for every viewer. Its swept-count floor rises from 326 to 338.

## [5.61.0] - 2026-11-22

### Security
- Security review of v5.57-v5.60 (the new navigation, the Browse and
  Account menus, the phone bar, the fix for replies that moved a thread
  after slow mode refused them, and the v5.60 polish):
  [docs/security-reviews/2026-11-22-v5.57-v5.60.md](docs/security-reviews/2026-11-22-v5.57-v5.60.md).
  No critical, high or medium findings, and nothing on the server changes
  in this release. The three fixes from v5.58 and v5.59 are confirmed. The
  menus and the phone bar show staff entries only to staff, and the
  navigation reuse added in v5.60 never keeps the wrong member, role or
  staff entry. Three low findings are recorded; one is fixed here (below).
  The other two: if moving a thread up the feed fails right after a reply
  is saved, the reply is posted but the poster sees an error and no one is
  notified; and on phones the bottom bar stays empty until the forum has
  loaded your session. The owner items from earlier reviews are unchanged.

### Fixed
- After "Mark all read", the notification bell could stay without its dot
  when a new notification arrived at that moment, until you opened another
  page. The header now redraws whenever the bell no longer matches your
  unread count.

## [5.60.0] - 2026-11-22

### Changed
- Phones can now change the language: the phone bar's More menu ends with
  the same language picker the desktop header has.
- The header and the phone bar are no longer rebuilt on every page update
  when nothing they show has changed (same member, unread count and page).
  Each action on a thread re-renders the page; the navigation used to cost
  a signed-in member about 230 new elements and 7 listeners each time, and
  now costs none.

### Fixed
- Accessibility pass over the reorganized thread page, settings, header
  menus and phone bar:
  - An open Browse, Account or More menu closes when keyboard focus moves
    out of it, so it no longer covers the control that has focus.
  - The menu entry for the page you are on is marked as the current page,
    for screen readers and visually (bold and underlined).
  - Menu panels have an edge that stands out from the page in every theme
    (it was too faint in the light theme).
  - The keyboard shortcuts entry in the menus is a larger target, full
    size on phones.
  - The settings page shown to signed-out visitors starts with a main
    heading.

## [5.59.0] - 2026-11-22

### Fixed
- A reply turned away by a thread's slow mode no longer moves the thread to
  the top of the "active" feed. The thread now moves up only when a reply is
  actually posted, on the website and through the agent (MCP) reply tool
  alike (security review finding L3).

### Docs
- Added `docs/trim-list.md`: a proposal for the owner listing 22 features
  that overlap, duplicate each other or are hard to find, with options and
  their cost. Nothing is decided and nothing was removed. It also lists two
  gaps from v5.58: there is no tag index page, and phones have no language
  picker.

## [5.58.0] - 2026-11-22

### Changed
- The header is tidier. Suggestions, Archive, Leaderboard, Rules and This
  week now sit in one Browse menu. Your profile, the moderation desk (staff),
  the keyboard shortcuts list and Sign out sit in one Account menu. Saved
  posts, My posts, Settings and notifications stay as their own buttons, so
  members see seven header items instead of eleven.
- The phone bar is built from the same list as the header, so the two always
  match. It shows Home, My posts, Alerts, your profile (or Sign in) and a
  More button. More holds the same Browse menu and, for members, Saved
  posts, Settings, the moderation desk (staff), the keyboard shortcuts list
  and Sign out, which phones could not reach from the bar before.
- On a thread page, Copy link appears once. When Share opens its own menu,
  Copy link is in that menu. When your device opens its share sheet instead,
  or there is no Share button, Copy link stays in More. The Open post link is
  hidden on the post it links to.

### Fixed
- Using a control inside a thread's More menu (for example Save post or Pin)
  no longer closes the menu and loses keyboard focus. More opens again and
  focus goes back to that control, or to the More button if the control is
  gone.
- On the settings page, screen readers now hear each panel's heading one
  level below its group's heading.

## [5.57.0] - 2026-11-22

### Security
- Security review of v5.53-v5.56 (the slow-mode, diff, control-character
  and lock fixes, the tidier thread page and the settings hub):
  [docs/security-reviews/2026-11-22-v5.53-v5.56.md](docs/security-reviews/2026-11-22-v5.53-v5.56.md).
  No critical, high or medium findings, so nothing in the forum's behaviour
  changes in this release. The four fixes from v5.54 are confirmed. The
  thread page's new menus show staff tools only to staff and lose no
  control, and the settings page shows only your own settings. Four low
  findings are recorded: a reply refused by slow mode in a race can still
  move its thread up the feed; the settings page's headings are all at one
  level for screen readers; using a control inside More closes the menu and
  moves keyboard focus away; and one of the v5.55 tests could not fail
  (fixed in this release, tests only). The owner items from earlier
  reviews are unchanged.

## [5.56.0] - 2026-11-22

### Changed
- Settings have a home of their own. A Settings link in the header opens
  them at `/?settings`; they used to be a collapsed box under the home feed.
  The 14 panels are grouped under four headings: Appearance & reading
  (appearance, reading comfort), Notifications (quiet hours, notification
  types), People & privacy (blocked members, following, who can see me
  online) and Account & data (password, two-factor sign-in, backup codes,
  signed-in devices, download my data, invite a friend, delete account).
  The settings search and the jump list still work, and the home page keeps
  a link where the box used to be. No setting was removed or changed.
- My posts now has a link in the header next to Saved posts.

## [5.55.0] - 2026-11-22

### Changed
- The thread page is tidier. The first post keeps four buttons (Like,
  Dislike, Share and More). Everything else is still there, grouped under
  More: Reading (read aloud, show spoilers, save as text), Following
  (subscribe, mute, save post), Sharing (copy link, post link) and This post
  (edit, delete, report, edit tags). Staff tools (pin, lock, staff pick,
  suggestion status, slow mode) sit in one Staff menu inside More. Tags and
  the TL;DR now sit with the post, above its buttons. The menus open with a
  button and close with Escape, which returns focus to that button. No
  feature was removed.
- Added `docs/ia-map.md`, a map of every page's controls: where each one
  lives, who sees it, how many clicks deep it is, and which ones overlap or
  are hard to find.

## [5.54.0] - 2026-11-22

### Fixed
- Slow mode now holds under a burst of replies sent at once: the cooldown
  check runs inside the same database write as the reply, on the website
  and on the agent reply tool, so exactly one reply lands per cooldown.
  Staff stay exempt (M1 in
  [docs/security-reviews/2026-11-22-v5.41-v5.44.md](docs/security-reviews/2026-11-22-v5.41-v5.44.md)).
- A post edited many times no longer freezes the tab when its edit history
  opens: the word-by-word comparison has a total budget per panel, and
  versions past it show as plain text (M2 in
  [docs/security-reviews/2026-11-22-v5.49-v5.52.md](docs/security-reviews/2026-11-22-v5.49-v5.52.md)).
- A private note, saved-search name or saved search that contains a control
  character (such as U+0000) is now refused with a clear error instead of a
  server error. Notes keep line breaks and tabs (L1 in
  [docs/security-reviews/2026-11-22-v5.45-v5.48.md](docs/security-reviews/2026-11-22-v5.45-v5.48.md)).
- Locking a thread at the moment its author deletes it now answers "Thread
  not found." instead of a server error (L2 in
  [docs/security-reviews/2026-11-22-v5.49-v5.52.md](docs/security-reviews/2026-11-22-v5.49-v5.52.md)).

## [5.53.0] - 2026-11-22

### Security
- Security review of v5.49-v5.52 (the thread TL;DR, the word diff in edit
  history and thread locks):
  [docs/security-reviews/2026-11-22-v5.49-v5.52.md](docs/security-reviews/2026-11-22-v5.49-v5.52.md).
  No critical or high findings, so nothing in the forum's behaviour changes
  in this release. One medium finding (a post edited many times can make
  its edit history slow to open, because every version is now compared
  word by word) and one low finding (locking a thread at the moment its
  author deletes it gives staff a server error) are recorded, with two low
  questions for the owner: whether a lock should also stop edits and TL;DR
  changes, and whether locks should leave a lasting record. The owner items
  from earlier reviews are carried over. New tests lock in the behaviour
  the review checked.

## [5.52.0] - 2026-11-22

### Security
- Whole-forum privacy re-audit (done every tenth version): every page, list
  and action added since v5.42 (staff notes, report claiming, slow mode, DM
  message reactions, thread tags, thread mutes, private notes, saved
  searches, the TL;DR, the edit-history word diff and thread locks) is now
  listed in [docs/visibility-inventory.md](docs/visibility-inventory.md)
  with the filters it applies and the test that checks it, and the data
  export was re-checked as a whole. No leaks were found.

### Fixed
- The automated privacy checks now also cover the tag list, who can see a
  thread mute, that a locked thread you cannot see never says it is locked
  (site and agent reply tool), DM reaction counts between members who
  blocked each other, every section of the data export, the staff-only
  actions added since v5.42, and the tag listing as staff see it.

## [5.51.0] - 2026-11-22

### Added
- Thread lock: admins and the owner can lock a thread from its staff menu
  (Lock / Unlock). A locked thread shows "This thread is locked" and no
  reply box; members can no longer reply to it on the site or through the
  agent (MCP) reply tool, and get a clear "This thread is locked" message
  (HTTP 423, error code `thread_locked`). Staff can still reply. Editing
  existing replies, reactions and reading are unchanged, and unlocking
  restores replies. Staff may add an optional reason (up to 200 characters,
  one line of plain text); the reason and who locked the thread are shown
  only to staff, never to members. Deleting the thread or the staff account
  removes the lock. Needs database migration 0075.

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
