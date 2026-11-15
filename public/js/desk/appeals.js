
// v4.0 plan 5 (spec step 6), task 1: the moderation desk's appeals section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { addText } from "../forms.js";

function formatDate(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "Unknown date";
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : "Unknown date";
}

function isValidAppeal(appeal) {
  return Boolean(
    appeal &&
    typeof appeal === "object" &&
    Number.isSafeInteger(Number(appeal.id)) &&
    Number(appeal.id) > 0 &&
    typeof appeal.username === "string" &&
    typeof appeal.body === "string",
  );
}

// The appeals queue (v3.1): one card per appeal. Pending appeals carry the
// decision pair; decided ones show their outcome. Appeals are BAN appeals
// since the auto-mod removal (v4.2) — every card shows the ban reason so the
// desk can judge the appeal, not just read it.
function createAppealQueue(appeals, document) {
  const list = document.createElement("div");
  list.className = "appeal-list";

  if (!Array.isArray(appeals)) {
    addText(
      document,
      list,
      "p",
      "Appeals could not be loaded.",
      "empty-state",
    );
    return list;
  }

  if (!appeals.length) {
    addText(document, list, "p", "There are no appeals.", "empty-state");
    return list;
  }

  const statusLabels = {
    pending: "Waiting for review",
    approved: "Approved",
    denied: "Denied",
  };

  for (const appeal of appeals) {
    if (!isValidAppeal(appeal)) continue;

    const card = document.createElement("article");
    card.className = "appeal-card";

    addText(
      document,
      card,
      "h3",
      `Appeal #${appeal.id} — ${appeal.username}`,
    );

    addText(
      document,
      card,
      "p",
      appeal.kind === "ban" ? "Ban appeal" : "Legacy appeal",
      "muted",
    );

    const banReason =
      typeof appeal.banReason === "string" && appeal.banReason.trim()
        ? appeal.banReason
        : "No reason was provided.";

    addText(
      document,
      card,
      "p",
      "Ban reason: " + banReason,
    );

    addText(
      document,
      card,
      "p",
      '"' + appeal.body + '"',
      "appeal-body",
    );

    const statusLabel = statusLabels[appeal.status] ?? "Unknown status";

    let statusText = statusLabel;

    if (appeal.status === "pending") {
      statusText += " — filed " + formatDate(appeal.createdAt);
    } else if (appeal.status === "approved" || appeal.status === "denied") {
      statusText += " " + formatDate(appeal.decidedAt);
    }

    addText(document, card, "p", statusText, "muted");

    if (appeal.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "form-actions";

      for (const [decision, label, className] of [
        ["approve", "Approve appeal", "button button-primary"],
        ["deny", "Deny appeal", "button button-danger"],
      ]) {
        const form = document.createElement("form");
        form.dataset.form = "admin-appeal";
        form.dataset.appealId = String(appeal.id);
        form.dataset.decision = decision;

        const button = document.createElement("button");
        button.type = "submit";
        button.className = className;
        button.textContent = label;

        form.append(button);
        actions.append(form);
      }

      card.append(actions);
    }

    list.append(card);
  }

  if (!list.children.length) {
    addText(
      document,
      list,
      "p",
      "No valid appeals could be displayed.",
      "empty-state",
    );
  }

  return list;
}

export { createAppealQueue };
