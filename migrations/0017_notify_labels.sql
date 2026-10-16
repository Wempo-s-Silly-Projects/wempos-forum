-- Notification labels (v3.0 fix round): the fan-out sources now distinguish
-- themselves. The ordinary reply/subscription notifications keep NULL labels
-- (the UI's generic copy applies); mention fan-out stores
-- "You were mentioned by <username>" so a mention never reads as a plain
-- reply. NULL-safe: pre-0017 rows (and every fallback) keep the generic copy.
ALTER TABLE notifications ADD COLUMN label TEXT;