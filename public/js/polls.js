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

// Polls (C3): the pure result-bars builder for the detail view. DOM-in/DOM-out
// (the render tests drive it through createPostCard with a mock document).
// Results are ALWAYS visible to everyone; members additionally get one vote
// button per option (aria-pressed marks their current option — votes are
// changeable). Widths are CSSOM width assignments (never inline style
// attributes in markup — CSP-compatible), and every color reads the theme
// tokens via classes, so the block renders correctly in light and dark.
import { t } from "./i18n.js";
import { createIcon } from "./icons.js";

export function renderPollBlock(poll, document, currentUser = null) {
  if (!poll || !Array.isArray(poll.options) || poll.options.length === 0) return null;
  const block = document.createElement("div");
  block.className = "post-poll";
  const question = document.createElement("p");
  question.className = "poll-question";
  question.textContent = poll.question;
  block.append(question);
  const total = Math.max(0, Number(poll.totalVotes) || 0);
  for (const option of poll.options) {
    const count = Number(option.count) || 0;
    const percent = total > 0 ? Math.round((count / total) * 100) : 0;
    const row = document.createElement("div");
    row.className = "poll-row";
    if (currentUser) {
      const vote = document.createElement("button");
      vote.type = "button";
      vote.className = "button button-quiet poll-vote";
      vote.dataset.action = "poll-vote";
      vote.dataset.optionId = String(option.id);
      vote.setAttribute("aria-pressed", String(poll.viewerOption === option.id));
      vote.setAttribute("aria-label", t("polls.voteFor", { label: option.label }));
      vote.append(createIcon(document, "poll"));
      row.append(vote);
    }
    const label = document.createElement("span");
    label.className = "poll-label";
    label.textContent = option.label;
    const bar = document.createElement("span");
    bar.className = "poll-bar";
    const fill = document.createElement("span");
    fill.className = "poll-bar-fill";
    fill.style.width = percent + "%";
    bar.append(fill);
    const tally = document.createElement("span");
    tally.className = "poll-count";
    tally.textContent = String(count);
    row.append(label, bar, tally);
    block.append(row);
  }
  const totalRow = document.createElement("p");
  totalRow.className = "poll-total";
  totalRow.textContent = total === 1 ? "1 vote" : total + " votes";
  block.append(totalRow);
  return block;
}
