-- Thread subscriptions (v3.0 C1): a member follows a ROOT thread and gets a
-- notification every time a reply lands on it (the reply author and the
-- reply's direct target are excluded — they already have their notifications).
-- The composite primary key makes a (user, thread) pair unique; subscribing
-- twice is a no-op. Both FKs cascade, so a deleted account or thread can never
-- orphan a subscription row.
CREATE TABLE thread_subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX idx_thread_subscriptions_post ON thread_subscriptions(post_id);