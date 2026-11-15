
// Polls (C3): the pure result-bars builder for the detail view. DOM-in/DOM-out
// (the render tests drive it through createPostCard with a mock document).
// Results are ALWAYS visible to everyone; members additionally get one vote
// button per option (aria-pressed marks their current option — votes are
// changeable). Widths are CSSOM width assignments (never inline style
// attributes in markup — CSP-compatible), and every color reads the theme
// tokens via classes, so the block renders correctly in light and dark.
import { createIcon } from "./icons.js";

function normaliseCount(value) {
  const count = Number(value);

  return Number.isSafeInteger(count) && count > 0
    ? count
    : 0;
}

function normaliseOptionId(value) {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    /^[1-9]\d*$/.test(value)
  ) {
    const parsed = Number(value);

    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function renderPollBlock(poll, document, currentUser = null) {
  if (
    !poll ||
    !Array.isArray(poll.options) ||
    poll.options.length === 0
  ) {
    return null;
  }

  const block = document.createElement("div");
  block.className = "post-poll";

  const question = document.createElement("p");
  question.className = "poll-question";
  question.textContent = String(poll.question ?? "");

  block.append(question);

  const total = normaliseCount(poll.totalVotes);

  for (const option of poll.options) {
    if (!option || typeof option !== "object") {
      continue;
    }

    const count = normaliseCount(option.count);

    const percent = total > 0
      ? Math.min(100, Math.round((count / total) * 100))
      : 0;

    const row = document.createElement("div");
    row.className = "poll-row";

    const optionId = normaliseOptionId(option.id);

    if (currentUser && optionId !== null) {
      const vote = document.createElement("button");

      vote.type = "button";
      vote.className = "button button-quiet poll-vote";
      vote.dataset.action = "poll-vote";
      vote.dataset.optionId = String(optionId);

      vote.setAttribute(
        "aria-pressed",
        String(
          normaliseOptionId(poll.viewerOption) === optionId,
        ),
      );

      vote.setAttribute(
        "aria-label",
        "Vote: " + String(option.label ?? ""),
      );

      vote.append(createIcon(document, "poll"));
      row.append(vote);
    }

    const label = document.createElement("span");
    label.className = "poll-label";
    label.textContent = String(option.label ?? "");

    const bar = document.createElement("span");
    bar.className = "poll-bar";

    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", String(option.label ?? "Poll option"));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(percent));

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
  totalRow.textContent = total === 1
    ? "1 vote"
    : total + " votes";

  block.append(totalRow);

  return block;
}
