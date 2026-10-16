import { charsLeftLabel } from "./composer-limits.js";

export function createForm(document, name, fields, submitLabel) {
  const form = document.createElement("form");
  form.dataset.form = name;
  for (const field of fields) form.append(field);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button button-primary";
  submit.textContent = submitLabel;
  form.append(submit);
  return form;
}

export const createInput = (document, {
  id, name = id, label, type = "text", autoComplete, required = false,
  minLength, maxLength, accept, description,
}) => {
  const wrapper = document.createElement("div");
  wrapper.className = "form-field";
  const inputLabel = document.createElement("label");
  inputLabel.htmlFor = id;
  inputLabel.textContent = label;
  const input = document.createElement("input");
  input.id = id;
  input.name = name;
  input.type = type;
  input.required = required;
  if (autoComplete) input.autocomplete = autoComplete;
  if (minLength !== undefined) input.minLength = minLength;
  if (maxLength !== undefined) input.maxLength = maxLength;
  if (accept) input.accept = accept;
  wrapper.append(inputLabel, input);
  if (description) {
    const help = document.createElement("small");
    help.id = `${id}-description`;
    help.className = "form-note";
    help.textContent = description;
    input.setAttribute("aria-describedby", help.id);
    wrapper.append(help);
  }
  return wrapper;
}

export function createTextarea(document, {
  id, name = id, label, rows = 3, maxLength, required = false, description, counter = false, value,
}) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-field";
  const textareaLabel = document.createElement("label");
  textareaLabel.htmlFor = id;
  textareaLabel.textContent = label;
  const textarea = document.createElement("textarea");
  textarea.id = id;
  textarea.name = name;
  textarea.rows = rows;
  textarea.required = required;
  if (maxLength !== undefined) textarea.maxLength = maxLength;
  // Optional prefill (the edit composer seeds the current body). A property
  // .value assignment only — prefilled values can never parse as markup.
  if (value !== undefined) textarea.value = value;
  wrapper.append(textareaLabel, textarea);
  // Live character counter (composer textareas only, opt-in via `counter`):
  // always visible and muted via the .char-counter CSS class; the label text
  // comes from the DOM-free composer-limits.js so tests own the math. The
  // initial label reflects any prefill so the count is honest from first paint.
  if (counter && maxLength !== undefined) {
    const counterElement = document.createElement("div");
    counterElement.className = "char-counter";
    counterElement.dataset.charCounter = id;
    counterElement.setAttribute("aria-live", "polite");
    counterElement.textContent = charsLeftLabel(maxLength, value ?? "");
    textarea.addEventListener("input", () => {
      counterElement.textContent = charsLeftLabel(maxLength, textarea.value);
    });
    wrapper.append(counterElement);
  }
  if (description) {
    const help = document.createElement("small");
    help.id = `${id}-description`;
    help.className = "form-note";
    help.textContent = description;
    textarea.setAttribute("aria-describedby", help.id);
    wrapper.append(help);
  }
  return wrapper;
}

export function addText(document, parent, tagName, text, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}
