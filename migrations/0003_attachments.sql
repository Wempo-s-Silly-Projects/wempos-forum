-- Migration 0003 (attachments): image attachments on posts and replies, mirroring
-- the avatar column pattern from 0002 (magic-byte-validated mimes, D1 BLOBs — R2
-- is not enabled on this account — pending/approved byte pairs with all-or-nothing
-- CHECKs, and a moderation status pinned against both pairs).
--
-- New table only: no existing table needs rebuilding, so no defer_foreign_keys
-- batching or child-table rewrite is required.

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  version TEXT NOT NULL,
  -- Approved pair (served publicly; populated only by moderation approval).
  mime TEXT CHECK (mime IS NULL OR mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  data BLOB CHECK (data IS NULL OR length(data) <= 1048576),
  updated_at INTEGER,
  -- Pending pair (author-only serving until a moderator decides).
  pending_mime TEXT CHECK (pending_mime IS NULL OR pending_mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  pending_data BLOB CHECK (pending_data IS NULL OR length(pending_data) <= 1048576),
  pending_updated_at INTEGER,
  CHECK (
    (mime IS NULL AND data IS NULL AND updated_at IS NULL)
    OR (mime IS NOT NULL AND data IS NOT NULL AND updated_at IS NOT NULL)
  ),
  CHECK (
    (pending_mime IS NULL AND pending_data IS NULL AND pending_updated_at IS NULL)
    OR (pending_mime IS NOT NULL AND pending_data IS NOT NULL AND pending_updated_at IS NOT NULL)
  ),
  CHECK (
    CASE
      WHEN status = 'pending'
        THEN pending_mime IS NOT NULL AND mime IS NULL
      WHEN status = 'approved'
        THEN mime IS NOT NULL AND pending_mime IS NULL
      ELSE -- 'rejected' is a terminal state: both sets empty
        mime IS NULL AND pending_mime IS NULL
    END
  )
);

CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_attachments_pending ON attachments(status) WHERE status = 'pending';