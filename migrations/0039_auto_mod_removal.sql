-- 0039: auto-mod removal (v4.2, owner's call). The Vision SafeSearch + OCR
-- pipeline and the OpenAI text auto-mod are gone from the code; this prunes
-- the data they wrote so nothing references dead machinery. The code that
-- read these tables was removed in the same change:
-- moderation_actions/auto_mod_overrides/vision_verdicts have no writers or
-- readers left, legacy auto-mod appeal rows have a desk that can't render
-- them, and the kill-switch rows belong to removed desk endpoints.
-- Appeals keep their action_id column (dropping it would be a full table
-- rebuild for zero benefit) but every appeal is a ban appeal from here on.

DELETE FROM appeals WHERE action_id IS NOT NULL;
DELETE FROM moderation_actions;
DROP INDEX IF EXISTS idx_moderation_actions_user;
DROP TABLE IF EXISTS auto_mod_overrides;
DROP TABLE IF EXISTS vision_verdicts;
DROP TABLE IF EXISTS moderation_actions;
DELETE FROM site_settings WHERE key IN ('vision_kill_switch', 'text_mod_kill_switch');
