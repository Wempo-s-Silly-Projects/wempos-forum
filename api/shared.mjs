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
