// v4.0 plan 5 (spec step 6), task 1: the moderation desk's appeals section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { addText } from "../forms.js";

// The appeals queue (v3.1): one card per appeal. Pending appeals carry the
// decision pair; decided ones show their outcome. Context differs by kind —
// auto-mod appeals show the machine reason and verdicts, ban appeals show
// the ban reason — so the desk can judge the appeal, not just read it.
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
      appeal.kind === "ban" ? "Ban appeal" : "Auto-mod appeal",
      "muted");
    if (appeal.kind === "auto_image") {
      addText(document, card, "p", "Removed by: " + (appeal.actionReason || "auto-mod"));
      if (appeal.verdicts) {
        addText(document, card, "p",
          "Vision verdicts: " + Object.entries(appeal.verdicts)
            .filter(([, value]) => value)
            .map(([category, value]) => category + ": " + value)
            .join(" · "),
          "vision-verdict");
      }
      // What the OCR saw (v4.2) — the bytes are deleted; this is the trace.
      if (appeal.contentPreview) {
        addText(document, card, "p",
          "Text in the image: " + appeal.contentPreview, "flagged-content");
      }
    } else if (appeal.kind === "auto_text") {
      // Text verdicts: { flagged, categories: { name: score } } — only what
      // OpenAI flagged rides in the payload.
      addText(document, card, "p",
        appeal.entityKind === "post"
          ? "Hidden by: " + (appeal.actionReason || "auto-mod")
          : "Removed by: " + (appeal.actionReason || "auto-mod"));
      if (appeal.verdicts && appeal.verdicts.categories) {
        addText(document, card, "p",
          "Moderation scores: " + Object.entries(appeal.verdicts.categories)
            .map(([category, score]) => category + " " + Number(score).toFixed(2))
            .join(" · "),
          "vision-verdict");
      }
    } else {
      addText(document, card, "p", "Ban reason: " + (appeal.banReason || "No reason was provided."));
    }
    addText(document, card, "p", '"' + appeal.body + '"', "appeal-body");
    // What got flagged (v4.2): the snapshot stored at removal time — the only
    // record for chat/DM actions (the message was deleted) and the
    // classifier-truth for posts. The live post link below serves hidden posts
    // to staff through canViewPost.
    if (appeal.kind === "auto_text" && (appeal.contentPreview || appeal.postBody)) {
      addText(document, card, "p",
        "Flagged content: " + (appeal.contentPreview || appeal.postBody), "flagged-content");
    }
    if (appeal.kind === "auto_text" && appeal.entityKind === "post" && appeal.entityId) {
      addText(document, card, "p", "Original post:", "muted");
      const view = document.createElement("a");
      view.className = "button button-quiet flagged-content-link";
      view.href = "/posts/" + appeal.entityId;
      view.textContent = "View the original post";
      card.append(view);
    }
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
