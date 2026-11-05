// v4.0 core leaf: payload shapers — the SQL select template every post read
// shares, the user/post JSON projections, username validation, socials, and
// the profile-color normalization family (pure validation/mapping — publicUser
// and publicPost call the accent normalizers, so the colors live here rather
// than in the profiles topic; core never imports a topic module). Imports only
// the roles leaf.
import { publicRole } from "./roles.mjs";

export const POST_SELECT =
  "SELECT p.id, p.author_id, p.parent_id, p.body, p.visibility, p.created_at, p.last_activity_at, p.edited_at, p.board, p.view_count, p.pinned_at, " +
  "u.username AS author_username, u.avatar_mime AS author_avatar_mime, " +
  "u.avatar_updated_at AS author_avatar_updated_at, u.avatar_version AS author_avatar_version, " +
  // Flairs and profile accents ride every post (v3.0.1): feed cards show the
  // author's flair chip next to the name and the accent colors it.
  "u.flair AS author_flair, u.profile_accent AS author_accent, " +
  // Suggestion status (v3.1): resolved/declined on suggestions-board roots;
  // NULL everywhere else (replies and every other category never carry one).
  "p.suggestion_status, " +
  // Role badges (v3.1): the author's mapped role rides every post so cards
  // can chip owners/admins next to the name.
  "u.role AS author_role, " +
  "(SELECT parent.body FROM posts parent WHERE parent.id = p.parent_id) AS parent_body, " +
  "(SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.value = 'like') AS like_count, " +
  "(SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.value = 'dislike') AS dislike_count, " +
  "(SELECT r.value FROM reactions r WHERE r.post_id = p.id AND r.user_id = ?) AS viewer_reaction " +
  "FROM posts p JOIN users u ON u.id = p.author_id ";

// View counting (v2.4.3, raw impressions): one view per detail read by a
// NON-author, applied server-side on the existing GET so no extra network
// request exists. RETURNING keeps the serialized payload's count fresh —
// the same request that counts a view also reports the new total.
export const VIEW_INCREMENT_SQL =
  "UPDATE posts SET view_count = view_count + 1 WHERE id = ? RETURNING view_count";

export function isValidUsername(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]{3,24}$/.test(value);
}

// Platform keys accepted by PATCH /api/me `socials`, each with the users table
// column it persists to and the pinned per-platform handle shape (mirrors the
// migration CHECKs' 120-char ceiling; the regexes are the real gate).
export const SOCIAL_PLATFORMS = [
  { key: "youtube", column: "social_youtube", regex: /^[A-Za-z0-9._-]{1,60}$/ },
  { key: "x", column: "social_x", regex: /^[A-Za-z0-9_]{1,15}$/ },
  { key: "reddit", column: "social_reddit", regex: /^[A-Za-z0-9_-]{3,20}$/ },
  { key: "github", column: "social_github", regex: /^[A-Za-z0-9-]{1,39}$/ },
  { key: "discord", column: "social_discord", regex: /^[A-Za-z0-9._#-]{2,64}$/ },
  { key: "gitlab", column: "social_gitlab", regex: /^[A-Za-z0-9_.]{1,30}$/ },
  { key: "instagram", column: "social_instagram", regex: /^[A-Za-z0-9_.]{1,30}$/ },
  { key: "tiktok", column: "social_tiktok", regex: /^[A-Za-z0-9_.]{1,24}$/ },
  { key: "twitch", column: "social_twitch", regex: /^[A-Za-z0-9_]{1,25}$/ },
  { key: "polytoria", column: "polytoria_username", regex: /^[A-Za-z0-9_]{1,24}$/ },
];

const SOCIAL_SELECT_COLUMNS =
  SOCIAL_PLATFORMS.map((platform) => platform.column).join(", ") + ", ";

// Sparse socials map for read responses: only platforms holding a non-empty
// handle are present. Rows from SQL predating the social columns (e.g. the
// search projection) normalize to the empty map.
export function socialsFromRow(row) {
  const socials = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const value = row[platform.column];
    if (typeof value === "string" && value.length > 0) socials[platform.key] = value;
  }
  return socials;
}

export async function userByUsernameKey(env, key) {
  return env.FORUM_DB.prepare(
    "SELECT id, username, username_key, password_salt, password_hash, role, bio, profile_accent, banner_color, banner_text, flair, pending_css, approved_css, " +
      SOCIAL_SELECT_COLUMNS +
      "avatar_status, avatar_mime, avatar_updated_at, avatar_version " +
      "FROM users WHERE username_key = ? LIMIT 1",
  ).bind(key).first();
}

// Profile colors (any hex, v3.0.2): members pick any #rrggbb. The stored
// value is ALWAYS a validated lowercase hex — the strict regex is the whole
// security story (a matched value cannot carry CSS or markup), so clients
// apply it as a CSS custom property WRITE (element.style.setProperty, a
// CSSOM assignment — not an inline style string) and the CSP stays pure.
// The old whitelisted palette keys survive as legacy: still accepted on
// write (converted to their hex) and normalized on read, so existing
// profiles keep their colors untouched. Banner key values mirror the old
// per-key CSS (the banner variants, e.g. darker gold for white text).
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

export const PROFILE_BANNER_COLORS = {
  "": "",
  green: "#397357",
  rust: "#b05334",
  gold: "#8d690f",
  slate: "#4a5a70",
  plum: "#7c5480",
};

export const PROFILE_ACCENTS = {
  "": "",
  forest: "#3f8a63",
  coral: "#d05f4c",
  gold: "#d9a627",
  sky: "#4d8fc4",
  violet: "#8b6cc4",
  rose: "#c95f86",
  teal: "#3d9aa0",
};

// Write-side: "" clears, a legacy palette key converts to its hex, anything
// else must be #rrggbb (lowercased for storage). Returns null to REJECT.
export function normalizeProfileColorInput(value, palette) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return "";
  if (Object.prototype.hasOwnProperty.call(palette, raw)) return palette[raw];
  return isValidHexColor(raw) ? raw.toLowerCase() : null;
}

// Read-side: stored hex passes through lowercased, a legacy key maps to its
// hex, and anything else (pre-migration junk) normalizes to "".
export function normalizeProfileColor(value, palette) {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return "";
  if (Object.prototype.hasOwnProperty.call(palette, raw)) return palette[raw] || "";
  return isValidHexColor(raw) ? raw.toLowerCase() : "";
}

export function normalizeProfileAccent(value) {
  return normalizeProfileColor(value, PROFILE_ACCENTS);
}

export function normalizeBannerColor(value) {
  return normalizeProfileColor(value, PROFILE_BANNER_COLORS);
}

export function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    role: publicRole(row.role),
    bio: row.bio || "",
    socials: socialsFromRow(row),
    polytoriaUsername: row.polytoria_username || null,
    // Profile theme accent (any hex, v3.0.2): normalized server-side to a
    // #rrggbb hex (legacy palette keys map through); "" = none. Pre-migration
    // projections normalize to "".
    profileAccent: normalizeProfileAccent(row.profile_accent === undefined ? "" : row.profile_accent),
    // Rows from SQL that predates avatar moderation (e.g. search projections)
    // omit the column; normalize it to the never-uploaded shape.
    avatarStatus: row.avatar_status || null,
    avatarUrl: row.avatar_mime ? "/api/avatars/" + row.id + "?v=" + row.avatar_version : null,
  };
}

// publicLevel (optional, JSON-only annotation — never touches SQL or binds):
// 0 = root post, 1 = level-1 reply, 2 = level-2 reply. Routes that know each
// row's depth pass it in; when omitted the field is left off so clients fall
// back to their conservative (non-reply) handling.
export function publicPost(row, publicLevel) {
  const post = {
    id: Number(row.id),
    body: row.body,
    visibility: row.visibility,
    // Board (v2.4.1): serialized for every post (general or suggestions);
    // rows from pre-migration projections normalize to the "general" shape.
    board: row.board || "general",
    // Suggestion status (v3.1): 'resolved'/'declined' on suggestions-board
    // roots, null otherwise (display-only chip; staff flip it through
    // POST /api/posts/:id/suggestion-status).
    suggestionStatus: row.suggestion_status || null,
    // View counter (v2.4.3, migration 0009): raw impressions, display-only.
    // The detail route overrides this with the RETURNING value when it
    // counted a fresh view, so the payload never reads stale by one.
    viewCount: Number(row.view_count || 0),
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    lastActivityAt: row.last_activity_at === null || row.last_activity_at === undefined
      ? null
      : new Date(Number(row.last_activity_at) * 1000).toISOString(),
    // edited_at (migration 0005) rides POST_SELECT, so every serialized post
    // carries it: null until the author's first edit, then the epoch-seconds
    // stamp the edit route wrote. Same ISO-shape convention as createdAt.
    editedAt: row.edited_at === null || row.edited_at === undefined
      ? null
      : new Date(Number(row.edited_at) * 1000).toISOString(),
    author: {
      id: Number(row.author_id),
      username: row.author_username,
      // Flair chip + accent on cards (any hex, v3.0.2): the accent is
      // normalized to #rrggbb here — the client writes it as a CSS custom
      // property, never a class string.
      flair: row.author_flair || null,
      profileAccent: normalizeProfileAccent(row.author_accent === undefined ? "" : row.author_accent) || null,
      // Role badges (v3.1): the mapped public role ('owner'/'admin'), null
      // for members so the badge only appears for staff.
      role: row.author_role ? publicRole(row.author_role) : null,
      avatarUrl: row.author_avatar_mime
        ? "/api/avatars/" + row.author_id + "?v=" + row.author_avatar_version
        : null,
    },
    parent: row.parent_id ? { id: Number(row.parent_id), body: row.parent_body || "" } : null,
    likeCount: Number(row.like_count || 0),
    dislikeCount: Number(row.dislike_count || 0),
    viewerReaction: row.viewer_reaction || null,
    // Pinning (C5): the stamp (epoch seconds) as ISO, null never-pinned. Rows
    // from pre-migration projections normalize to null like editedAt.
    pinnedAt: row.pinned_at === null || row.pinned_at === undefined || Number(row.pinned_at) === 0
      ? null
      : new Date(Number(row.pinned_at) * 1000).toISOString(),
  };
  if (publicLevel !== undefined) post.publicLevel = publicLevel;
  return post;
}

export async function postById(env, postId, viewerId) {
  const row = await env.FORUM_DB.prepare(POST_SELECT + "WHERE p.id = ? LIMIT 1")
    .bind(viewerId || -1, postId).first();
  return row || null;
}
