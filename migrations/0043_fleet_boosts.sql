-- 0043: the T79 boost mint lane's ledger half
-- (docs/drafts/t79-post-boost-spec.md §2.2-2.3) — the forum ledger's
-- IF NOT EXISTS copy of gc_fleet_boosts, the shared boost table the forum's
-- mint route (api/boost.mjs) inserts PENDING rows into and the GC render
-- lane (GooberCord api/boost.mjs) consumes from.
--
-- Shape truth is GC's own migration (GooberCord/migrations/0029_fleet_boosts.sql):
-- the gc_ prefix is the GC-OWNED spelling (GC's scoping pin
-- tests/migration-scoping.test.mjs requires GC-created tables to be
-- gc_-prefixed), and the DDL below is that shape copied with IF NOT EXISTS
-- riding both statements. On the LIVE shared wempo-forum-data D1 the copy is
-- a strict no-op — GC's 0029 already materialized the table there, and the
-- ritual applies the GC chain before this file.
--
-- Joint-rebuild ledger-order law: this copy's FK targets (posts is the
-- forum's own chain; gc_channels and gc_messages are GC-chain rows) mean the
-- FULL shared rebuild always applies the GC chain (0001-0029) BEFORE this
-- file — a forum-chain-first rebuild DB is an unsupported topology for the
-- twin tables. On D1 that order is also the only sane one: D1's migrator
-- does not enforce FKs during DDL (the 0024 finding, recorded in GC's
-- migration-scoping suite), so a first-applied copy would survive silently
-- and then collide with GC 0029's plain CREATE TABLE. Enforcing runners,
-- which refuse loudly, never meet that topology in a correct ledger.

CREATE TABLE IF NOT EXISTS gc_fleet_boosts (
  id INTEGER PRIMARY KEY,
  forum_post_id INTEGER NOT NULL REFERENCES posts(id),
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_title TEXT NOT NULL,
  thread_excerpt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rendered_channel_id INTEGER NULL REFERENCES gc_channels(id) ON DELETE SET NULL,
  rendered_message_id INTEGER NULL REFERENCES gc_messages(id) ON DELETE SET NULL
  -- No pair CHECK between the stamps (GC 0029's scoping-pin finding, copied
  -- with the shape): the card's deletion SET-NULLs rendered_message_id while
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
