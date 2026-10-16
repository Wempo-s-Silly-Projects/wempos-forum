-- v2.5 foundations: content-addressed attachments (dedup + marketplace
-- auto-approve), the GIF marketplace library, profile banners, flairs, and
-- custom profile CSS with its moderation state (mirrors the avatar flow:
-- approved bytes/css keep serving until a moderator approves the pending one).

-- Attachments: the SHA-256 hex of the validated bytes. "" for historic rows;
-- intake computes it for every new upload. No UNIQUE (history can repeat the
-- same content); queries use an index.
ALTER TABLE attachments ADD COLUMN hash TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_attachments_hash ON attachments(hash);

-- The GIF marketplace (v2.5): a shared library of GIFs anyone may use.
CREATE TABLE gifs (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/gif')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  version TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_gifs_pending ON gifs(status);
CREATE UNIQUE INDEX idx_gifs_hash_approved ON gifs(hash) WHERE status = 'approved';

-- Profile banners (v2.5): whitelisted color KEY (like accents) + short
-- filtered text.
ALTER TABLE users ADD COLUMN banner_color TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN banner_text TEXT NOT NULL DEFAULT '';

-- User flairs (v2.5): short filtered label shown next to the name.
ALTER TABLE users ADD COLUMN flair TEXT NOT NULL DEFAULT '';

-- Custom profile CSS (v2.5): mirrors the avatar moderation flow — new CSS
-- lands pending; the previously approved CSS keeps serving until a moderator
-- approves or rejects. Approved/pending stored as separate columns so a
-- rejected rewrite can never blank an approved theme.
ALTER TABLE users ADD COLUMN approved_css TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN pending_css TEXT;
ALTER TABLE users ADD COLUMN css_status TEXT NOT NULL DEFAULT 'none'
  CHECK (css_status IN ('none', 'pending', 'approved'));
