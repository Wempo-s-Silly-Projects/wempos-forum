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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// v5.19.0: the desk's branding section — the forum's name, tagline and
// footer (api/branding.mjs). The boxes hold what the owner SAVED (empty =
// the default, shown as the placeholder), so saving an untouched form keeps
// the translated default copy. The server enforces staff-only, the length
// limits and the word filter; values are painted with textContent only.
import { api } from "../api.js";
import { createForm, createInput } from "../forms.js";
import { t } from "../i18n.js";

const FIELDS = [
  { name: "name", labelKey: "desk.branding.nameLabel" },
  { name: "tagline", labelKey: "desk.branding.taglineLabel", helpKey: "desk.branding.taglineHelp" },
  { name: "footer", labelKey: "desk.branding.footerLabel" },
];

export function createBrandingEditor(data, document) {
  const saved = data && data.saved ? data.saved : {};
  const defaults = data && data.defaults ? data.defaults : {};
  const limits = data && data.limits ? data.limits : {};
  const fields = FIELDS.map((field) => {
    const wrapper = createInput(document, {
      id: "branding-" + field.name,
      name: field.name,
      label: t(field.labelKey),
      maxLength: limits[field.name],
      value: typeof saved[field.name] === "string" ? saved[field.name] : "",
      description: field.helpKey ? t(field.helpKey) : undefined,
    });
    const input = wrapper.querySelector("input");
    if (input && typeof defaults[field.name] === "string") input.placeholder = defaults[field.name];
    return wrapper;
  });
  return createForm(document, "branding-save", fields, t("desk.branding.saveButton"));
}

// Saves all three boxes; an empty box puts that piece back to the default.
export async function submitBrandingSave(text) {
  return api("/api/admin/branding", {
    method: "POST",
    body: { name: text("name"), tagline: text("tagline"), footer: text("footer") },
  });
}
