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

// Saved searches (v5.48.0): the "Saved searches" panel on the search results
// page, for signed-in members only. "Save this search" opens an inline,
// labelled name form (never window.prompt); the list shows each saved search
// as a Run link back to the existing search page (built with the URL API)
// plus a Delete button. Only the owner ever sees the list (the server keys
// every query on the session). All text lands through textContent; nothing
// is stored on the device.
import { api } from "./api.js";
import { t } from "./i18n.js";
import { searchPagePath } from "./search-filters.js";

export const SAVED_SEARCHES_PATH = "/api/me/saved-searches";
export const SAVED_SEARCH_NAME_MAX_CHARS = 40;
const SAVED_SEARCHES_MAX = 20;
const URL_BASE = "https://forum.invalid";
const CONFLICT_STATUS = 409;

let panelCount = 0;

// The search page URL for a saved search, e.g. "/?q=cats&by=bob".
export function savedSearchLink(item) {
  const url = new URL(searchPagePath(item?.q ?? ""), URL_BASE);
  if (typeof item?.by === "string" && item.by) url.searchParams.set("by", item.by);
  if (typeof item?.in === "string" && item.in) url.searchParams.set("in", item.in);
  return url.pathname + url.search;
}

function child(document, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildForm(document, ids) {
  const form = child(document, "form", "saved-search-form");
  form.id = ids.form;
  form.hidden = true;
  const label = child(document, "label", "saved-search-label", t("savedSearch.nameLabel"));
  label.setAttribute("for", ids.input);
  const input = child(document, "input", "saved-search-name");
  input.id = ids.input;
  input.type = "text";
  input.maxLength = SAVED_SEARCH_NAME_MAX_CHARS;
  input.setAttribute("maxlength", String(SAVED_SEARCH_NAME_MAX_CHARS));
  input.required = true;
  input.autocomplete = "off";
  const submit = child(document, "button", "button button-secondary saved-search-submit", t("common.save"));
  submit.type = "submit";
  const cancel = child(document, "button", "button button-quiet saved-search-cancel", t("common.cancel"));
  cancel.type = "button";
  const actions = child(document, "div", "saved-search-actions");
  actions.append(submit, cancel);
  form.append(label, input, actions);
  return { form, input, cancel };
}

function buildItem(document, item, onDelete) {
  const row = child(document, "li", "saved-search-item");
  const run = child(document, "a", "saved-search-run", String(item.name ?? ""));
  run.href = savedSearchLink(item);
  run.setAttribute("data-app-link", "");
  const query = child(document, "span", "muted saved-search-query", String(item.q ?? ""));
  const remove = child(document, "button", "button button-quiet saved-search-delete", t("common.delete"));
  remove.type = "button";
  remove.setAttribute("aria-label", t("savedSearch.deleteLabel", { name: String(item.name ?? "") }));
  remove.addEventListener("click", () => onDelete(item));
  row.append(run, query, remove);
  return row;
}

export function createSavedSearches(document, { query, request = api }) {
  panelCount += 1;
  const ids = { form: "saved-search-form-" + panelCount, input: "saved-search-name-" + panelCount };
  const panel = child(document, "section", "panel saved-searches");
  const open = child(document, "button", "button button-secondary saved-search-open", t("savedSearch.open"));
  open.type = "button";
  open.setAttribute("aria-expanded", "false");
  open.setAttribute("aria-controls", ids.form);
  const { form, input, cancel } = buildForm(document, ids);
  const status = child(document, "p", "muted saved-search-status");
  status.setAttribute("role", "status");
  const slot = child(document, "div", "saved-search-list-slot");
  panel.append(child(document, "h2", "saved-searches-title", t("savedSearch.title")), open, form, status, slot);

  let items = [];
  const setOpen = (isOpen) => {
    form.hidden = !isOpen;
    open.setAttribute("aria-expanded", isOpen ? "true" : "false");
    (isOpen ? input : open).focus();
  };
  const deleteItem = (item) => {
    panel.pending = (async () => {
      try {
        await request(SAVED_SEARCHES_PATH + "/" + encodeURIComponent(String(item.id)), { method: "DELETE" });
        items = items.filter((entry) => entry.id !== item.id);
        render();
        status.textContent = t("savedSearch.deleted");
      } catch {
        status.textContent = t("savedSearch.deleteError");
      }
    })();
    return panel.pending;
  };
  const render = () => {
    slot.replaceChildren();
    if (!items.length) {
      slot.append(child(document, "p", "muted saved-search-empty", t("savedSearch.empty")));
      return;
    }
    const list = child(document, "ul", "saved-search-list");
    for (const item of items) list.append(buildItem(document, item, deleteItem));
    slot.append(list);
  };

  panel.loadSavedSearches = async () => {
    try {
      const data = await request(SAVED_SEARCHES_PATH);
      items = Array.isArray(data?.savedSearches) ? [...data.savedSearches] : [];
      render();
    } catch {
      // A failed read removes the panel rather than showing a wrong list.
      panel.remove();
    }
  };
  panel.saveCurrentSearch = async () => {
    const name = String(input.value ?? "").trim();
    if (!name) {
      input.focus();
      return;
    }
    try {
      const data = await request(SAVED_SEARCHES_PATH, { method: "POST", body: { name, q: String(query ?? "").trim() } });
      if (data?.savedSearch) items = [data.savedSearch, ...items];
      render();
      input.value = "";
      setOpen(false);
      status.textContent = t("savedSearch.saved");
    } catch (error) {
      if (error?.status === CONFLICT_STATUS) status.textContent = t("savedSearch.duplicate");
      else if (items.length >= SAVED_SEARCHES_MAX) status.textContent = t("savedSearch.cap", { max: SAVED_SEARCHES_MAX });
      else status.textContent = t("savedSearch.error");
    }
  };
  open.addEventListener("click", () => setOpen(form.hidden));
  cancel.addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    panel.saveCurrentSearch();
  });
  return panel;
}

export const loadSavedSearches = (panel) => panel.loadSavedSearches();
