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

import { t } from "./i18n.js";
// Category set (v3.1, Discourse-style): one list shared by the sidebar, the
// composer's category picker, and the /c/<slug> routes. The slugs are the
// STORED posts.board values — api/posts.mjs whitelists the identical set
// server-side, so a slug here can always be sent as-is.
//
// staffOnly: the Updates category — everyone reads and replies, but only
// admins and the owner may start topics there (server-enforced 403; the
// composer is simply not offered to members).
// label/blurb are getters so they translate at read time, never at import.
export const BOARDS = [
  {
    slug: "general",
    get label() { return t("boards.generalLabel"); },
    get blurb() { return t("boards.generalBlurb"); },
  },
  {
    slug: "game-dev",
    get label() { return t("boards.gameDevLabel"); },
    get blurb() { return t("boards.gameDevBlurb"); },
  },
  {
    slug: "showcase",
    get label() { return t("boards.showcaseLabel"); },
    get blurb() { return t("boards.showcaseBlurb"); },
  },
  {
    slug: "help",
    get label() { return t("boards.helpLabel"); },
    get blurb() { return t("boards.helpBlurb"); },
  },
  {
    slug: "suggestions",
    get label() { return t("boards.suggestionsLabel"); },
    get blurb() { return t("boards.suggestionsBlurb"); },
  },
  {
    slug: "updates",
    get label() { return t("boards.updatesLabel"); },
    get blurb() { return t("boards.updatesBlurb"); },
    staffOnly: true,
  },
  {
    slug: "polls"
    get label() { return t("boards.pollsLabel"); },
    get blurb() { return t("boards.pollsBlurb"); },
    staffOnly: true,
  },
];

export const BOARD_BY_SLUG = Object.fromEntries(BOARDS.map((board) => [board.slug, board]));

export const boardLabel = (slug) => BOARD_BY_SLUG[slug]?.label || t("boards.generalLabel");

// The composer's category picker: every category the given session member may
// start a topic in (staff-only categories appear for staff alone).
export const composerBoardChoices = (user) => BOARDS
  .filter((board) => !board.staffOnly ||
    (user && (user.role === "owner" || user.role === "admin")))
  .map((board) => ({ value: board.slug, label: board.label }));
