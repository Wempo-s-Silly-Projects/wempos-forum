-- Migration 0025: preserve library-GIF identity on each post attachment.
-- A GIF may later be revoked or removed from the library, but an exact retry
-- must still be able to verify the media identity already committed to a post.
ALTER TABLE attachments ADD COLUMN source_gif_id TEXT;

CREATE INDEX idx_attachments_source_gif
  ON attachments(post_id, source_gif_id)
  WHERE source_gif_id IS NOT NULL;
