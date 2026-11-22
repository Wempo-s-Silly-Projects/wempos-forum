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

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

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
