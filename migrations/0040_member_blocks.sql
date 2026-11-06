-- v4.4 member blocks: a member hides another member's content from
-- themselves and refuses that member's interactions. Blocks are directional
-- but enforced BOTH ways at read time (either side blocking hides content
-- between the pair) — one row from either direction suffices, so lookups
-- check both directions against the single (blocker_id, blocked_id) pair.
CREATE TABLE blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);
