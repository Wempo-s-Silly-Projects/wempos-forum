-- 0067_folders_follows.sql (v5.39.0): bookmark folders and member follows.
-- CREATE-only — no existing table is altered.
--
-- Every reference cascades: D1 enforces foreign keys, so a missing cascade
-- would block deleting the account, the post or the folder. Both features
-- are private: rows are read only by their owner, and every read re-checks
-- the visibility law at read time (nothing here is trusted as still visible).

-- bookmark_folders: a member's named folders for saved posts (at most 20 per
-- member, enforced by the route). Names are unique per member.
CREATE TABLE IF NOT EXISTS bookmark_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

-- bookmark_folder_items: which saved posts sit in which folder. One post may
-- sit in several folders. A row shows only while the owner still has the
-- post bookmarked and the post passes the bookmarks list's visibility rule.
CREATE TABLE IF NOT EXISTS bookmark_folder_items (
  folder_id INTEGER NOT NULL REFERENCES bookmark_folders(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (folder_id, post_id)
);

CREATE INDEX IF NOT EXISTS bookmark_folder_items_post_idx ON bookmark_folder_items (post_id);
CREATE INDEX IF NOT EXISTS bookmark_folder_items_page_idx ON bookmark_folder_items (folder_id, added_at);

-- user_follows: the follower gets one notification when the followee starts
-- a new public thread. Never shown to anyone but the follower; a block
-- removes the pair's rows in both directions.
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX IF NOT EXISTS user_follows_followee_idx ON user_follows (followee_id, created_at);
