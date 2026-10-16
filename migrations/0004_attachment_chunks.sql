-- Migration 0004 (attachment chunks, spec revision 2): D1 caps a single BLOB/row
-- at 2,000,000 bytes, so the raised 10 MiB per-image limit cannot live in one
-- column. The 0003 table (blob pairs, 1 MiB CHECKs) is dropped and recreated as
-- metadata-only, with image bytes moved to the attachment_chunks table.
--
-- 0003 remains in the chain untouched: local D1 tracks applied migrations by
-- filename, and the remote store has not applied any of these yet, so the
-- 0003 → 0004 pair runs cleanly in both places. In-place data preservation is
-- not required (no post-0003 production data exists); the DROP simply clears
-- the old schema and any local test rows.

DROP TABLE IF EXISTS attachments;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  -- The sniffed magic-byte mime; intake writes it and serving re-states it
  -- under X-Content-Type-Options: nosniff regardless of moderation status.
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  -- Cache buster carried in serving URLs (`?v=`); approval bumps it.
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_attachments_pending ON attachments(status) WHERE status = 'pending';

-- One attachment's byte set is its chunks of a given kind, concatenated in seq
-- order. Pending bytes (author/mod-only visibility) are kind='pending' rows
-- written at intake; approval relabels them kind='approved' in place; a
-- rejected row is DELETEd and the chunks cascade. Each chunk stays under D1's
-- 2,000,000-byte single-BLOB cap with headroom for row overhead.
CREATE TABLE attachment_chunks (
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pending', 'approved')),
  seq INTEGER NOT NULL,
  data BLOB NOT NULL CHECK (length(data) <= 2000000),
  PRIMARY KEY (attachment_id, kind, seq)
);