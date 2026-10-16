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
// parent_id, body, created_at, last_activity_at, board, target id, ban
// idempotency_key, target id, ban user_id, ban now.
export const THREAD_REPLY_INSERT_SQL =
  "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, idempotency_key, idempotency_fingerprint) " +
    "SELECT ?, ?, ?, 'public', ?, ?, ?, ?, ? WHERE EXISTS (" +
    "SELECT 1 FROM posts WHERE id = ? AND visibility = 'public' AND (" +
    "parent_id IS NULL OR EXISTS (" +
    "SELECT 1 FROM posts root WHERE root.id = posts.parent_id " +
    "AND root.parent_id IS NULL AND root.visibility = 'public'))) " +
    "AND NOT EXISTS (SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
    "AND (expires_at IS NULL OR expires_at > ?))";

// Replies with attachments are inserted as hidden until their attachment batch
// commits. Replacing only the first visibility literal preserves the public-root
// and ban predicates below while allowing the caller to bind 'hidden'.
export const THREAD_REPLY_INSERT_STAGED_SQL = THREAD_REPLY_INSERT_SQL.replace(
  "SELECT ?, ?, ?, 'public', ?, ?, ?, ?, ? WHERE EXISTS (",
  "SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (",
);

// Reply replies bump their conversation root: last_activity_at = now on the
// root row (id resolved in JS as the target root or the target's parent).
export const REPLY_BUMP_SQL =
  "UPDATE posts SET last_activity_at = MAX(COALESCE(last_activity_at, 0), ?) " +
  "WHERE id = ? AND visibility = 'public' AND EXISTS (" +
  "SELECT 1 FROM posts reply WHERE reply.parent_id = posts.id AND reply.visibility = 'public')";

export const STAGED_REPLY_BUMP_SQL =
  "UPDATE posts SET last_activity_at = MAX(COALESCE(last_activity_at, 0), ?) " +
  "WHERE id = ? AND visibility = 'public' AND EXISTS (" +
  "SELECT 1 FROM posts reply LEFT JOIN posts target ON target.id = reply.parent_id " +
  "WHERE reply.id = ? AND reply.visibility = 'public' " +
  "AND (reply.parent_id = posts.id OR target.parent_id = posts.id))";

export const RATE_LIMIT_BINDINGS = Object.freeze({
  read: "READ_RATE_LIMITER",
  write: "WRITE_RATE_LIMITER",
  "guest-session": "GUEST_SESSION_RATE_LIMITER",
  register: "REGISTER_RATE_LIMITER",
  login: "LOGIN_RATE_LIMITER",
  setup: "SETUP_RATE_LIMITER",
  "post-write": "POST_WRITE_RATE_LIMITER",
  "password-change": "PASSWORD_CHANGE_RATE_LIMITER",
  report: "REPORT_RATE_LIMITER",
  "avatar-upload": "AVATAR_UPLOAD_RATE_LIMITER",
  "image-upload": "IMAGE_UPLOAD_RATE_LIMITER",
  reaction: "REACTION_RATE_LIMITER",
});

export const SEARCH_USERS_SQL =
  "SELECT id, username, role, bio, avatar_mime, avatar_updated_at, avatar_version FROM users " +
  "WHERE instr(username_key, ?) > 0 OR instr(lower(bio), ?) > 0 ORDER BY username_key LIMIT 20";

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";