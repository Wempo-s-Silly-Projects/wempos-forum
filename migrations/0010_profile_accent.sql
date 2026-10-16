-- Profile themes (v2.5): the accent is a WHITELISTED palette key ("", a
-- palette id from api/shared.mjs PROFILE_ACCENTS) — never raw CSS. The
-- frontend applies it through CSSOM, which a restrictive CSP permits.
ALTER TABLE users ADD COLUMN profile_accent TEXT NOT NULL DEFAULT '';
