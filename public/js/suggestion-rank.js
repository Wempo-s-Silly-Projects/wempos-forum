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

// Suggestion rank (wave 2026-11-21-34): the Suggestions board lists ideas by
// net votes, so each card shows its place in that order ("#1", "#2", ...).
// Only the feed's own cards (direct children of a .post-list) are counted;
// a card that already carries a rank keeps it, so Load older continues the
// count. The badge leads the author row; screen readers hear "Rank N by
// votes" from a visually-hidden label instead of the bare "#N". The number
// is the order on this page view; it touches no storage, makes no request.
export function numberSuggestionCards(document, container) {
  const cards = [...container.querySelectorAll("div.post-list")]
    .flatMap((list) => [...list.children])
    .filter((node) => String(node.className).split(" ").includes("post-card"));
  cards.forEach((card, index) => {
    if (card.dataset.suggestionRank) return;
    const author = card.querySelector("div.post-author");
    if (!author) return;
    const rank = index + 1;
    card.dataset.suggestionRank = String(rank);
    const badge = document.createElement("span");
    badge.className = "suggestion-rank";
    badge.textContent = "#" + rank;
    badge.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "visually-hidden";
    label.textContent = t("feed.suggestionRank", { rank });
    author.prepend(badge, label);
  });
}
