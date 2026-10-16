-- Migration 0021: durable idempotency for post and reply creation.
-- A key is scoped to its author and unique across root posts and replies.
ALTER TABLE posts ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX idx_posts_author_idempotency_key
  ON posts(author_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
