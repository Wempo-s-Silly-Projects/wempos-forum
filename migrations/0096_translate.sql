-- 0096_translate.sql (the translate module, P1; docs/translating.md and
-- docs/drafts/feature-slate-2026-11-22-translate.md §3).
-- CREATE-only: no existing table is altered.
--
-- translate_suggestions: one member's suggested value for one key in one
-- locale. Privacy (slate §7): member id, value, status and day numbers only
-- (no IP, no user agent, no timestamps finer than the UTC day). Deleting a
-- member cascades their rows; a reviewer's deletion only clears reviewer_id.
-- A review is a status change on this row; there is no reviews table.
-- translate_votes and translate_glossary are created now (one migration, one
-- ritual) and stay empty until P2 ships.
CREATE TABLE IF NOT EXISTS translate_suggestions (
  id INTEGER PRIMARY KEY,
  locale TEXT NOT NULL CHECK (length(locale) BETWEEN 2 AND 12),
  msg_key TEXT NOT NULL CHECK (length(msg_key) BETWEEN 3 AND 120),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 1000),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 200),
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_day INTEGER NOT NULL,
  reviewed_day INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tsugg_queue ON translate_suggestions (locale, status, id);
CREATE INDEX IF NOT EXISTS idx_tsugg_key ON translate_suggestions (locale, msg_key, status);
CREATE INDEX IF NOT EXISTS idx_tsugg_user ON translate_suggestions (user_id);
CREATE INDEX IF NOT EXISTS idx_tsugg_status ON translate_suggestions (status, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsugg_pending
  ON translate_suggestions (locale, msg_key, user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS translate_votes (
  suggestion_id INTEGER NOT NULL REFERENCES translate_suggestions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (suggestion_id, user_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS translate_glossary (
  id INTEGER PRIMARY KEY,
  locale TEXT NOT NULL CHECK (length(locale) BETWEEN 2 AND 12),
  term TEXT NOT NULL CHECK (length(term) BETWEEN 1 AND 60),
  translation TEXT NOT NULL CHECK (length(translation) BETWEEN 1 AND 120),
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  UNIQUE (locale, term)
);
