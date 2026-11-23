// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Non-function shared constants. Kept out of worker.mjs's exports because
// workerd validates every Worker export as a function or ExportedHandler.
export const PBKDF2_ITERATIONS = 100000;

export const SESSION_INSERT_IF_UNBANNED_SQL =
  "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) " +
    "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
    "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
    "AND (expires_at IS NULL OR expires_at > ?))";

export const UNBAN_ACTIVE_UPDATE_SQL =
  "UPDATE bans SET revoked_at = ?, revoked_by = ?, revocation_reason = ? " +
    "WHERE id = ? AND user_id = ? AND revoked_at IS NULL " +
    "AND (expires_at IS NULL OR expires_at > ?)";

// Threaded reply insert. The guard requires the target post to exist and be
// public, and to be either a root or the direct child of a public root
// (replies only go one level deep); the ban check stays atomic with the insert.
// Replies carry their thread ROOT's board (v2.4.1): the value is resolved from
// the already-fetched root row in api/posts.mjs, so replies across board moves
// stay consistent with their root at write time. Bind order: author_id,
// parent_id, body, created_at, last_activity_at, board, idempotency_key,
// idempotency_fingerprint, staged_at, target id, ban user_id, ban now,
// archive-guard key, archive-guard author_id, archive-guard key.
export const THREAD_REPLY_INSERT_SQL =
  "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, idempotency_key, idempotency_fingerprint, staged_at) " +
    "SELECT ?, ?, ?, 'public', ?, ?, ?, ?, ?, ? WHERE EXISTS (" +
    "SELECT 1 FROM posts WHERE id = ? AND visibility = 'public' AND (" +
    "parent_id IS NULL OR EXISTS (" +
    "SELECT 1 FROM posts root WHERE root.id = posts.parent_id " +
    "AND root.parent_id IS NULL AND root.visibility = 'public'))) " +
    "AND NOT EXISTS (SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
    "AND (expires_at IS NULL OR expires_at > ?)) " +
    "AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM post_archive archived " +
    "WHERE archived.author_id = ? AND archived.idempotency_key = ?))";

// Replies with attachments are inserted as hidden until their attachment batch
// commits. Replacing only the first visibility literal preserves the public-root
// and ban predicates below while allowing the caller to bind 'hidden'.
export const THREAD_REPLY_INSERT_STAGED_SQL = THREAD_REPLY_INSERT_SQL.replace(
  "SELECT ?, ?, ?, 'public', ?, ?, ?, ?, ?, ? WHERE EXISTS (",
  "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (",
);

// Replies bump their conversation root: last_activity_at = now on the root
// row (id resolved in JS as the target root or the target's parent). Binds
// (now, root id, reply id). The bump is tied to the new reply row itself
// (v5.59, L3): callers send it only after the guarded INSERT reported one
// changed row, and the EXISTS re-checks that this reply is public and sits
// under this root, so a refused reply (slow mode, ban, archived key) never
// moves the thread.
export const REPLY_BUMP_SQL =
  "UPDATE posts SET last_activity_at = MAX(COALESCE(last_activity_at, 0), ?) " +
  "WHERE id = ? AND visibility = 'public' AND EXISTS (" +
  "SELECT 1 FROM posts reply LEFT JOIN posts target ON target.id = reply.parent_id " +
  "WHERE reply.id = ? AND reply.visibility = 'public' " +
  "AND (reply.parent_id = posts.id OR target.parent_id = posts.id))";

// Attachment-bearing replies publish and bump together after their staged
// batch commits; the same row-bound bump.
export const STAGED_REPLY_BUMP_SQL = REPLY_BUMP_SQL;

export const RATE_LIMIT_BINDINGS = Object.freeze({
  read: "READ_RATE_LIMITER",
  write: "WRITE_RATE_LIMITER",
  "guest-session": "GUEST_SESSION_RATE_LIMITER",
  register: "REGISTER_RATE_LIMITER",
  login: "LOGIN_RATE_LIMITER",
  // Ban appeals ride the login binding: the route is a credential-gated oracle
  // (password proof before any ban answer), so it gets login-tier throttling
  // without a new wrangler binding.
  appeal: "LOGIN_RATE_LIMITER",
  totp: "TOTP_RATE_LIMITER",
  setup: "SETUP_RATE_LIMITER",
  "post-write": "POST_WRITE_RATE_LIMITER",
  "password-change": "PASSWORD_CHANGE_RATE_LIMITER",
  report: "REPORT_RATE_LIMITER",
  "avatar-upload": "AVATAR_UPLOAD_RATE_LIMITER",
  "image-upload": "IMAGE_UPLOAD_RATE_LIMITER",
  reaction: "REACTION_RATE_LIMITER",
  // The anonymous web-vitals beacon rides the read binding under its own
  // scope (its own per-caller bucket), so beacons never eat into writes.
  vitals: "READ_RATE_LIMITER",

  // Batch L: link previews ride the write tier per member (each miss is one
  // outbound fetch), on top of the per-IP read tier.
  "link-preview": "WRITE_RATE_LIMITER",
});

// The reaction allowlist (posts since v2.0; 1:1 DM messages since v5.44):
// the one value set both routes check, matching the reactions table's and
// dm_message_reactions' CHECK (value IN ('like', 'dislike')).
export const REACTION_VALUES = Object.freeze(["like", "dislike"]);

export const SEARCH_USERS_SQL =
  "SELECT id, username, role, bio, avatar_mime, avatar_updated_at, avatar_version FROM users " +
  // The WHERE group is parenthesized so appended rows (the blocks clause,
  // v4.4) AND against the whole group, not just the right OR arm.
  "WHERE (instr(username_key, ?) > 0 OR instr(lower(bio), ?) > 0) ORDER BY username_key LIMIT 20";

// Batch F: the self-hosted proof-of-work human check (ALTCHA v1, SHA-256).
// MAX_NUMBER bounds the client's search (~50k hashes on average — a second or
// two on a phone); TTL bounds how long a solved challenge stays redeemable;
// the payload cap refuses junk before any parsing.
export const ALTCHA_MAX_NUMBER = 100_000;
export const ALTCHA_TTL_SECONDS = 10 * 60;
export const ALTCHA_PAYLOAD_MAX_LENGTH = 2048;

// Owner order (Nov 22): the human/bot gate is chosen by env HUMAN_CHECK.
// "anubis" (the default when unset or unrecognised) gates HTML navigations
// through the Anubis program (TecharoHQ/anubis, run whole and unmodified
// behind the Worker; api/core/anubis-gate.mjs is the seam); writes then need
// an Anubis pass cookie OR the ALTCHA fallback (ALTCHA alone while Anubis is
// not configured); "altcha" is the lighter self-hosted per-form check
// exactly as Batch F shipped it; "off" asks for neither.
export const HUMAN_CHECK_MODES = Object.freeze({ ANUBIS: "anubis", ALTCHA: "altcha", OFF: "off" });
export const DEFAULT_HUMAN_CHECK_MODE = HUMAN_CHECK_MODES.ANUBIS;
// The path prefix Anubis serves its own challenge pages, assets and API
// under; reserved for the container, never gated by it.
export const ANUBIS_RESERVED_PREFIX = "/.within.website/";
// Anubis v1.28.2 in subrequest/forward-auth mode (TARGET=" "): the check
// endpoint the gate asks, how long it may take before the page fails open to
// ALTCHA, and how long a proxied challenge page/asset/pass may take.
export const ANUBIS_CHECK_PATH = "/.within.website/x/cmd/anubis/api/check";
export const ANUBIS_CHECK_TIMEOUT_MS = 1500;
export const ANUBIS_PROXY_TIMEOUT_MS = 8000;
// Anubis runs with CUSTOM_REAL_IP_HEADER set to this name; the worker always
// overwrites it with CF-Connecting-IP (Cloudflare rewrites X-Forwarded-For).
export const ANUBIS_CLIENT_IP_HEADER = "X-Wempo-Client-Ip";
// The API gate's 401 body error; public/js/api.js mirrors it (pinned equal by
// tests/anubis-api-recovery.test.mjs) and reloads once so the page gate can
// send the reader back through the challenge.
export const ANUBIS_API_CHALLENGE_ERROR = "human check required";
// v5.84.3: Cloudflare gives Anubis the shared Workers address on same-zone
// subrequests, so Anubis's IP allow rules never match. The worker checks the
// real network itself: a request skips the Anubis check only when its UA
// claims one of these crawlers AND request.cf.asn is that crawler's own
// network (Cloudflare derives the ASN from the connection; it can't be faked).
// Mirrors the good-crawler pairs in Anubis's data/crawlers/_allow-good.yaml.
export const ANUBIS_TRUSTED_CRAWLERS = Object.freeze([
  Object.freeze({ name: "internet-archive", ua: /\b(?:archive\.org_bot|ia_archiver)\b/i, asns: Object.freeze([7941]) }),
  Object.freeze({ name: "google", ua: /\b(?:Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google)\b/i, asns: Object.freeze([15169]) }),
  Object.freeze({ name: "bing", ua: /\b(?:bingbot|BingPreview|msnbot)\b/i, asns: Object.freeze([8075]) }),
  Object.freeze({ name: "apple", ua: /\bApplebot\b/i, asns: Object.freeze([714]) }),
]);
// The only rule Anubis's PassChallenge ever signs into a pass cookie.
export const ANUBIS_PASS_ACTION = "CHALLENGE";
// "<cookie-prefix>-auth" plus the optional dynamic "-<8 hex>" suffix.
export const ANUBIS_AUTH_COOKIE_PATTERN = /^[\w.-]+-auth(?:-[0-9a-f]{8})?$/;
// Every cookie Anubis sets: "<prefix>-auth", "-cookie-verification" and
// "-original-referer", each with the optional suffix. Only these cross the
// proxy in either direction (never forum session or Cloudflare cookies).
export const ANUBIS_COOKIE_PATTERN = /^[\w.-]+-(?:auth|cookie-verification|original-referer)(?:-[0-9a-f]{8})?$/;
export const ANUBIS_COOKIE_MAX_LENGTH = 4096;
// The largest request body the proxy forwards (Anubis's pass form is tiny).
export const ANUBIS_PROXY_MAX_BODY_BYTES = 64 * 1024;
// /api GETs that never ask Anubis: the build stamp, the ALTCHA fallback, the
// shell's own session bootstrap and setup probe, and the machine endpoints
// with their own auth (AutoMod runner key, Accounts relay token).
export const ANUBIS_API_EXEMPT_EXACT = Object.freeze(["/api/version", "/api/altcha/challenge", "/api/session", "/api/setup/status"]);
export const ANUBIS_API_EXEMPT_PREFIXES = Object.freeze(["/api/automod/", "/api/relay/"]);
export const ANUBIS_COOKIE_MAX_CANDIDATES = 4;
// The cookie Cloudflare Access sets on its own origin; never passed on.
export const ACCESS_COOKIE_NAME = "CF_Authorization";
// The Anubis pages carry no CSP of their own; this one is applied when the
// upstream sends none (inline script/style: Anubis's own page, no user text).
export const ANUBIS_PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; " +
  "form-action 'self'; frame-ancestors 'none'";

// Batch F passkeys (WebAuthn): ceremony challenge lifetime, per-member cap,
// and the display-name ceiling.
export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;
export const PASSKEY_MAX_PER_USER = 10;
export const PASSKEY_NAME_MAX_LENGTH = 64;

// v4.37 feed page size: every listRootPosts branch (activity, suggestions,
// id-cursor/search) shows this many roots per page. The per-page reply-count
// rollup binds 2n+11 values for a blocking member (api/posts-feed.mjs
// replyCountsBinds), so n must stay <= 44 under D1's bound-parameter ceiling;
// tests/wave32-feed-page-size.test.mjs measures the worst case. A larger page
// needs the IN-lists chunked first.
export const FEED_PAGE_SIZE = 20;
export const D1_MAX_BOUND_PARAMS = 100;

// v5.35 engagement: the This-week window (/week threads and showcase builds),
// the new-member window (the "New 👋" chip: an account younger than this),
// and how many members the home "Newest members" list names.
export const WEEK_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const NEW_MEMBER_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const NEWEST_MEMBERS_LIMIT = 5;

// v4.7 group DMs: members per group INCLUDING the creator, and the optional
// group name's length (the dm_groups.name CHECK in migration 0044 matches).
export const DM_GROUP_MAX_MEMBERS = 10;
export const DM_GROUP_NAME_MAX_CHARS = 60;

// v4.10: the 1:1 half of GET /api/dm/threads lists the newest N threads, and
// the groups half pages N at a time behind a ?before= cursor.
export const DM_THREAD_LIST_LIMIT = 50;
export const DM_GROUP_LIST_LIMIT = 50;

// v4.7 DM images: a message whose whole body is this token renders the
// conversation's image from /api/dm/images/:id. Only the upload routes write
// it; a typed text body of this shape is refused.
export const DM_IMAGE_TOKEN_PATTERN = /^\[img:[0-9a-f-]{36}\]$/;

// v5.47 private notes about members (migration 0072): one note per
// (owner, subject), at most PRIVATE_NOTE_MAX_CHARS characters (the table's
// CHECK matches), at most PRIVATE_NOTES_MAX subjects per owner.
export const PRIVATE_NOTE_MAX_CHARS = 280;
export const PRIVATE_NOTES_MAX = 1000;

// v5.48 saved searches (migration 0073): a name of at most
// SAVED_SEARCH_NAME_MAX_CHARS characters (the table's CHECK matches), at most
// SAVED_SEARCHES_MAX per member (enforced inside the INSERT; also the list's
// LIMIT, far below D1_MAX_BOUND_PARAMS).
export const SAVED_SEARCH_NAME_MAX_CHARS = 40;
export const SAVED_SEARCHES_MAX = 20;

// v5.50 thread TL;DR (migration 0074): one summary per root, at most
// THREAD_SUMMARY_MAX_CHARS characters (the table's CHECK matches).
export const THREAD_SUMMARY_MAX_CHARS = 280;

// v5.51 staff thread lock (migration 0075): the optional staff-only reason is
// at most THREAD_LOCK_REASON_MAX_CHARS characters (the table's CHECK matches).
export const THREAD_LOCK_REASON_MAX_CHARS = 200;

// v4.23 Download my data (GET /api/me/export): the most rows each section of
// the caller's own export carries, newest first. A section that hit its cap
// is flagged in the export's `truncated` map so the file never silently
// claims to be complete.
export const EXPORT_SECTION_CAPS = Object.freeze({
  posts: 2000,
  bookmarks: 1000,
  followedThreads: 1000,
  blocks: 1000,
  wallPosts: 1000,
  directMessages: 2000,
  // v5.44: the caller's own reactions on 1:1 DM messages (ids + value only).
  dmReactions: 2000,
  // v5.47: the caller's OWN private notes (subject username, body, time).
  privateNotes: PRIVATE_NOTES_MAX,
  // v5.48: the caller's OWN saved searches (name, q, by, in, time).
  savedSearches: SAVED_SEARCHES_MAX,
  // v5.50: TL;DR summaries the caller WROTE (post id, body, time).
  threadSummaries: 2000,
  // Batch K: the caller's OWN uploaded post images (ids + mime only; the
  // client fetches the bytes into the ZIP), GIF picks excluded.
  uploads: 500,
});

// v5.74 (slate 2026-11-22-d): vendored Prism highlighting of fenced code.
// A highlighted block gets a line-number gutter only from this many lines;
// a block longer than this many characters is never handed to Prism (stays
// plain). public/js/code-highlight.js mirrors both (the client cannot import
// this file; tests/wave574-prism.test.mjs pins them equal).
export const CODE_LINE_NUMBERS_MIN_LINES = 5;
export const CODE_HIGHLIGHT_MAX_CHARS = 20000;

// Upload pipeline: before a photo (JPEG/PNG/WebP, never a GIF or an animated
// image) is uploaded, the browser re-encodes it through a canvas, which drops
// EXIF/GPS metadata, shrinking its longest side to at most
// UPLOAD_MAX_LONG_SIDE pixels (never upscaling) and aiming for at most
// UPLOAD_TARGET_MAX_MB megabytes (UPLOAD_AVATAR_TARGET_MAX_MB for profile
// pictures, whose Worker cap is 1 MiB). public/js/upload-prep.js mirrors all
// three (the client cannot import this file; tests/upload-safety.test.mjs
// pins them).
export const UPLOAD_MAX_LONG_SIDE = 2560;
export const UPLOAD_TARGET_MAX_MB = 2;
export const UPLOAD_AVATAR_TARGET_MAX_MB = 1;

// Anonymous Core Web Vitals (api/vitals.mjs, migrations/0079). Only DAILY
// HISTOGRAMS are stored: per (UTC day, route NAME, metric) a sample count and
// VITALS_BUCKET_COUNT fixed buckets (b0..b20). A value lands in the first
// bucket whose upper edge it does not exceed; the last bucket is overflow.
// Every band threshold is an edge, so a p75 read off the buckets bands
// exactly. public/js/vitals.js mirrors VITALS_METRICS (pinned equal by
// tests/wave576-web-vitals.test.mjs).
export const VITALS_METRICS = Object.freeze(["LCP", "INP", "CLS", "FCP", "TTFB"]);
// Google's published good / poor thresholds (web.dev/articles/vitals,
// web.dev/articles/fcp, web.dev/articles/ttfb; checked 2026-11-22).
export const VITALS_THRESHOLDS = Object.freeze({
  LCP: Object.freeze([2500, 4000]),
  INP: Object.freeze([200, 500]),
  CLS: Object.freeze([0.1, 0.25]),
  FCP: Object.freeze([1800, 3000]),
  TTFB: Object.freeze([800, 1800]),
});
// Per-metric upper caps: a larger value is rejected, not clamped.
export const VITALS_METRIC_MAX = Object.freeze({ LCP: 60000, INP: 60000, CLS: 50, FCP: 60000, TTFB: 60000 });
const VITALS_MS_EDGES = Object.freeze([
  100, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500,
  1800, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 8000, 10000,
]);
const VITALS_CLS_EDGES = Object.freeze([
  0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.125, 0.15, 0.2, 0.25,
  0.3, 0.35, 0.4, 0.5, 0.6, 0.75, 1, 1.5, 2, 3,
]);
export const VITALS_BUCKET_COUNT = VITALS_MS_EDGES.length + 1;
export const vitalsBucketEdges = (metric) => (metric === "CLS" ? VITALS_CLS_EDGES : VITALS_MS_EDGES);
export const VITALS_MAX_BODY_BYTES = 512;
export const VITALS_RETENTION_DAYS = 90;
// One bounded prune per beacon / read keeps every DELETE small.
export const VITALS_RETENTION_DELETE_LIMIT = 100;
export const VITALS_WINDOWS = Object.freeze({ week: 7, month: 28 });

// Batch O: the "Make it a Quote" card (public/js/quote-card.js), drawn on an
// offscreen canvas entirely in the browser. The PNG is QUOTE_CARD_WIDTH x
// QUOTE_CARD_HEIGHT; the quote is cut to QUOTE_CARD_MAX_CHARS graphemes and
// its font shrinks from QUOTE_CARD_FONT_MAX to QUOTE_CARD_FONT_MIN px to fit.
// The client mirrors these (tests/quote-card.test.mjs pins them equal).
export const QUOTE_CARD_WIDTH = 1200;
export const QUOTE_CARD_HEIGHT = 630;
export const QUOTE_CARD_MAX_CHARS = 500;
export const QUOTE_CARD_FONT_MAX = 64;
export const QUOTE_CARD_FONT_MIN = 24;

// Batch K (data, offline and sync). The client cannot import this file;
// public/js/request-retry.js and public/js/drafts.js mirror these and
// tests/wavek-*.test.mjs pin them equal.
// api() retries an idempotent request this many extra times on a network
// error or 5xx, waiting BASE, BASE*FACTOR, ... ms between tries.
export const API_RETRY_ATTEMPTS = 2;
export const API_RETRY_BASE_DELAY_MS = 300;
export const API_RETRY_FACTOR = 3;
// Batched reads (the ZIP export's image fetches) run at most this many at once.
export const API_BATCH_CONCURRENCY = 4;
// Boot waits at most this long for IndexedDB drafts before the composer mounts.
export const DRAFT_HYDRATE_TIMEOUT_MS = 1500;

// Batch M fun extras (all opt-in, device-only). The confetti burst's particle
// count, the Konami gravity toy's body cap, the sketch canvas edge in CSS
// pixels and the shortest gap between two notification sounds.
// public/js/fun/*.js mirror these (the client cannot import this file;
// tests/batch-m-fun.test.mjs pins them equal).
export const FUN_CONFETTI_PARTICLES = 120;
export const FUN_GRAVITY_BODIES_MAX = 24;
export const FUN_SKETCH_SIZE_PX = 480;
export const FUN_SOUND_MIN_GAP_MS = 4000;

// Batch C (post content rendering). public/js/math.js and rich-blocks.js
// mirror these (the client cannot import this file;
// tests/batch-c-rendering.test.mjs pins them equal).
// One $…$ / $$…$$ run longer than this many characters stays literal text.
export const MATH_MAX_CHARS = 2000;
// A ```mermaid source longer than this is never handed to Mermaid.
export const MERMAID_MAX_CHARS = 20000;
// A diagram whose viewBox is at least this wide gets pan and zoom controls.
export const MERMAID_PAN_MIN_WIDTH = 800;
// A valid ```json block of at least this many lines gets a tree toggle.
export const JSON_TREE_MIN_LINES = 20;

// Embeds (v5.76, Batch D). A standalone link longer than this is never
// embedded (it stays an ordinary link). The only third-party frame origin a
// post may load, and only after the reader presses play. public/js/embeds/
// classify.js mirrors both (pinned equal by tests/wave576-embeds.test.mjs).
export const EMBED_URL_MAX_CHARS = 2048;
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
// CSP hash of the one static <style> the vendored WaveSurfer renderer writes
// into its shadow root (no nonce on static pages). Recomputed from
// public/js/vendor/wavesurfer.esm.js by the test, so a library swap that
// changes the style fails loudly instead of silently unstyling the waveform.
export const WAVESURFER_STYLE_HASH = "sha256-/wNXXQM7c2ofBcjrAABoSS5Ibbo1K6dLnomtT2ZNGIA=";

// v5.79.1: real standalone HTML files under public/ (not the app shell). The
// worker's honest-404 pass lets these through as themselves instead of judging
// them as SPA-fallback paths; tests/wave52-honest-404.test.mjs walks public/
// so an unlisted page fails CI. The offline page is pre-cached by public/sw.js.
export const STATIC_HTML_PAGES = Object.freeze(["/offline.html"]);

// Batch I (profiles and identity). The client mirrors each of these (it
// cannot import this file); tests/profile2-identity.test.mjs pins them equal.
// WCAG AA contrast floor for member-chosen text colours (accent on the light
// and dark paper, white banner text on the banner colour).
export const PROFILE_CONTRAST_MIN = 4.5;
// Edge length (px) of the square canvas the avatar cropper produces.
export const AVATAR_CROP_SIZE = 512;
// Profile header decorations a member may pick ("" = plain). "tint" takes a
// colour from the member's own same-origin avatar; the rest are static
// zero-image CSS patterns.
export const PROFILE_HEADER_STYLES = Object.freeze(["", "tint", "dots", "stripes", "grid"]);

// Batch L (reader safety): GET /api/link-preview fetches a pasted https link's
// OpenGraph title/description on a member's explicit click. Every hop is
// re-validated (https only, every resolved address must be public unicast),
// at most this many redirects, one overall timeout, a byte cap on the body,
// and short clamps on what is stored and returned. Images are never fetched
// or returned (no third-party hotlinking to readers).
export const LINK_PREVIEW_MAX_REDIRECTS = 3;
export const LINK_PREVIEW_TIMEOUT_MS = 5000;
export const LINK_PREVIEW_MAX_BYTES = 512 * 1024;
export const LINK_PREVIEW_URL_MAX_CHARS = 2048;
export const LINK_PREVIEW_TITLE_MAX_CHARS = 200;
export const LINK_PREVIEW_DESCRIPTION_MAX_CHARS = 300;
export const LINK_PREVIEW_SITE_MAX_CHARS = 100;
export const LINK_PREVIEW_TTL_SECONDS = 24 * 60 * 60;
export const LINK_PREVIEW_FAILURE_TTL_SECONDS = 60 * 60;
export const LINK_PREVIEW_PRUNE_AFTER_SECONDS = 7 * 24 * 60 * 60;
// DNS-over-HTTPS resolver the guard asks for A and AAAA records (Workers
// have no DNS API); a fixed public host, never a member-supplied one.
export const LINK_PREVIEW_DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
// The client's language hint (public/js/lang-detect.js mirrors it): a post
// body shorter than this many letters gets no lang attribute.
export const LANG_DETECT_MIN_CHARS = 40;

// Batch H (composer input): an HTML clipboard flavour longer than this many
// characters is pasted as plain text instead of converted to Markdown, and the
// JS autogrow fallback (only where CSS field-sizing is unsupported) stops
// growing a textarea at this height. public/js/rich-paste.js and
// public/js/autogrow.js mirror these (tests/batch-h-composer-input.test.mjs).
export const RICH_PASTE_MAX_HTML_CHARS = 200000;
export const COMPOSER_AUTOGROW_MAX_PX = 480;
