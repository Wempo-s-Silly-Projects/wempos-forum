-- 0062_profile_pronouns.sql (v5.23.0): optional pronouns on profiles.
-- CREATE-only — no existing table is altered. Opt-in: a member with NO row
-- here has no pronouns, which is every member until they set some.
--
-- PUT /api/me/pronouns writes the trimmed value (letters, spaces, / and -,
-- up to 24 characters, checked server-side); an empty value removes the row.
-- Account deletion takes the row with the user (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS profile_pronouns (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pronouns TEXT NOT NULL CHECK (length(pronouns) BETWEEN 1 AND 24),
  updated_at INTEGER NOT NULL
);
