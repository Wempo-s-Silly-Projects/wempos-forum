// v4.0 plan 5 (spec step 6), task 1: the desk's auto-mod panels — the Vision
// verdict line + kill-switch section and the OpenAI text-moderation twin —
// bodies moved verbatim out of ../admin.js (now dissolved). The shared
// verdict line rides here because the media queues render it too.
import { addText } from "../forms.js";

// Auto-mod / Vision (v3.1): the SafeSearch categories, in desk reading order.
// LIKELY+ values flag red; everything else prints muted.
const VISION_CATEGORIES = ["adult", "violence", "racy", "medical", "spoof"];
const VISION_FLAG_LEVELS = ["LIKELY", "VERY_LIKELY"];

// One muted report line for a pending queue card. vision comes straight from
// the queue payloads: null = no report yet (still checking, or the subsystem
// is off/not configured); { error } = the check ran but Vision failed
// (fail-open — the item still waits for a human either way).
export function appendVisionVerdict(document, card, vision) {
  if (!vision) {
    addText(document, card, "p", "Vision: no report yet.", "vision-verdict");
    return;
  }
  if (vision.error) {
    addText(document, card, "p", "Vision: unavailable (" + vision.error + ")", "vision-verdict");
    return;
  }
  const parts = [];
  let flagged = false;
  for (const category of VISION_CATEGORIES) {
    const value = vision[category];
    if (!value) continue;
    parts.push(category + ": " + value.toLowerCase().replace("very_", "very "));
    if (VISION_FLAG_LEVELS.includes(value)) flagged = true;
  }
  addText(document, card, "p",
    parts.length ? "Vision: " + parts.join(" · ") : "Vision: no flags reported.",
    "vision-verdict" + (flagged ? " vision-verdict-flagged" : ""));
}

export { createVisionSection, createTextModSection };

// The desk's Auto-mod control (v3.1): the status line plus THE kill switch —
// one click trips or clears the server-side toggle, effective on the next
// upload, no deploy. The switch is INDEPENDENT of the API key: the key gates
// configuration, the switch gates operation, and the switch state lives in
// the database — adding, rotating, or deleting the key secret can never
// silently re-enable (or reset) a tripped switch. So the toggle renders in
// EVERY state, including unconfigured, to make that durability visible.
function createVisionSection(vision, document) {
  const section = document.createElement("div");
  section.className = "vision-section";
  if (!vision.configured) {
    addText(document, section, "p",
      "Auto-mod is not configured — set the GOOGLE_VISION_API_KEY secret to enable it.", "muted");
  }
  addText(document, section, "p",
    vision.killSwitch
      ? "The kill switch is TRIPPED — new uploads are not checked. This stays tripped even if the API key is added or changed; only this button clears it."
      : vision.configured
        ? "Auto-mod is running — every new upload gets a Google Vision check in the background."
        : "The kill switch is clear. Auto-mod starts checking once a key is configured.",
    "vision-status" + (vision.killSwitch ? " vision-status-stopped" : ""));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = vision.killSwitch ? "button" : "button button-danger";
  toggle.dataset.action = vision.killSwitch ? "vision-resume" : "vision-kill";
  toggle.textContent = vision.killSwitch ? "Clear the kill switch (resume auto-mod)" : "Kill switch: STOP auto-mod";
  section.append(toggle);
  return section;
}

// The desk's text auto-mod control (v3.1): the OpenAI Moderation twin of the
// Vision section — status line plus THE kill switch, one click, effective on
// the next piece of member text. The same independence rule: the switch lives
// in the database, so the OPENAI_API_KEY secret can never reset it.
function createTextModSection(textMod, document) {
  const section = document.createElement("div");
  section.className = "vision-section";
  if (!textMod.configured) {
    addText(document, section, "p",
      "Text auto-mod is not configured — set the OPENAI_API_KEY secret to enable it.", "muted");
  }
  addText(document, section, "p",
    textMod.killSwitch
      ? "The text kill switch is TRIPPED — member text is not checked. This stays tripped even if the API key is added or changed; only this button clears it."
      : textMod.configured
        ? "Text auto-mod is running — every post, reply, chat message, and DM gets an OpenAI moderation check in the background."
        : "The text kill switch is clear. Text auto-mod starts checking once a key is configured.",
    "vision-status" + (textMod.killSwitch ? " vision-status-stopped" : ""));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = textMod.killSwitch ? "button" : "button button-danger";
  toggle.dataset.action = textMod.killSwitch ? "text-mod-resume" : "text-mod-kill";
  toggle.textContent = textMod.killSwitch
    ? "Clear the text kill switch (resume text auto-mod)"
    : "Kill switch: STOP text auto-mod";
  section.append(toggle);
  return section;
}

