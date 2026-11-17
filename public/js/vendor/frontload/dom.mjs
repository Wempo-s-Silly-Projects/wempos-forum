// Project Designer — frontload/dom
// The CSP-safe DOM factory and the dialog idiom, extracted from the repos
// (wempo-accounts' vendored public/js/dom.js is the direct ancestor of
// el(); GooberCord's ui-helpers.js contributes the dialog conventions).
//
// THE HOUSE RULES this module enforces by construction:
//   - every element is created via createElement; user-provided text rides
//     textContent only — NEVER innerHTML (user data must never reach a
//     markup parser; the lint test in tests/frontload-dom.test.mjs asserts
//     this file contains no innerHTML write);
//   - dynamic styling rides class names (CSSOM), never inline style strings;
//   - dialogs self-remove: a helper opens, and its close handler removes
//     the node (Esc + backdrop included) so no DOM residue survives.
//
// No dependencies, no build step: import { el, openDialog } from the module.

// The document resolution: el() keeps the entrenched two-arg call shape
// used across both repos, so the document rides a settable module ref —
// the tests (and any popup/worker context) install theirs with
// useDocument(); everything else continues to use the global by default.
let documentRef = globalThis.document ?? null;

export function useDocument(doc) {
  documentRef = doc;
}

export function el(tagName, props = {}, ...children) {
  const element = documentRef.createElement(tagName);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;

    if (key === "class") {
      element.className = String(value);
      continue;
    }

    if (key === "text") {
      element.textContent = String(value);
      continue;
    }

    if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) {
        if (dv !== undefined && dv !== null) element.dataset[dk] = String(dv);
      }
      continue;
    }

    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }

    if (key === "value") {
      element.value = String(value);
      continue;
    }

    element.setAttribute(key, String(value));
  }

  // Deep-flatten: nested conditional arrays were (silently) stringified by
  // the single-level flat() the repos shipped — a real upstream bug this
  // module fixes; fragments-of-fragments now append node-wise.
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child);
  }

  return element;
}

// openDialog(doc, { heading, body, actions, onClose }) -> the dialog node.
// The one dialog idiom the repos share: a native <dialog> (Esc closes for
// free), a heading + body node, action buttons, and a close handler that
// REMOVES the node from the DOM (self-removing — no residue, no listeners
// left behind) before calling onClose('esc' | 'backdrop' | 'button' |
// 'action'). The backdrop click closes unless the dialog opts out with
// modalOnly: true (for destructive confirmations).
export function openDialog(doc, {
  heading,
  body,
  actions = [],
  modalOnly = false,
  onClose,
} = {}) {
  const dialog = doc.createElement("dialog");

  if (heading) {
    dialog.append(el("h2", { class: "dialog-heading", text: heading }));
  }

  if (body) dialog.append(body);

  if (actions.length > 0) {
    const row = el("div", { class: "dialog-actions" });
    for (const action of actions) {
      const press = el("button", {
        type: "button",
        class: action.class || "button",
        text: action.text,
      });
      press.addEventListener("click", () => {
        // The action runs FIRST (it may want to read the dialog's state or
        // open its own replacement); the self-removal + onClose land after.
        action.onPress?.();
        removeDialog("action");
      });
      row.append(press);
    }
    dialog.append(row);
  }

  const removeDialog = (reason) => {
    // Self-removing: every close path lands here exactly once (the native
    // close event fires on Esc; a re-entry guard keeps it single).
    if (!dialog.isConnected) return;
    dialog.close();
    dialog.remove();
    dialog.removeEventListener("close", onNativeClose);
    onClose?.(reason);
  };

  const onNativeClose = () => removeDialog("esc");
  dialog.addEventListener("close", onNativeClose);
  if (!modalOnly) {
    dialog.addEventListener("click", (event) => {
      // The native backdrop click targets the dialog element itself; any
      // click inside lands on real content and never closes.
      if (event.target === dialog) removeDialog("backdrop");
    });
  }

  doc.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// The "dialog-heading"/"dialog-actions" classes are the kit's shared names —
// the consuming stylesheet owns how they look (frontload/tokens ships the
// default). This module ships zero CSS on purpose; it is DOM-only.
