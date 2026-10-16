-- Report-a-profile (v2.5): members report another member's profile surface
-- (bio/flair/banner/custom CSS). Mirrors the posts reports table's shape.
CREATE TABLE profile_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX idx_profile_reports_open ON profile_reports(status);
