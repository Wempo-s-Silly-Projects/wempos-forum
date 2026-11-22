-- Upload safety pipeline: width/height of every stored image, read from its
-- header bytes at intake (image-dimensions) and keyed by the SHA-256 of the
-- sanitized bytes, the same content hash attachments, gifs and dm_images
-- already carry. Post payloads hand these to <img width/height> so images
-- reserve their box before they load (no layout shift). CREATE-only: no
-- existing table is touched, and rows for images uploaded before this
-- migration are simply absent (the client then renders without the
-- attributes, as before).
CREATE TABLE IF NOT EXISTS image_dimensions (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0)
);
