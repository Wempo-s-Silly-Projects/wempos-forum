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

// The desk's owner-only Modules page (docs/modules.md): one switch per
// module from GET /api/admin/modules, saved with PUT. A module the server
// decides (an env hard-off, missing setup, or read-only like the human
// check) shows a disabled switch; dependency notes name what a module needs
// and what turning it off also turns off. Text is painted with textContent.
import { api } from "../api.js";
import { t } from "../i18n.js";

const LOCKED_REASONS = new Set(["env", "setup"]);

const labelOf = (byId, id) => (byId.has(id) ? t(byId.get(id).labelKey) : id);
const listOf = (byId, ids) => ids.map((id) => labelOf(byId, id)).join(", ");

function note(document, text, className) {
  const line = document.createElement("p");
  line.className = className;
  line.textContent = text;
  return line;
}

function moduleRow(document, module, byId, onToggle) {
  const row = document.createElement("li");
  row.className = "desk-module";
  row.dataset.module = module.id;
  const label = document.createElement("label");
  label.className = "desk-module-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = module.enabled === true;
  input.disabled = module.readOnly === true || LOCKED_REASONS.has(module.reason);
  input.addEventListener("change", () => onToggle(module.id, input.checked, input));
  const name = document.createElement("span");
  name.textContent = t(module.labelKey);
  label.append(input, name);
  row.append(label, note(document, t(module.descriptionKey), "muted"));
  if (input.disabled) row.append(note(document, t("modules.locked"), "desk-module-note"));
  if (module.deps.length) {
    row.append(note(document, t("modules.needs", { list: listOf(byId, module.deps) }), "desk-module-note"));
  }
  if (module.enabled && module.dependents.length) {
    row.append(note(document, t("modules.alsoOff", { list: listOf(byId, module.dependents) }), "desk-module-note"));
  }
  return row;
}

// createModulesPanel(data, document, request) -> the page body. Each save
// repaints the list from the server's answer (dependents included).
export function createModulesPanel(data, document, request = api) {
  const panel = document.createElement("div");
  panel.className = "desk-modules";
  const status = document.createElement("p");
  status.className = "desk-modules-status";
  status.setAttribute("role", "status");
  const list = document.createElement("ul");
  list.className = "desk-module-list";
  const paint = (modules) => {
    const byId = new Map(modules.map((module) => [module.id, module]));
    list.replaceChildren(...modules.map((module) => moduleRow(document, module, byId, save)));
  };
  async function save(id, enabled, input) {
    input.disabled = true;
    try {
      const result = await request("/api/admin/modules", { method: "PUT", body: { id, enabled } });
      paint(Array.isArray(result?.modules) ? result.modules : []);
      status.textContent = t("feed.bookmarkSaved");
    } catch (error) {
      input.checked = !enabled;
      input.disabled = false;
      status.textContent = error && error.message ? error.message : t("api.requestFailed", { status: 0 });
    }
  }
  paint(Array.isArray(data?.modules) ? data.modules : []);
  panel.append(status, list);
  return panel;
}
