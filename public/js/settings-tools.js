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

// Settings helpers (v4.23), client-only: a search box that narrows the
// account settings to the sections whose text matches, and stable anchors
// (id per section) with a jump list. The jump list uses buttons that scroll
// and move focus rather than #fragment links — a fragment navigation would
// re-enter the SPA router and redraw the page.
import { t } from "./i18n.js";

const ID_PREFIX = "settings-";
const FILTER_INPUT_ID = "settings-filter-input";

function slugFor(text, index, taken) {
  const base = String(text ?? "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Headings in non-Latin scripts slug to nothing: fall back to the position.
  const candidate = ID_PREFIX + (base || `section-${index + 1}`);
  let id = candidate;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${candidate}-${suffix}`;
  taken.add(id);
  return id;
}

export function filterSettingsPanels(panels, query) {
  const needle = String(query ?? "").trim().toLocaleLowerCase();
  let shown = 0;
  for (const panel of panels) {
    const matches = !needle || panel.textContent.toLocaleLowerCase().includes(needle);
    panel.hidden = !matches;
    if (matches) shown += 1;
  }
  return shown;
}

export function addSectionAnchors(doc, panels) {
  const nav = doc.createElement("nav");
  nav.className = "settings-jump";
  nav.setAttribute("aria-label", t("settings.jumpLabel"));
  const taken = new Set();
  panels.forEach((panel, index) => {
    const heading = panel.querySelector("h2");
    const title = heading ? heading.textContent : "";
    panel.id = slugFor(title, index, taken);
    if (heading) heading.tabIndex = -1;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "button button-secondary settings-jump-link";
    button.dataset.target = panel.id;
    button.textContent = title;
    button.addEventListener("click", () => {
      panel.scrollIntoView?.({ block: "start" });
      heading?.focus({ preventScroll: true });
    });
    nav.append(button);
  });
  return nav;
}

export function createSettingsFilter(doc, panels, jumpNav = null) {
  const wrapper = doc.createElement("div");
  wrapper.className = "settings-filter";
  const label = doc.createElement("label");
  label.setAttribute("for", FILTER_INPUT_ID);
  label.textContent = t("settings.filterLabel");
  const input = doc.createElement("input");
  input.type = "search";
  input.id = FILTER_INPUT_ID;
  input.autocomplete = "off";
  const empty = doc.createElement("p");
  empty.className = "muted settings-filter-empty";
  empty.textContent = t("settings.filterEmpty");
  empty.hidden = true;
  // Wave 22 a11y: a hidden node that unhides is not announced, so the
  // no-match result also goes to a status mounted (empty) from the start.
  const status = doc.createElement("p");
  status.className = "visually-hidden settings-filter-status";
  status.setAttribute("role", "status");
  input.addEventListener("input", () => {
    const shown = filterSettingsPanels(panels, input.value);
    empty.hidden = shown !== 0;
    status.textContent = shown === 0 ? t("settings.filterEmpty") : "";
    // A jump button for a filtered-out section would scroll to nothing.
    for (const button of jumpNav ? Array.from(jumpNav.querySelectorAll("button")) : []) {
      const target = panels.find((panel) => panel.id === button.dataset.target);
      button.hidden = Boolean(target?.hidden);
    }
  });
  wrapper.append(label, input, empty, status);
  return wrapper;
}
