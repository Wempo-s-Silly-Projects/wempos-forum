-- Polls (v3.0 C3): one poll per thread root, ≤4 options, one vote per member
-- per poll (CHANGEABLE — the vote is an upsert). All FKs cascade, so a deleted
-- poll, thread, or account never leaves orphaned votes. Results are always
-- public (display-only; votes never touch sorting).
CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (length(question) <= 200),
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE UNIQUE INDEX idx_polls_post ON polls(post_id);

CREATE TABLE poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) <= 80),
  position INTEGER NOT NULL
);
CREATE INDEX idx_poll_options_poll ON poll_options(poll_id);

CREATE TABLE poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);