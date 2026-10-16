-- Migration 0024: content-bound idempotency and attachment provenance.
ALTER TABLE posts ADD COLUMN idempotency_fingerprint TEXT;
-- Only in-flight attachment submissions receive staged_at. This avoids treating
-- moderator-hidden posts as abandoned upload drafts during retry cleanup.
ALTER TABLE posts ADD COLUMN staged_at INTEGER;
ALTER TABLE post_archive ADD COLUMN idempotency_key TEXT;
ALTER TABLE post_archive ADD COLUMN idempotency_fingerprint TEXT;

-- New rows distinguish direct uploads from library references. Historical rows
-- remain legacy because their original source cannot always be reconstructed.
ALTER TABLE attachments ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'legacy'
  CHECK (source_kind IN ('legacy', 'upload', 'gif'));

CREATE INDEX idx_post_archive_author_idempotency_key
  ON post_archive(author_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
