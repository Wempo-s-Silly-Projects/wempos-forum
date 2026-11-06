// v4.0 plan 5 (spec step 6), task 1: the moderation desk's appeals section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { addText } from "../forms.js";

// The appeals queue (v3.1): one card per appeal. Pending appeals carry the
// decision pair; decided ones show their outcome. Appeals are BAN appeals
// since the auto-mod removal (v4.2) — every card shows the ban reason so the
// desk can judge the appeal, not just read it.
function createAppealQueue(appeals, document) {
  const list = document.createElement("div");
  list.className = "appeal-list";
  if (!appeals.length) {
    addText(document, list, "p", "There are no appeals.", "empty-state");
    return list;
  }
  for (const appeal of appeals) {
    const card = document.createElement("article");
    card.className = "appeal-card";
    addText(document, card, "h3", `Appeal #${appeal.id} — ${appeal.username}`);
    addText(document, card, "p",
      appeal.kind === "ban" ? "Ban appeal" : "Legacy appeal",
      "muted");
    addText(document, card, "p", "Ban reason: " + (appeal.banReason || "No reason was provided."));
    addText(document, card, "p", '"' + appeal.body + '"', "appeal-body");
    addText(document, card, "p",
      appeal.status === "pending"
        ? "Waiting for review — filed " + new Date(appeal.createdAt).toLocaleString()
        : appeal.status === "approved"
          ? "Approved " + (appeal.decidedAt ? new Date(appeal.decidedAt).toLocaleString() : "")
          : "Denied " + (appeal.decidedAt ? new Date(appeal.decidedAt).toLocaleString() : ""),
      "muted");
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
  return list;
}


export { createAppealQueue };
