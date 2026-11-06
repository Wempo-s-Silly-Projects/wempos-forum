-- DM unread counters (v4.2): per-participant badge state on the canonical
-- thread row — plain ALTERs, no rebuild.unread_a counts the messages user A
-- has not seen; sending from A bumps unread_b and clears unread_a (sending
-- IS reading your own thread). The badge drives the header chat button's
-- unread dot + the ping alert.
ALTER TABLE dm_threads ADD COLUMN unread_a INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dm_threads ADD COLUMN unread_b INTEGER NOT NULL DEFAULT 0;
