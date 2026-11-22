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

// The desk's Site health section: the 75th percentile of each anonymous Core
// Web Vital per page TYPE over the last 7 and 28 days (api/vitals.mjs), with
// Google's good / needs improvement / poor band beside each value. A plain
// table built with createElement/textContent; no storage, no chart library.
import { addText } from "../forms.js";
import { currentLocale, t } from "../i18n.js";

const BAND_KEYS = Object.freeze({
  "good": "desk.health.good",
  "needs-improvement": "desk.health.needsWork",
  "poor": "desk.health.poor",
});

// CLS is unitless; every other metric is milliseconds, in the reader's locale.
function formatValue(metric, value) {
  const locale = currentLocale();
  if (metric === "CLS") return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
  return new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond", maximumFractionDigits: 0 }).format(value);
}

function createWindowCell(document, metric, summary) {
  const cell = document.createElement("td");
  if (!summary || summary.p75 === null || summary.p75 === undefined || !BAND_KEYS[summary.band]) {
    cell.className = "health-cell health-none";
    cell.textContent = t("desk.health.noData");
    return cell;
  }
  cell.className = "health-cell health-" + summary.band;
  const value = document.createElement("span");
  value.className = "health-value";
  value.textContent = formatValue(metric, summary.p75);
  const band = document.createElement("span");
  band.className = "health-band";
  band.textContent = t(BAND_KEYS[summary.band]);
  const samples = document.createElement("span");
  samples.className = "health-samples muted";
  samples.textContent = t("desk.health.samples", { count: Number(summary.count || 0).toLocaleString(currentLocale()) });
  cell.append(value, band, samples);
  return cell;
}

function createHealthTable(document, rows) {
  const table = document.createElement("table");
  table.className = "visits-table health-table";
  const caption = document.createElement("caption");
  caption.textContent = t("admin.section.siteHealth");
  table.append(caption);
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const key of ["desk.health.pageColumn", "desk.health.metricColumn", "desk.health.weekColumn", "desk.health.monthColumn"]) {
    const cell = document.createElement("th");
    cell.setAttribute("scope", "col");
    cell.textContent = t(key);
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const line = document.createElement("tr");
    const route = document.createElement("th");
    route.setAttribute("scope", "row");
    route.textContent = row.route;
    const metric = document.createElement("td");
    metric.textContent = row.metric;
    line.append(route, metric, createWindowCell(document, row.metric, row.week), createWindowCell(document, row.metric, row.month));
    body.append(line);
  }
  table.append(head, body);
  return table;
}

export function createSiteHealthPanel(data, document) {
  const panel = document.createElement("div");
  panel.className = "visits-panel health-panel";
  addText(document, panel, "p", t("desk.health.privacyNote", { days: data.retentionDays ?? 90 }), "muted");
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) {
    addText(document, panel, "p", t("desk.health.empty"), "empty-state");
    return panel;
  }
  panel.append(createHealthTable(document, rows));
  return panel;
}
