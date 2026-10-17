-- Migration 0027 (v3.0.1): the GIF marketplace becomes the media Gallery and
-- takes GIF, JPEG, PNG, and WebP. The gifs.mime CHECK has to widen, and
-- SQLite can only change a CHECK by rebuilding the table. gif_chunks is
-- rebuilt in the same pass so its foreign key follows the new table; its
-- rows (pending library-upload bytes only — attachments keep their own
-- chunk table) are dropped, which was acceptable because the live library
-- was empty at ship time.
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
DROP TABLE gif_chunks;
DROP TABLE gifs;
ALTER TABLE gifs_new RENAME TO gifs;
CREATE TABLE gif_chunks (
  gif_id TEXT NOT NULL REFERENCES gifs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL CHECK (length(data) <= 2000000),
  PRIMARY KEY (gif_id, seq)
);
CREATE INDEX idx_gifs_pending ON gifs(status);
CREATE UNIQUE INDEX idx_gifs_hash_approved ON gifs(hash) WHERE status = 'approved';