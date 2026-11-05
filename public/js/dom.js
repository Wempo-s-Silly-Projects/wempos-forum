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

export const main = document.querySelector("#main-content");
export const accountActions = document.querySelector("#account-actions");
export const statusMessage = document.querySelector("#status-message");
export const errorMessage = document.querySelector("#error-message");
export const reportDialog = document.querySelector("#report-dialog");
export const reportForm = reportDialog.querySelector('[data-form="report"]');
export const attachmentLightbox = document.querySelector("#attachment-lightbox");
export const confirmDialog = document.querySelector("#confirm-dialog");
export const confirmOk = confirmDialog.querySelector("#confirm-ok");
const confirmTitle = confirmDialog.querySelector("#confirm-title");
const confirmMessage = confirmDialog.querySelector("#confirm-message");
let confirmHandler = null;

// Destructive-action confirmation (v2.4.1 feature): one shared dialog for both
// deletion flows. openConfirmDialog fills the copy from the pending action and
// stores its handler; the confirm-ok button runs it. Copy always reaches the
// DOM through textContent, never markup.
export function openConfirmDialog(title, message, onConfirm) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmHandler = onConfirm;
  confirmDialog.showModal();
}

export const getConfirmHandler = () => confirmHandler;
export const clearConfirmHandler = () => {
  confirmHandler = null;
};

const element = (tagName, className = "", text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setMessage(message = "", isError = false) {
  statusMessage.textContent = isError ? "" : message;
  errorMessage.textContent = isError ? message : "";
}

export function addHeading(parent, text, level = 1) {
  const heading = element(`h${level}`, level === 1 ? "page-heading" : "", text);
  parent.append(heading);
  return heading;
}

export function createPanel(title, description = "") {
  const panel = element("section", "panel");
  addHeading(panel, title, 2);
  if (description) addText(document, panel, "p", description, "muted");
  return panel;
}

export function addSubmit(form, label) {
  const button = element("button", "button button-primary", label);
  button.type = "submit";
  form.append(button);
  return button;
}

export { element };
