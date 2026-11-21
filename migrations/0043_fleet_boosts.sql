-- 0043: the T79 boost mint lane's ledger half — the IF NOT EXISTS shape
-- of the shared fleet-boosts table. The mint route that wrote PENDING rows
-- here and the sibling app that rendered them are both retired; the table
-- stays (applied migrations are tracked by name and never edited in DDL).
--
-- Ledger-order note: the rendered_* FK targets are tables created by the
-- shared database's other migration chain, which the full rebuild applies
-- BEFORE this file. D1's migrator does not enforce FKs during DDL (the 0024
-- finding), so a first-applied copy would survive silently and collide
-- with that chain's plain CREATE TABLE; the IF NOT EXISTS makes this file a
-- strict no-op once the table exists.

CREATE TABLE IF NOT EXISTS gc_fleet_boosts (
  id INTEGER PRIMARY KEY,
  forum_post_id INTEGER NOT NULL REFERENCES posts(id),
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_title TEXT NOT NULL,
  thread_excerpt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rendered_channel_id INTEGER NULL REFERENCES gc_channels(id) ON DELETE SET NULL,
  rendered_message_id INTEGER NULL REFERENCES gc_messages(id) ON DELETE SET NULL
  -- No pair CHECK between the stamps: the card's deletion SET-NULLs rendered_message_id while
  -- rendered_channel_id stays — a both-or-neither CHECK would refuse every
  -- card delete at its own action. Pending stays defined as
  -- rendered_message_id IS NULL; no rendered_at column exists (the card
  -- message row carries the render timestamp).
);

-- One boost renders at most one card into one channel: the partial index
-- pins the rendered rows only, so a pending row never races its own index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gc_fleet_boosts_mirror_once
  ON gc_fleet_boosts(forum_post_id, rendered_channel_id)
  WHERE rendered_message_id IS NOT NULL;
