// v4.0 plan 5 (spec step 6), task 1: the moderation desk's appeals section
// builders — bodies moved verbatim out of ../admin.js (now dissolved) and
// re-expressed on the vendored kit (5.0 wave 6).
import { el } from "../vendor/frontload/dom.mjs";
import { addText } from "../vendor/designer/kit.mjs";

// The appeals queue (v3.1): one card per appeal. Pending appeals carry the
// decision pair; decided ones show their outcome. Appeals are BAN appeals
// since the auto-mod removal (v4.2) — every card shows the ban reason so the
// desk can judge the appeal, not just read it.
function createAppealQueue(appeals) {
  const list = el("div", { class: "appeal-list" });
  if (!appeals.length) {
    addText(list, "There are no appeals.", "empty-state");
    return list;
  }
  for (const appeal of appeals) {
    const card = el("article", { class: "appeal-card" });
    card.append(el("h3", { text: `Appeal #${appeal.id} — ${appeal.username}` }));
    addText(card,
      appeal.kind === "ban" ? "Ban appeal" : "Legacy appeal",
      "muted");
    addText(card, "Ban reason: " + (appeal.banReason || "No reason was provided."));
    addText(card, '"' + appeal.body + '"', "appeal-body");
    addText(card,
      appeal.status === "pending"
        ? "Waiting for review — filed " + new Date(appeal.createdAt).toLocaleString()
        : appeal.status === "approved"
          ? "Approved " + (appeal.decidedAt ? new Date(appeal.decidedAt).toLocaleString() : "")
          : "Denied " + (appeal.decidedAt ? new Date(appeal.decidedAt).toLocaleString() : ""),
      "muted");
    if (appeal.status === "pending") {
      const actions = el("div", { class: "form-actions" });
      for (const [decision, label, className] of [
        ["approve", "Approve appeal", "button button-primary"],
        ["deny", "Deny appeal", "button button-danger"],
      ]) {
        const form = el("form", {
          dataset: { form: "admin-appeal", appealId: String(appeal.id), decision },
        });
        form.append(el("button", {
          type: "submit",
          class: className,
          text: label,
        }));
        actions.append(form);
      }
      card.append(actions);
    }
    list.append(card);
  }
  return list;
}


export { createAppealQueue };
