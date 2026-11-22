-- 0072_private_notes.sql (v5.47.0): private notes about members. CREATE-only
-- — no existing table is altered.
--
-- One row per (owner, subject): a short note a member keeps about another
-- member. It is visible ONLY to its owner (api/private-notes.mjs, keyed on
-- the session's own id) and the owner's data export — never to the subject,
-- other members, staff or guests, and no feed, search, MCP tool or page head
-- reads this table. Not the staff-only member_notes table (0069).
-- Both references cascade: D1 enforces foreign keys, so deleting either
-- account takes the row with it.
CREATE TABLE IF NOT EXISTS private_notes (
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 280),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, subject_id),
  CHECK (owner_id <> subject_id)
);

-- The FK child-side index for the subject cascade (the PK already covers
-- every owner-keyed read).
CREATE INDEX IF NOT EXISTS idx_private_notes_subject ON private_notes(subject_id);
