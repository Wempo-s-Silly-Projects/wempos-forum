-- 0070_reactions_tags.sql (v5.44.0): reactions on 1:1 DM messages and thread
-- tags. CREATE-only — no existing table is altered. D1 enforces foreign keys,
-- so every reference cascades: deleting the parent row (message, thread,
-- member, tag, post) takes these rows with it.
--
-- dm_message_reactions: one reaction per member per 1:1 message; the value
-- set is the post-reaction allowlist (REACTION_VALUES in constants.mjs —
-- the same CHECK the reactions table carries). Only the thread's two
-- participants may write or read it (api/dm-reactions.mjs). Group DMs
-- (dm_group_messages) are out of scope.
CREATE TABLE IF NOT EXISTS dm_message_reactions (
  message_id INTEGER NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('like', 'dislike')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS dm_message_reactions_user_idx ON dm_message_reactions (user_id);

-- forum_tags: staff-made thread tags (at most 50, checked by the route);
-- slug [a-z0-9-]{2,24}, label ≤ 24 chars, word-filtered at create.
CREATE TABLE IF NOT EXISTS forum_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS forum_tags_creator_idx ON forum_tags (created_by);

-- thread_tags: up to 3 tags per thread ROOT (checked by the route). The
-- (tag_id, post_id) index serves the newest-first tag listing's keyset walk.
CREATE TABLE IF NOT EXISTS thread_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES forum_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS thread_tags_tag_idx ON thread_tags (tag_id, post_id);
