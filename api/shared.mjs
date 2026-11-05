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
// v4.0: the payload shapers moved to api/core/shapers.mjs and the read-time
// visibility predicate to api/core/visibility.mjs (plan 1, Task 8).
import {
  POST_SELECT,
  PROFILE_ACCENTS,
  PROFILE_BANNER_COLORS,
  VIEW_INCREMENT_SQL,
  isValidHexColor,
  isValidUsername,
  normalizeBannerColor,
  normalizeProfileAccent,
  normalizeProfileColor,
  normalizeProfileColorInput,
  postById,
  publicPost,
  publicUser,
  socialsFromRow,
  userByUsernameKey,
  SOCIAL_PLATFORMS,
} from "./core/shapers.mjs";
import { canViewPost } from "./core/visibility.mjs";


// Avatar serving (moved here from the session group — registered on the
// profiles route group, since avatars belong to profiles). Approved avatars
// serve to anyone with public cache headers. Whenever a pending upload exists
// (first-ever upload or a re-upload over an approved avatar), its bytes are
// visible to the account owner and to staff — reviewers must see
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
  POST_SELECT,
  VIEW_INCREMENT_SQL,
  isValidUsername,
  isValidHexColor,
  PROFILE_BANNER_COLORS,
  PROFILE_ACCENTS,
  normalizeProfileColorInput,
  normalizeProfileColor,
  normalizeProfileAccent,
  normalizeBannerColor,
  canViewPost,
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
