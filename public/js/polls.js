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

// Polls (C3): the pure result-bars builder for the detail view. DOM-in/DOM-out
// (the render tests drive it through createPostCard with a mock document).
// Results are ALWAYS visible to everyone; members additionally get one vote
// button per option (aria-pressed marks their current option — votes are
// changeable). Widths are CSSOM width assignments (never inline style
// attributes in markup — CSP-compatible), and every color reads the theme
// tokens via classes, so the block renders correctly in light and dark.
import { DEFAULT_LOCALE, currentLocale, t, tn } from "./i18n.js";
import { createIcon } from "./icons.js";

// v5.38.0 F3: "in 3 hours" in the reader's language (Intl, no strings), or ""
// for a missing, unparseable or already passed closing time.
const RELATIVE_UNITS = [["day", 86400], ["hour", 3600], ["minute", 60]];
export function formatClosesIn(closesAt, nowMs = Date.now(), locale = DEFAULT_LOCALE) {
  if (!closesAt) return "";
  const left = (Date.parse(closesAt) - nowMs) / 1000;
  if (!Number.isFinite(left) || left <= 0) return "";
  let format;
  try {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  } catch {
    format = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: "always" });
  }
  const [unit, size] = RELATIVE_UNITS.find(([, seconds]) => left >= seconds) ?? RELATIVE_UNITS.at(-1);
  return format.format(Math.max(1, Math.round(left / size)), unit);
}

// v5.38.0 F3: closing-time choices (seconds from now; "" clears).
export const POLL_DEADLINE_CHOICES = [
  ["", "polls.deadlineNone"], ["3600", "polls.deadlineHour"], ["86400", "polls.deadlineDay"],
  ["604800", "polls.deadlineWeek"], ["2592000", "polls.deadlineMonth"],
];

function deadlineControl(document) {
  const wrap = document.createElement("div");
  wrap.className = "poll-deadline";
  const select = document.createElement("select");
  select.className = "poll-deadline-select";
  select.setAttribute("aria-label", t("polls.deadlineLabel"));
  for (const [value, key] of POLL_DEADLINE_CHOICES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(key);
    select.append(option);
  }
  wrap.append(select, pollButton(document, "poll-deadline", "button button-quiet poll-deadline-save", t("polls.deadlineSave")));
  return wrap;
}

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
    if (currentUser && !poll.closed) {
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
    // v4.21: the share beside the raw count, and a "Your vote" mark on the
    // member's own option so a changed vote is obvious at a glance.
    const share = document.createElement("span");
    share.className = "poll-percent";
    share.textContent = percent + "%";
    row.append(label, bar, tally, share);
    if (currentUser && poll.viewerOption === option.id) {
      row.className = "poll-row poll-row-yours";
      const yours = document.createElement("span");
      yours.className = "poll-yours";
      yours.textContent = t("polls.yourVote");
      row.append(yours);
    }
    block.append(row);
  }
  const totalRow = document.createElement("p");
  totalRow.className = "poll-total";
  totalRow.textContent = tn("polls.total", total);
  block.append(totalRow);
  const hasVote = poll.viewerOption !== null && poll.viewerOption !== undefined;
  if (poll.closed) {
    // Wave 5.13 F1: results stay; voting (and taking a vote back) is over.
    const closedNote = document.createElement("p");
    closedNote.className = "poll-closed muted";
    closedNote.textContent = t("polls.closed");
    block.append(closedNote);
  } else if (formatClosesIn(poll.closesAt, Date.now(), currentLocale())) {
    // v5.38.0 F3: the closing time, computed at render from the payload.
    const closes = document.createElement("p");
    closes.className = "poll-closes muted";
    closes.textContent = t("polls.closesIn", { time: formatClosesIn(poll.closesAt, Date.now(), currentLocale()) });
    block.append(closes);
  }
  if (!poll.closed && currentUser && hasVote) {
    const hint = document.createElement("p");
    hint.className = "poll-hint muted";
    hint.textContent = t("polls.changeHint");
    block.append(hint);
    // Wave 5.13 F2: withdraw the vote entirely, not just move it.
    block.append(pollButton(document, "poll-unvote", "button button-quiet poll-unvote", t("polls.unvote")));
  }
  if (currentUser && poll.canManage) {
    // Wave 5.13 F1: the thread author (or staff) closes or reopens voting.
    const manage = pollButton(document, "poll-close", "button button-secondary poll-manage",
      poll.closed ? t("polls.reopen") : t("polls.close"));
    manage.dataset.closed = String(!poll.closed);
    block.append(manage);
    // v5.38.0 F3: set or clear the closing time while voting is open.
    if (!poll.closed) block.append(deadlineControl(document));
  }
  return block;
}

function pollButton(document, action, className, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = action;
  button.textContent = label;
  return button;
}
