-- Migration 0022: persist moderator revocation of approved attachment hashes.
-- The tombstone prevents future duplicate uploads from bypassing moderation.
CREATE TABLE revoked_attachment_hashes (
  hash TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL,
  revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
