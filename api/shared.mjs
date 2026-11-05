// Shared helpers used by every API route group. Handlers live in api/session.mjs,
// api/posts.mjs, api/profiles.mjs, and api/moderation.mjs; worker.mjs re-exports
// only the functions the test suite imports, because workerd validates every
// Worker export as a function or ExportedHandler (non-function values stay here
// as consts, mirroring constants.mjs).
// v4.0: the crypto primitives moved to api/core/crypto.mjs (plan 1, Task 2),
// the http glue to api/core/http.mjs (plan 1, Task 3), and the password
// pipeline to api/core/passwords.mjs (plan 1, Task 4) — imported back so
// every existing consumer keeps working unchanged.
import {
  base64Url,
  equalConstantTime,
  fromHex,
  hex,
  nowSeconds,
  randomToken,
  sha256Hex,
} from "./core/crypto.mjs";
import {
  hashPassword,
  isValidPassword,
  isValidPasswordPepper,
  isValidSetupSecret,
  verifyPassword,
} from "./core/passwords.mjs";
// v4.0: the image family moved to api/core/images.mjs (plan 1, Task 6).
import {
  blobToUint8Array,
  createAvatarVersion,
  imageResponse,
  sanitizeImage,
  sniffImageMime,
} from "./core/images.mjs";
// v4.0: the session/CSRF/guard machinery moved to api/core/auth.mjs
// (plan 1, Task 7).
import {
  assertNetworkNotBanned,
  assertNotBanned,
  assertSameOrigin,
  createSession,
  readSession,
  requireAdmin,
  requireCsrf,
  requireSignedInRead,
  requireUser,
  requiremod,
  requestIpHash,
} from "./core/auth.mjs";
import {
  HttpError,
  MAX_JSON_BYTES,
  json,
  rateLimit,
  readJson,
  readLimitedBody,
  requireMutationApplied,
  requireTurnstile,
  requiredText,
  securityHeaders,
} from "./core/http.mjs";

// v4.0: the role vocabulary moved to api/core/roles.mjs (plan 1, Task 5),
// imported back so every existing consumer keeps working unchanged.
import {
  ROLE_ADMIN_DB,
  ROLE_MEMBER_DB,
  ROLE_OWNER_DB,
  publicRole,
} from "./core/roles.mjs";


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
const SOCIAL_PLATFORMS = [
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
function socialsFromRow(row) {
  const socials = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const value = row[platform.column];
    if (typeof value === "string" && value.length > 0) socials[platform.key] = value;
  }
  return socials;
}

async function userByUsernameKey(env, key) {
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

function publicUser(row) {
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
function publicPost(row, publicLevel) {
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

async function postById(env, postId, viewerId) {
  const row = await env.FORUM_DB.prepare(POST_SELECT + "WHERE p.id = ? LIMIT 1")
    .bind(viewerId || -1, postId).first();
  return row || null;
}

// Nuke rule (v3.0.1): hidden content (a hidden post, or ANY content by an
// actively-banned author) is invisible to everyone EXCEPT mods and
// admins — the author included. Normal surfaces (feeds, replies, detail,
// search, history) never carry it (the list SQL binds a no-match bypass
// sentinel); the only in-app door is the desk's hidden-posts page
// (GET /api/admin/hidden). An expired or revoked ban restores content
// without any write ("now" stays SQL-computed and bind-free).
export async function canViewPost(env, row, viewer) {
  if (!row) return false;
  const ismod = Boolean(viewer && (viewer.role === "owner" || viewer.role === "admin"));
  if (row.visibility !== "public" && !ismod) return false;
  const bannedAuthor = await env.FORUM_DB.prepare(
    "SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1",
  ).bind(Number(row.author_id)).first();
  if (bannedAuthor && !ismod) return false;
  // Every ancestor up to the root (parent, and the grandparent root for
  // level-2 replies) must be viewable: hidden ancestors never leak through a
  // public reply chain. The same mod-only rule applies per ancestor.
  let ancestorId = row.parent_id;
  for (let depth = 0; ancestorId !== null && ancestorId !== undefined && depth < 2; depth++) {
    const ancestor = await env.FORUM_DB.prepare(
      "SELECT id, author_id, visibility, parent_id FROM posts WHERE id = ? LIMIT 1",
    ).bind(Number(ancestorId)).first();
    if (!ancestor || (ancestor.visibility !== "public" && !ismod)) return false;
    const ancestorBanned = await env.FORUM_DB.prepare(
      "SELECT 1 FROM bans b WHERE b.user_id = ? AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1",
    ).bind(Number(ancestor.author_id)).first();
    if (ancestorBanned && !ismod) return false;
    ancestorId = ancestor.parent_id;
  }
  return true;
}

// Avatar serving (moved here from the session group — registered on the
// profiles route group, since avatars belong to profiles). Approved avatars
// serve to anyone with public cache headers. Whenever a pending upload exists
// (first-ever upload or a re-upload over an approved avatar), its bytes are
// visible to the account owner and to admins/mods — reviewers must see
// the candidate even when an approved avatar is still serving publicly —
// uncacheable; everyone else sees the approved avatar or 404. The session is
// only consulted when a pending set exists, so guest 404s never read sessions.
async function handleAvatarReadRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const avatarMatch = path.match(/^\/api\/avatars\/([0-9]+)$/);
  if (avatarMatch) {
    if (method !== "GET") throw new HttpError(405, "That method is not supported.");
    const userId = Number(avatarMatch[1]);
    if (!Number.isSafeInteger(userId) || userId < 1) throw new HttpError(404, "Picture not found.");
    const row = await db.prepare(
      "SELECT avatar_status, avatar_mime, avatar_data, pending_avatar_mime, pending_avatar_data FROM users WHERE id = ? LIMIT 1",
    ).bind(userId).first();
    if (!row) throw new HttpError(404, "Picture not found.");

    if (row.pending_avatar_mime && row.pending_avatar_data) {
      const session = await readSession(request, env);
      const viewer = session && session.user;
      const ismod = viewer && (viewer.role === "owner" || viewer.role === "admin");
      if (viewer && (viewer.id === userId || ismod)) {
        const response = imageResponse(blobToUint8Array(row.pending_avatar_data), row.pending_avatar_mime, "no-store");
        if (response) return response;
      }
    }

    if (row.avatar_mime && row.avatar_data) {
      const response = imageResponse(blobToUint8Array(row.avatar_data), row.avatar_mime, "public, max-age=3600");
      if (response) return response;
    }

    throw new HttpError(404, "Picture not found.");
  }
  return null;
}

export {
  HttpError,
  nowSeconds,
  sha256Hex,
  randomToken,
  equalConstantTime,
  readSession,
  requireCsrf,
  requireUser,
  requireSignedInRead,
  requiremod,
  requireAdmin,
  assertSameOrigin,
  assertNotBanned,
  requireMutationApplied,
  readLimitedBody,
  readJson,
  requiredText,
  securityHeaders,
  json,
  userByUsernameKey,
  SOCIAL_PLATFORMS,
  socialsFromRow,
  publicUser,
  publicPost,
  postById,
  handleAvatarReadRoute,
  hashPassword,
  publicRole,
  assertNetworkNotBanned,
  createSession,
  requestIpHash,
  blobToUint8Array,
  createAvatarVersion,
  imageResponse,
  sanitizeImage,
  sniffImageMime,
  ROLE_ADMIN_DB,
  ROLE_MEMBER_DB,
  ROLE_OWNER_DB,
  isValidPassword,
  isValidPasswordPepper,
  isValidSetupSecret,
  rateLimit,
  requireTurnstile,
  verifyPassword,
  MAX_JSON_BYTES,
};
// Accountability archive (v2.4.1): builds the INSERT..SELECT that copies the
// doomed post rows into post_archive — run FIRST in the same atomic batch as
// the deletion, while the rows are still present. whereSql selects the doomed
// set (by original post column alias `p`); the NOT EXISTS guard keeps a row
// from being archived twice (e.g. an own reply that is also a child of an own
// root). COALESCE keeps the name even when the users row is about to vanish.
export function archivePostRowsStatement(
  db, whereSql, binds, reason, deletedAt, deletedByUserId = null, deletedByName = null,
) {
  return db.prepare(
    "INSERT INTO post_archive (original_post_id, author_id, author_name, body, board, created_at, deleted_at, deleted_because, deleted_by_user_id, deleted_by_name, idempotency_key, idempotency_fingerprint) " +
    "SELECT p.id, p.author_id, COALESCE(u.username, 'removed'), p.body, p.board, p.created_at, ?, ?, ?, ?, p.idempotency_key, p.idempotency_fingerprint " +
    "FROM posts p LEFT JOIN users u ON u.id = p.author_id " +
    "WHERE (" + whereSql + ") AND NOT EXISTS (SELECT 1 FROM post_archive a WHERE a.original_post_id = p.id)",
  ).bind(deletedAt, reason, deletedByUserId, deletedByName, ...binds);
}

// Custom profile CSS (v2.5): the sandbox. Mods approve the TEXT, and at serve
// time the raw CSS is re-scoped before it ever reaches a page:
//   1. Every rule's selectors are prefixed with .profile-theme-scope (a
//      per-profile container class), so nothing can escape its container.
//   2. An @-block pass-through keeps @media/@keyframes working; @import and
//      any other at-rule are dropped (url/resource smuggling surface).
//   3. A blocklist strips the properties that could escape or hijack: any
//      fixed positioning, z-index above 1, and everything the whitelist
//      doesn't recognize as a cosmetic property (allow-list, not block-list:
//      unknown properties are dropped — browsers ignore them anyway).
// Residual risk is accepted-with-approval: a mod reads the CSS before
// it goes live, and the CSP still gates every url() to same-origin.
const PROFILE_CSS_PROPERTY_ALLOW = new Set([
  "color", "background", "background-color", "background-image", "background-position", "background-size", "background-repeat",
  "border", "border-color", "border-width", "border-style", "border-radius",
  "font", "font-family", "font-size", "font-style", "font-weight",
  "letter-spacing", "line-height", "text-align", "text-transform", "text-decoration", "text-shadow",
  "padding", "padding-left", "padding-right", "padding-top", "padding-bottom",
  "margin", "margin-left", "margin-right", "margin-top", "margin-bottom",
  "width", "height", "max-width", "max-height", "min-width", "min-height",
  "opacity", "transform", "box-shadow", "display", "align-items", "justify-content",
  "flex-direction", "flex-wrap", "gap", "overflow", "overflow-x", "overflow-y",
  "object-fit", "object-position", "filter", "backdrop-filter", "border-bottom", "border-top",
  "border-left", "border-right", "border-bottom-color", "border-top-color",
  "border-left-color", "border-right-color",
]);

export const CUSTOM_CSS_MAX_BYTES = 20 * 1024;

// A depth-tracking brace scanner: finds the block whose opening brace is at
// `open` and returns the index just past its MATCHING close (handles nesting
// — @media bodies contain full rule blocks).
function blockEnd(text, openAt) {
  let depth = 0;
  let inString = null;
  for (let at = openAt; at < text.length; at++) {
    const ch = text[at];
    if (inString) {
      if (ch === "\\") at += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return text.length;
}

// The at-rule's NAME: everything before the first non-name char (space,
// paren... — "@media(min-width:1px)" extracts cleanly).
function atRuleName(selectorText) {
  return selectorText.replace(/^\s+/, "").split(/[^@a-zA-Z-]/)[0].toLowerCase();
}

export function scopeProfileCss(rawCss) {
  const text = String(rawCss ?? "");
  if (!text.trim()) return "";
  const sanitizedRules = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open === -1) break;
    const close = blockEnd(text, open);
    const selectorText = text.slice(index, open).trim();
    const bodyText = text.slice(open + 1, close);
    index = close + 1;
    if (selectorText.startsWith("@")) {
      const atName = atRuleName(selectorText);
      if (atName === "@media") {
        // Media blocks recurse: scope the INNER rules, keep the condition.
        const condition = selectorText.slice("@media".length).trim();
        sanitizedRules.push("@media" + " " + condition + "{" + scopeProfileCss(bodyText) + "}");
      } else if (atName === "@keyframes" || atName === "@-webkit-keyframes") {
        // Keyframes: the inner blocks are step selectors (from/to/percentage
        // — never scoped), and each step's body passes the allow-list.
        const inner = scopeKeyframeBody(bodyText);
        sanitizedRules.push(selectorText + "{" + inner + "}");
      }
      // Everything else (@import, @font-face, @supports…) is dropped.
      continue;
    }
    const scoped = selectorText
      .split(",")
      .map((selector) => ".profile-theme-scope " + selector.trim())
      .join(", ");
    const body = sanitizeDeclarationBody(bodyText);
    if (body) sanitizedRules.push(scoped + "{" + body + "}");
  }
  return sanitizedRules.join("\n");
}

// Keyframe steps: from/to/percentage selectors in, allow-listed properties
// per step.
function scopeKeyframeBody(bodyText) {
  const steps = [];
  let index = 0;
  while (index < bodyText.length) {
    const open = bodyText.indexOf("{", index);
    if (open === -1) break;
    const close = bodyText.indexOf("}", open);
    if (close === -1) break;
    const selector = bodyText.slice(index, open).trim();
    steps.push(selector + "{" + sanitizeDeclarationBody(bodyText.slice(open + 1, close)) + "}");
    index = close + 1;
  }
  return steps.join("\n");
}

// Property allow-list for one declaration body; url() survives only for the
// same-origin / static assets path (the CSP gates it further either way).
function sanitizeDeclarationBody(body) {
  const kept = [];
  for (const declaration of body.split(";")) {
    const prop = declaration.slice(0, declaration.indexOf(":") > -1 ? declaration.indexOf(":") : 0).trim().toLowerCase();
    const value = declaration.includes(":") ? declaration.slice(declaration.indexOf(":") + 1).trim() : "";
    if (!prop || !value) continue;
    if (prop === "z-index") continue; // stacking hijacks never pass
    if (value.toLowerCase().includes("position") && prop === "position" && /(fixed|sticky)/.test(value.toLowerCase())) continue;
    if (!PROFILE_CSS_PROPERTY_ALLOW.has(prop)) continue;
    if (/(javascript:|expression\(|@import)/i.test(value)) continue;
    kept.push(prop + ":" + value);
  }
  return kept.join(";");
}
