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

export const REPLY_INSERT_IF_ALLOWED_SQL =
  "INSERT INTO posts (author_id, parent_id, body, visibility, created_at) " +
    "SELECT ?, ?, ?, 'public', ? WHERE EXISTS (" +
    "SELECT 1 FROM posts WHERE id = ? AND parent_id IS NULL AND visibility = 'public') " +
    "AND NOT EXISTS (SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
    "AND (expires_at IS NULL OR expires_at > ?))";

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
  reaction: "REACTION_RATE_LIMITER",
});

export const SEARCH_USERS_SQL =
  "SELECT id, username, role, bio, avatar_mime, avatar_updated_at, avatar_version FROM users " +
  "WHERE instr(username_key, ?) > 0 OR instr(lower(bio), ?) > 0 ORDER BY username_key LIMIT 20";

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";