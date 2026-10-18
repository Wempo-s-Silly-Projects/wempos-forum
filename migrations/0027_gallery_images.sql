-- Migration 0027 (v3.0.1): widen the Gallery MIME check to GIF, JPEG, PNG,
-- and WebP. SQLite requires rebuilding gifs to change its CHECK constraint.
-- Preserve both the library metadata and its chunked image bytes during the
-- rebuild. Create the replacement chunk table against gifs_new first so its
-- foreign key follows the renamed parent table.
CREATE TABLE gifs_new (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/gif', 'image/jpeg', 'image/png', 'image/webp')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  version TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
INSERT INTO gifs_new (id, hash, uploader_id, mime, status, version, use_count, created_at)
  SELECT id, hash, uploader_id, mime, status, version, use_count, created_at FROM gifs;

CREATE TABLE gif_chunks_new (
  gif_id TEXT NOT NULL REFERENCES gifs_new(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL CHECK (length(data) <= 2000000),
  PRIMARY KEY (gif_id, seq)
);
INSERT INTO gif_chunks_new (gif_id, seq, data)
  SELECT gif_id, seq, data FROM gif_chunks;

DROP TABLE gif_chunks;
DROP TABLE gifs;
ALTER TABLE gifs_new RENAME TO gifs;
ALTER TABLE gif_chunks_new RENAME TO gif_chunks;

CREATE INDEX idx_gifs_pending ON gifs(status);
CREATE UNIQUE INDEX idx_gifs_hash_approved ON gifs(hash) WHERE status = 'approved';
