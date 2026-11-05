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
  // handleAvatarReadRoute left the surface in plan 3 Task 2 (moved verbatim
  // to api/avatars.mjs with its family; importers re-pointed).
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
