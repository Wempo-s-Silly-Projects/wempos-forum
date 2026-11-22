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

// v5.30.0: the desk's Visits section — private, aggregate-only analytics
// (api/analytics.mjs). It shows visits per day, the most-visited page TYPES
// and the referring sites for the last 7 or 30 days. Nothing here can name a
// visitor: the server stores only (day, page type) and (day, site) counts.
// Painted with createElement/textContent only; no storage, no chart library.
import { api } from "../api.js";
import { addText } from "../forms.js";
import { currentLocale, t } from "../i18n.js";

export const VISITS_WINDOWS = [7, 30];

export const visitsUrl = (days) => "/api/admin/analytics?days=" + days;

const formatCount = (value) => Number(value || 0).toLocaleString(currentLocale());

// A two-column table with a proportional bar behind each count (a styled
// <span> whose width is a percentage — no chart library).
function createCountTable(document, { caption, labelHeading, rows, labelOf }) {
  const table = document.createElement("table");
  table.className = "visits-table";
  const captionNode = document.createElement("caption");
  captionNode.textContent = caption;
  table.append(captionNode);
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of [labelHeading, t("desk.visits.viewsColumn")]) {
    const cell = document.createElement("th");
    cell.setAttribute("scope", "col");
    cell.textContent = text;
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);
  const body = document.createElement("tbody");
  const peak = Math.max(1, ...rows.map((row) => Number(row.views) || 0));
  for (const row of rows) {
    const line = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = labelOf(row);
    const count = document.createElement("td");
    count.className = "visits-count";
    const bar = document.createElement("span");
    bar.className = "visits-bar";
    bar.setAttribute("aria-hidden", "true");
    bar.style.width = Math.round(((Number(row.views) || 0) / peak) * 100) + "%";
    const number = document.createElement("span");
    number.textContent = formatCount(row.views);
    count.append(bar, number);
    line.append(label, count);
    body.append(line);
  }
  table.append(body);
  return table;
}

function renderVisitsBody(document, host, data) {
  host.replaceChildren();
  if (!data.enabled) addText(document, host, "p", t("desk.visits.disabled"), "muted");
  const total = data.totals.reduce((sum, row) => sum + (Number(row.views) || 0), 0);
  addText(document, host, "p", t("desk.visits.total", { days: data.days, count: formatCount(total) }), "visits-total");
  if (!data.totals.length) {
    addText(document, host, "p", t("desk.visits.empty"), "empty-state");
    return;
  }
  host.append(
    createCountTable(document, {
      caption: t("desk.visits.byDay"), labelHeading: t("desk.visits.dayColumn"),
      rows: data.totals, labelOf: (row) => row.day,
    }),
    createCountTable(document, {
      caption: t("desk.visits.topPages"), labelHeading: t("desk.visits.pageColumn"),
      rows: data.routes, labelOf: (row) => row.route,
    }),
  );
  if (data.referrers.length) {
    host.append(createCountTable(document, {
      caption: t("desk.visits.topSites"), labelHeading: t("desk.visits.siteColumn"),
      rows: data.referrers, labelOf: (row) => row.host,
    }));
  } else {
    addText(document, host, "p", t("desk.visits.noSites"), "muted");
  }
}

// The section: privacy note, a 7 / 30 day switch, then the tables.
export function createVisitsPanel(data, document) {
  const panel = document.createElement("div");
  panel.className = "visits-panel";
  addText(document, panel, "p", t("desk.visits.privacyNote", { days: data.retentionDays ?? 90 }), "muted");
  const switcher = document.createElement("div");
  switcher.className = "visits-window";
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", t("desk.visits.windowLabel"));
  const host = document.createElement("div");
  host.className = "visits-body";
  const buttons = VISITS_WINDOWS.map((days) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = t("desk.visits.lastDays", { days });
    button.setAttribute("aria-pressed", String(days === data.days));
    button.addEventListener("click", async () => {
      try {
        const next = await api(visitsUrl(days));
        for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
        renderVisitsBody(document, host, next);
      } catch (error) {
        console.error("Could not load visits:", error);
        addText(document, host, "p", t("desk.visits.loadFailed"), "form-error");
      }
    });
    switcher.append(button);
    return button;
  });
  panel.append(switcher, host);
  renderVisitsBody(document, host, data);
  return panel;
}
