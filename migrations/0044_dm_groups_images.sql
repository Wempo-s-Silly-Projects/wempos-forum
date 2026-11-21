-- v4.7 DMs: group conversations and pictures in DMs. CREATE-only — the 1:1
-- dm_threads/dm_messages pair (0032 + 0038) is untouched.
--
-- Groups: up to 10 members including the creator (cap enforced in
-- api/dm-groups.mjs, constants.mjs). creator_id survives as NULL when the
-- creator's account is deleted; membership rows carry the per-member unread
-- counter (a send bumps every OTHER member, a read zeroes the reader's own).
CREATE TABLE dm_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 60),
  created_at INTEGER NOT NULL
);
CREATE TABLE dm_group_members (
  group_id INTEGER NOT NULL REFERENCES dm_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_dm_group_members_user ON dm_group_members(user_id);
CREATE TABLE dm_group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES dm_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_dm_group_messages_group ON dm_group_messages(group_id, id);

-- Pictures in DMs: bound to exactly ONE conversation (a 1:1 thread or a
-- group); only that conversation's members can fetch the bytes. Bytes live
-- chunked in D1 like attachment_chunks (R2 is not configured; D1 caps a
-- BLOB at 2,000,000 bytes per row).
CREATE TABLE dm_images (
  id TEXT PRIMARY KEY,
  uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id INTEGER REFERENCES dm_threads(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES dm_groups(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK (mime IN ('image/gif', 'image/jpeg', 'image/png', 'image/webp')),
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((thread_id IS NULL) <> (group_id IS NULL))
);
CREATE INDEX idx_dm_images_thread ON dm_images(thread_id);
CREATE INDEX idx_dm_images_group ON dm_images(group_id);
CREATE TABLE dm_image_chunks (
  image_id TEXT NOT NULL REFERENCES dm_images(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL CHECK (length(data) <= 2000000),
  PRIMARY KEY (image_id, seq)
);
