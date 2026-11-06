-- Flagged-content snapshot (v4.2): reviewing an appeal blind is unusable —
-- the appeal cards showed only the verdict categories, the flagged post was
-- hidden somewhere else, and chat/DM removals delete the message outright so
-- the words were unrecoverable. Every auto-mod action now stores a snapshot
-- of exactly what tripped it: the flagged body/message for text actions, the
-- OCR-extracted text for image actions. Plain ALTER (no rebuild needed).
ALTER TABLE moderation_actions ADD COLUMN content_preview TEXT;
