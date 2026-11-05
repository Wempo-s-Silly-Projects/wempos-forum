// v4.0 split: the board vocabulary and its single whitelist gate. Moved
// verbatim from api/posts.mjs (which read it before any SQL ran — the same
// contract holds here: every writer must pass through boardField).
import { HttpError } from "./core/http.mjs";

// Board whitelist (categories, v3.1, Discourse-style): general chatter,
// game dev/work, showing things off, bugs & troubleshooting, suggestions
// (score-sorted, resolvable), and Updates — a staff-only-topics site-news
// category (everyone reads and replies; only admins/owners may start
// topics). The whitelist lives here because SQLite cannot gain a CHECK via
// ALTER TABLE ADD COLUMN — the handler layer is the gate.
export const BOARD_VALUES = ["general", "suggestions", "game-dev", "showcase", "help", "updates"];
export const SUGGESTIONS_BOARD = "suggestions";
export const UPDATES_BOARD = "updates";
export const GENERAL_BOARD_DEFAULT = "general";

export function boardField(value) {
  if (value === undefined || value === null || value === "") return GENERAL_BOARD_DEFAULT;
  if (BOARD_VALUES.includes(value)) return value;
  throw new HttpError(400, "That board is not available.");
}

// Net reaction score for the Suggestions feed: likes minus dislikes, computed
// from the reactions rows themselves (reactions.value CHECK-constrains to
// 'like'/'dislike'; one row per post+user, so the score is the net of both
// directions — dislikes count against). A zero-score thread is a real page
// row: COALESCE keeps every thread visible even with no reactions at all.
// (v4.0 ledger — plan resolved this constant's home to boards.mjs at Task 2
// implementation: it is the "p" table alias contract of the Suggestions
// feed's ORDER BY, pure board semantics.)
export const SUGGESTION_SCORE_SQL =
  "(SELECT COALESCE(SUM(CASE r.value WHEN 'like' THEN 1 ELSE -1 END), 0) " +
  "FROM reactions r WHERE r.post_id = p.id)";
