// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// v4.0 split: the board vocabulary and its single whitelist gate. Moved
// verbatim from api/posts.mjs (which read it before any SQL ran — the same
// contract holds here: every writer must pass through boardField).
import { HttpError } from "./core/http.mjs";
import { ACTIVE_BAN_SQL } from "./core/visibility.mjs";

// Board whitelist (categories, v3.1, Discourse-style): general chatter,
// game dev/work, showing things off, bugs & troubleshooting, suggestions
// (score-sorted, resolvable), and Updates — a staff-only-topics site-news
// category (everyone reads and replies; only admins/owners may start
// topics). The whitelist lives here because SQLite cannot gain a CHECK via
// ALTER TABLE ADD COLUMN — the handler layer is the gate.
export const BOARD_VALUES = ["general", "suggestions", "game-dev", "showcase", "help", "updates", "polls"];
export const SUGGESTIONS_BOARD = "suggestions";
export const UPDATES_BOARD = "updates";
export const POLLS_BOARD = "polls";
// Staff-only boards (v5.15): everyone reads and replies, only the owner and
// admins start topics. One list, checked by every topic-creating path
// (posts-write.mjs and the MCP create_post tool), so a new staff-only board
// can never be gated in one place and open in another.
export const STAFF_ONLY_BOARDS = Object.freeze([UPDATES_BOARD, POLLS_BOARD]);
export const isStaffOnlyBoard = (board) => STAFF_ONLY_BOARDS.includes(board);
export const GENERAL_BOARD_DEFAULT = "general";

// Board heads (v5.96.0): the English display label and description the
// server writes into /c/<board> titles and thread descriptions (the client
// translates its own from public/locales). Pinned to en.json's
// boards.*Label / boards.*Blurb by tests/wave596-search.test.mjs.
export const BOARD_HEADS = Object.freeze({
  general: { label: "General", blurb: "Everyday chatter — talk about whatever's on your mind." },
  "game-dev": {
    label: "Game development",
    blurb: "Devlogs, works in progress, and hangout builds — see what everyone is working on.",
  },
  showcase: { label: "Showcase", blurb: "Show off what you made — games, art, sites, anything." },
  help: { label: "Bugs & Troubleshooting & Help", blurb: "Something broke or you're stuck? Ask here." },
  suggestions: {
    label: "Suggestions",
    blurb: "Ideas for the forum — sorted by likes, and admins can mark them resolved or declined.",
  },
  updates: { label: "Updates", blurb: "Site news from the admins. Everyone can read and reply; only admins can post." },
  polls: { label: "Polls", blurb: "Polls that drive decisions for changes to the forum!" },
});
export const boardHead = (board) => BOARD_HEADS[board] || BOARD_HEADS[GENERAL_BOARD_DEFAULT];

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
  // Wave 40: banned reactors drop out, matching POST_SELECT's like/dislike
  // counts (the score cursor is encoded from those).
  "FROM reactions r WHERE r.post_id = p.id AND NOT " + ACTIVE_BAN_SQL("r.user_id") + ")";
