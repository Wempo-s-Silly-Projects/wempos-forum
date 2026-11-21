// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.

import { charsLeftLabel } from "./composer-limits.js";
import { attachSubmitShortcut } from "./submit-shortcut.js";
import { createFormatHelp } from "./format-help.js";

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
  minLength, maxLength, accept, description, value,
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
  // Optional prefill (the ban-appeal username). A property assignment only —
  // prefilled values can never parse as markup.
  if (value !== undefined) input.value = value;
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

// A labeled fixed-choice <select> — same wrapper/label/help shape as
// createInput so forms read uniformly (the ban dialog's duration picker).
export const createSelect = (document, { id, name = id, label, options, required = false, description }) => {
  const wrapper = document.createElement("div");
  wrapper.className = "form-field";
  const inputLabel = document.createElement("label");
  inputLabel.htmlFor = id;
  inputLabel.textContent = label;
  const select = document.createElement("select");
  select.id = id;
  select.name = name;
  select.required = required;
  for (const { value, label: optionLabel } of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = optionLabel;
    select.append(option);
  }
  wrapper.append(inputLabel, select);
  if (description) {
    const help = document.createElement("small");
    help.id = `${id}-description`;
    help.className = "form-note";
    help.textContent = description;
    select.setAttribute("aria-describedby", help.id);
    wrapper.append(help);
  }
  return wrapper;
}

export function createTextarea(document, {
  id, name = id, label, rows = 3, maxLength, required = false, description, counter = false, value,
  submitShortcut = false, formatHelp = false,
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
  // Ctrl/Cmd+Enter posts (wave 19): forum composers opt in.
  if (submitShortcut) wrapper.append(attachSubmitShortcut(document, textarea));
  // Formatting help (wave 23): the forum composers opt in.
  if (formatHelp) wrapper.append(createFormatHelp(document));
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

// A labeled checkbox — the label WRAPS the input so the whole row is the
// click target (a11y for free), with an optional help line like createInput.
export const createCheckbox = (document, { id, name = id, label, checked = false, description }) => {
  const wrapper = document.createElement("div");
  wrapper.className = "form-field form-field-checkbox";
  const labelElement = document.createElement("label");
  labelElement.htmlFor = id;
  const input = document.createElement("input");
  input.id = id;
  input.name = name;
  input.type = "checkbox";
  input.checked = checked;
  labelElement.append(input, document.createTextNode(" " + label));
  wrapper.append(labelElement);
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

export function addText(document, parent, tagName, text, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}
