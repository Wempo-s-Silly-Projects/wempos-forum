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

// Wave 2026-11-21-36 F1 — Saved posts by board. The /bookmarks page gets a
// row of board chips (/bookmarks?board=<slug>, linkable like the feed views)
// and, inside one board, a "Remove all saved from <board>" button that asks
// first and then calls DELETE /api/me/bookmarks?board=<slug>. Nothing is
// stored on the device: the server's saved list is the only state.
import { BOARDS, BOARD_BY_SLUG, boardLabel } from "./boards.js";
import { t, tn } from "./i18n.js";

export const SAVED_PATH = "/bookmarks";

export const isSavedBoard = (board) => typeof board === "string" && Object.hasOwn(BOARD_BY_SLUG, board);

// The list URL for one page: the board (when valid) and the cursor.
export function savedListPath(board, before) {
  const params = [];
  if (isSavedBoard(board)) params.push("board=" + board);
  if (before) params.push("before=" + encodeURIComponent(before));
  return "/api/me/bookmarks" + (params.length ? "?" + params.join("&") : "");
}

export function createSavedBoardFilter(document, activeBoard) {
  const nav = document.createElement("nav");
  nav.className = "feed-views saved-boards";
  nav.setAttribute("aria-label", t("saved.filterLabel"));
  const spec = [[undefined, t("saved.allBoards")], ...BOARDS.map((board) => [board.slug, board.label])];
  for (const [slug, label] of spec) {
    const chip = document.createElement("a");
    chip.className = "feed-view";
    chip.textContent = label;
    chip.href = slug ? SAVED_PATH + "?board=" + slug : SAVED_PATH;
    chip.setAttribute("data-app-link", "");
    if (slug === activeBoard || (!slug && !isSavedBoard(activeBoard))) chip.setAttribute("aria-current", "page");
    nav.append(chip);
  }
  return nav;
}

export function savedEmptyText(board) {
  return isSavedBoard(board) ? t("saved.boardEmpty", { board: boardLabel(board) }) : t("feed.bookmarksEmpty");
}

export function createRemoveSavedBoard(document, board) {
  const button = document.createElement("button");
  button.className = "button button-quiet saved-board-remove";
  button.type = "button";
  button.dataset.action = "remove-saved-board";
  button.dataset.board = board;
  button.textContent = t("saved.removeBoard", { board: boardLabel(board) });
  return button;
}

// Asks first; a "no" (or an unknown board) sends nothing and answers null.
// Otherwise the server's removed count comes back for the status line.
export async function removeSavedBoard({ api, confirm, board }) {
  if (!isSavedBoard(board)) return null;
  if (!confirm(t("saved.removeBoardConfirm", { board: boardLabel(board) }))) return null;
  const result = await api(savedListPath(board), { method: "DELETE" });
  return Math.max(0, Number(result?.removed) || 0);
}

export const removedSavedMessage = (count) => tn("saved.removedBoard", count);
