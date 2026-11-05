-- Google Cloud Vision middleman (v3.1): verdicts, auto-mod actions, appeals,
-- and the appeal-approved hash allowlist. The subsystem is SECRET-GATED (no
-- GOOGLE_VISION_API_KEY = off; any VISION_KILL_SWITCH value = off) and fully
-- advisory-or-automated at the owner's choice: verdicts land in vision_verdicts,
-- trips (adult/violence at LIKELY or worse) auto-remove the pending upload and
-- record a moderation_actions row, and members appeal either outcome.

-- One verdict row per checked pending item, REPLACED on re-check (an avatar
-- re-upload while pending overwrites the stale verdict). error is set when the
-- Vision call itself failed, so the moderation desks can distinguish "still
-- checking" (no row) from "unavailable" (row with error).
CREATE TABLE vision_verdicts (
  kind TEXT NOT NULL CHECK (kind IN ('attachment', 'gif', 'avatar')),
  entity_id TEXT NOT NULL,
  version TEXT,
  adult TEXT,
  medical TEXT,
  spoof TEXT,
  violence TEXT,
  racy TEXT,
  error TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (kind, entity_id)
);

-- Auto-mod audit anchor (v3.1): every automatic removal writes one row, and
-- appeals attach to it. Reversal (an approved appeal) never resurrects bytes —
-- it allowlists the hash so the member can re-upload — but it clears the
-- member's record for accountability.
CREATE TABLE moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('auto_image')),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('attachment', 'gif', 'avatar')),
  entity_id TEXT NOT NULL,
  hash TEXT,
  reason TEXT NOT NULL,
  verdicts TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reversed_at INTEGER,
  reversed_by INTEGER
);
CREATE INDEX idx_moderation_actions_user ON moderation_actions (user_id, created_at);

-- Member appeals (v3.1): against an auto-mod removal (action_id, signed-in
-- path) or an active ban (ban_id, ban-screen path — banned members have no
-- session). One appeal per action/ban enforced by the UNIQUEs; status is the
-- queue's working state.
CREATE TABLE appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action_id INTEGER,
  ban_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('auto_image', 'ban')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by INTEGER,
  UNIQUE (user_id, action_id),
  UNIQUE (user_id, ban_id)
);
CREATE INDEX idx_appeals_status ON appeals (status, created_at);

-- Approved auto-mod appeals allowlist the content hash: identical bytes can
-- never be auto-removed again (the re-upload loop would otherwise re-trip).
CREATE TABLE auto_mod_overrides (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
