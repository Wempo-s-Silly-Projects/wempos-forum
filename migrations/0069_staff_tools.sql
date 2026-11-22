-- 0069_staff_tools.sql (v5.43.0): staff tools — notes on members, report
-- claiming, per-thread slow mode. CREATE-only — no existing table is altered.
-- D1 enforces foreign keys, so every reference cascades: deleting the parent
-- row (member, staff author, report, thread) takes these rows with it.
--
-- member_notes: staff-only notes about a member (body ≤ 500 chars, checked
-- by the route). Read only by GET /api/admin/members/:id/notes behind
-- requireStaff; never joined into any member-facing read.
CREATE TABLE IF NOT EXISTS member_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS member_notes_member_idx ON member_notes (member_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS member_notes_author_idx ON member_notes (author_id);

-- report_claims: at most one claim per open post report (the primary key is
-- the atomic claim: INSERT … ON CONFLICT DO NOTHING). Resolving or
-- dismissing the report removes its claim.
CREATE TABLE IF NOT EXISTS report_claims (
  report_id INTEGER PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS report_claims_staff_idx ON report_claims (staff_id);

-- thread_slowmode: one row per root thread in slow mode; seconds is one of
-- the route's allowlist (30, 60, 300, 900). Reply creation (web + MCP) reads
-- it by primary key for non-staff authors.
CREATE TABLE IF NOT EXISTS thread_slowmode (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  seconds INTEGER NOT NULL CHECK (seconds IN (30, 60, 300, 900)),
  set_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS thread_slowmode_setter_idx ON thread_slowmode (set_by);
