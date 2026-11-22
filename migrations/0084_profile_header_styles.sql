-- 0084_profile_header_styles.sql (batch I): the profile header decoration a
-- member picks. CREATE-only — no existing table is altered. Opt-in: a member
-- with NO row here has a plain header, which is every member until they pick.
--
-- PUT /api/me/profile-header writes one key from PROFILE_HEADER_STYLES
-- (constants.mjs: tint, dots, stripes, grid); an empty value removes the row.
-- Account deletion takes the row with the user (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS profile_header_styles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  header_style TEXT NOT NULL CHECK (header_style IN ('tint', 'dots', 'stripes', 'grid')),
  updated_at INTEGER NOT NULL
);
