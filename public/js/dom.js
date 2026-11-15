
// v4.0 plan 4 Task 1: the boot shell's DOM singletons and the tiny panel
// helpers every route module builds screens out of. The singletons are the
// static markup's fixed nodes (#main-content, the status/error bar, the
// report/confirm/lightbox dialogs), queried once at import exactly as app.js
// did at boot; the helpers (element/setMessage/addHeading/createPanel/
// addSubmit) moved verbatim from app.js. No other module imports app.js, so
// this file is the shared homegoing forward.
//
// The confirm dialog's pending destructive handler lives HERE as module-private
// mutable state: a `let` re-export cannot be mutated by an importer, so the
// boot layer's confirm-ok / confirm-cancel actions reach it through the
// getConfirmHandler/clearConfirmHandler accessors instead of the bare binding
// the monolith shared.
import { addText } from "./forms.js";

// Fail clearly at boot if required static markup is missing.
function requireElement(selector, parent = document) {
  const node = parent.querySelector(selector);

  if (!node) {
    throw new Error(`Required application element is missing: ${selector}`);
  }

  return node;
}

export const main = requireElement("#main-content");
export const accountActions = requireElement("#account-actions");
export const statusMessage = requireElement("#status-message");
export const errorMessage = requireElement("#error-message");
export const reportDialog = requireElement("#report-dialog");
export const reportForm = requireElement('[data-form="report"]', reportDialog);
export const attachmentLightbox = requireElement("#attachment-lightbox");
export const confirmDialog = requireElement("#confirm-dialog");
export const confirmBlock = requireElement("#confirm-block", confirmDialog);
export const confirmDelete = requireElement("#confirm-delete", confirmDialog);
const confirmTitle = requireElement("#confirm-title", confirmDialog);
const confirmMessage = requireElement("#confirm-message", confirmDialog);

let confirmHandler = null;
export let action = null;

// Destructive-action confirmation (v2.4.1 feature): one shared dialog for both
// deletion flows. openConfirmDialog fills the copy from the pending action and
// stores its handler; the confirm-ok button runs it. Copy always reaches the
// DOM through textContent, never markup.
export function openConfirmDialog(title, message, actionType, onConfirm) {
  if (!["block", "delete", "unblock"].includes(actionType)) {
    throw new TypeError(
      `Unsupported confirmation action: ${String(actionType)}`,
    );
  }

  if (typeof onConfirm !== "function") {
    throw new TypeError("A confirmation callback is required.");
  }

  confirmTitle.textContent = title;
  confirmMessage.textContent = message;

  // The dialog has separate Block and Delete/Unblock buttons. Configure their
  // visibility and label on every open so Cancel, Escape, and failed requests
  // cannot leave stale button state for the next confirmation.
  const isBlock = actionType === "block";
  confirmBlock.hidden = !isBlock;
  confirmDelete.hidden = isBlock;
  confirmDelete.textContent = actionType === "unblock" ? "Unblock" : "Delete";

  action = actionType;
  confirmHandler = onConfirm;
  confirmDialog.showModal();
}

export const getConfirmHandler = () => confirmHandler;

export const clearConfirmHandler = () => {
  confirmHandler = null;
  action = null;
};

const element = (tagName, className = "", text) => {
  const node = document.createElement(tagName);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
};

export function setMessage(message = "", isError = false) {
  statusMessage.textContent = isError ? "" : message;
  errorMessage.textContent = isError ? message : "";
}

export function addHeading(parent, text, level = 1) {
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new RangeError(
      "Heading level must be an integer from 1 to 6.",
    );
  }

  const heading = element(
    `h${level}`,
    level === 1 ? "page-heading" : "",
    text,
  );

  parent.append(heading);
  return heading;
}

export function createPanel(title, description = "") {
  const panel = element("section", "panel");
  addHeading(panel, title, 2);

  if (description) {
    addText(document, panel, "p", description, "muted");
  }

  return panel;
}

export function addSubmit(form, label) {
  const button = element("button", "button button-primary", label);
  button.type = "submit";
  form.append(button);
  return button;
}

export { element };
