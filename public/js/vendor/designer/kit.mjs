// Project Designer — designer/kit
// The light component ergonomics, extracted from wempos-forum's public/js/
// (dom.js's panel/heading/submit, forms.js's field factory family). The
// owner's ask: one panel(), one form(), a small state store — no templating,
// no virtual DOM, no build step.
//
// THE HOUSE RULES this module enforces by construction:
//   - every node builds through frontload/dom's el(): user text rides
//     textContent, classes ride class names, nothing ever parses markup.
//   - forms announce themselves with data-form (the apps' submit dispatch
//     keys on it), fields are ALWAYS labeled (label.htmlFor → input.id),
//     and a description wire becomes aria-describedby — a11y is structural,
//     not a caller's option.
//   - the store is deliberately tiny: get/set/subscribe over a plain object.
//     The apps' caches pattern (GC's module-level CACHES, the forum's
//     state.js) is the source idiom; anything needing reducers/atoms is
//     outside the house style.
//
// Depends only on frontload/dom (shared useDocument injection — tests and
// callers install their document once).

import { el } from "../frontload/dom.mjs";

// One heading: level 1 is the page heading class, others plain.
export function addHeading(parent, text, level = 1) {
  const heading = el("h" + Math.min(Math.max(level, 1), 6),
    { class: level === 1 ? "page-heading" : "", text });
  parent.append(heading);
  return heading;
}

export function addText(parent, text, className = "") {
  const paragraph = el("p", { class: className, text });
  parent.append(paragraph);
  return paragraph;
}

// One panel: a section.panel with a heading; the muted description only
// when given.
export function panel({ title, description = "" } = {}) {
  const section = el("section", { class: "panel" });
  if (title) addHeading(section, title, 2);
  if (description) addText(section, description, "muted");
  return section;
}

// One submit: the primary button that closes the form; verbatim shape.
export function addSubmit(form, label) {
  const button = el("button", { class: "button button-primary", text: label, type: "submit" });
  form.append(button);
  return button;
}

// --- the field factory family (verbatim from forum forms.js) ----------------

export function createForm(doc, name, fields, submitLabel) {
  const form = doc.createElement("form");
  form.dataset.form = name;
  for (const field of fields) form.append(field);
  const submit = doc.createElement("button");
  submit.type = "submit";
  submit.className = "button button-primary";
  submit.textContent = submitLabel;
  form.append(submit);
  return form;
}

export const createInput = (doc, {
  id, name = id, label, type = "text", autoComplete, required = false,
  minLength, maxLength, accept, description, value,
}) => {
  const wrapper = doc.createElement("div");
  wrapper.className = "form-field";
  const inputLabel = doc.createElement("label");
  inputLabel.htmlFor = id;
  inputLabel.textContent = label;
  const input = doc.createElement("input");
  input.id = id;
  input.name = name;
  input.type = type;
  input.required = required;
  if (autoComplete) input.autocomplete = autoComplete;
  if (minLength !== undefined) input.minLength = minLength;
  if (maxLength !== undefined) input.maxLength = maxLength;
  if (accept) input.accept = accept;
  // Optional prefill (the ban-appeal username). A property assignment only —
  // prefilled values can never parse as markup.
  if (value !== undefined) input.value = value;
  wrapper.append(inputLabel, input);
  if (description) {
    const help = doc.createElement("small");
    help.id = `${id}-description`;
    help.className = "form-note";
    help.textContent = description;
    input.setAttribute("aria-describedby", help.id);
    wrapper.append(help);
  }
  return wrapper;
};

// A labeled fixed-choice <select> — same wrapper/label/help shape as
// createInput so forms read uniformly.
export const createSelect = (doc, { id, name = id, label, options, required = false, description }) => {
  const wrapper = doc.createElement("div");
  wrapper.className = "form-field";
  const inputLabel = doc.createElement("label");
  inputLabel.htmlFor = id;
  inputLabel.textContent = label;
  const select = doc.createElement("select");
  select.id = id;
  select.name = name;
  select.required = required;
  for (const { value, label: optionLabel } of options) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = optionLabel;
    select.append(option);
  }
  wrapper.append(inputLabel, select);
  if (description) {
    const help = doc.createElement("small");
    help.id = `${id}-description`;
    help.className = "form-note";
    help.textContent = description;
    select.setAttribute("aria-describedby", help.id);
    wrapper.append(help);
  }
  return wrapper;
};

// --- the small state store --------------------------------------------------

// createStore: get/set/subscribe with the module-level-caches idiom as the
// contract — set() notifies AFTER the value swaps, and a listener is never
// re-entered by its own error (it would recurse). Reads of the store
// pattern (GC's refreshSocial, the forum's bell counts) want exactly one
// notify per set, and nothing else.
export function createStore(initial = null) {
  let value = initial;
  const listeners = new Set();
  return {
    get() {
      return value;
    },
    set(next) {
      const previous = value;
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener(next, previous);
        } catch (error) {
          console.error("Store listener failed:", error && error.name ? error.name : "UnknownError");
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
