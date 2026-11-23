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

// Saturday Fools (v5.86): the owner's site-wide off switch, shown under the
// desk's Branding section to the owner only (the server answers 403 to
// everyone else: requireAdmin). Checked = forced off for every visitor, even
// when env SATURDAY_FOOLS is "on". The box starts unchecked and is filled in
// from GET /api/admin/saturday-fools once it answers.
import { api } from "../api.js";
import { createForm } from "../forms.js";
import { t } from "../i18n.js";

export const FOOLS_SAVE_FORM = "saturday-fools-save";
export const FOOLS_FIELD = "forcedOff";
const FOOLS_PATH = "/api/admin/saturday-fools";

export const isOwner = (user) => Boolean(user && user.role === "owner");

export function createFoolsSwitch(document, load = () => api(FOOLS_PATH)) {
  const section = document.createElement("section");
  section.className = "panel fools-owner-switch";
  const heading = document.createElement("h2");
  heading.textContent = t("desk.fools.title");
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.name = FOOLS_FIELD;
  box.id = "fools-forced-off";
  label.htmlFor = box.id;
  label.append(box, document.createTextNode(" " + t("desk.fools.offLabel")));
  section.append(heading, createForm(document, FOOLS_SAVE_FORM, [label], t("desk.fools.save")));
  Promise.resolve().then(load).then((state) => { box.checked = state?.forcedOff === true; }).catch(() => null);
  return section;
}

// FormData carries the checkbox only when it is checked.
export async function submitFoolsSave(values) {
  return api(FOOLS_PATH, { method: "POST", body: { forcedOff: values?.get?.(FOOLS_FIELD) != null } });
}
