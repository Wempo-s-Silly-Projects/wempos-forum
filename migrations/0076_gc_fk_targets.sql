-- 0076: FK-target stubs for gc_fleet_boosts (v5.63 defect fix).
--
-- 0043_fleet_boosts.sql declares rendered_channel_id REFERENCES gc_channels
-- and rendered_message_id REFERENCES gc_messages. Those parent tables were
-- created by the shared database's retired GooberCord chain, never by this
-- repo. SQLite (and D1) resolves every FK parent of a row it touches, so on a
-- schema built from this repo alone (local dev, the test harness, any
-- self-hosted instance) or one where the GooberCord tables were dropped, any
-- write to gc_fleet_boosts fails with "no such table: main.gc_messages",
-- including the ON DELETE CASCADE from users, which makes every account
-- deletion (POST /api/me/delete) roll back with a 500.
--
-- Released migrations are never edited, so this file only gives the two FK
-- targets a minimal parent shape. CREATE ... IF NOT EXISTS: where the real
-- GooberCord tables still exist this is a strict no-op and touches nothing.
-- The stubs hold no rows and carry no FKs of their own.

CREATE TABLE IF NOT EXISTS gc_channels (
  id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS gc_messages (
  id INTEGER PRIMARY KEY
);
