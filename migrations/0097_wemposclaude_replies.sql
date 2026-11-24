-- 0097_wemposclaude_replies.sql (the wemposclaude module, docs/modules.md).
-- CREATE-only: no existing table is altered.
--
-- wemposclaude_replies: one row per post or lobby message the bot was asked
-- to answer. The primary key makes the answer idempotent (a retried trigger
-- inserts nothing), and the UTC day number carries the daily caps (global
-- and per member) on the same clock as the Workers AI free allocation.
-- Privacy: the kind, the source id, who tagged the bot and the UTC day only
-- (no text, no IP, no finer timestamp). Deleting a member deletes their rows.
CREATE TABLE IF NOT EXISTS wemposclaude_replies (
  source_kind TEXT NOT NULL CHECK (source_kind IN ('post', 'chat')),
  source_id INTEGER NOT NULL,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  PRIMARY KEY (source_kind, source_id)
);
CREATE INDEX IF NOT EXISTS idx_wemposclaude_replies_day ON wemposclaude_replies (day, requester_id);
CREATE INDEX IF NOT EXISTS idx_wemposclaude_replies_requester ON wemposclaude_replies (requester_id);
