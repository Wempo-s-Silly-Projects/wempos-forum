-- GIF bytes (v2.5): chunked like attachments (D1 caps a BLOB/row at 2 MB);
-- one canonical approved byte-set per hash — dedup targets the GIF row.
CREATE TABLE gif_chunks (
  gif_id TEXT NOT NULL REFERENCES gifs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL CHECK (length(data) <= 2000000),
  PRIMARY KEY (gif_id, seq)
);
