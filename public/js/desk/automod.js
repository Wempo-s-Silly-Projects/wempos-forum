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

// v5.18: the desk's AutoMod log and DM-report queue. Builders return nodes
// (createElement/textContent only); clicks ride the desk's data-action
// delegation in ../routes/admin.js ("post-restore", "resolve-dm-report").
import { addText } from "../forms.js";
import { currentLocale, t } from "../i18n.js";

function automodHead(entry) {
  const user = entry.target?.username || "?";
  if (entry.action === "hide") return t("admin.automodHid", { user });
  if (entry.action === "ban") return t("admin.automodBanned", { user, hours: entry.banHours ?? "" });
  return t("admin.automodReported", { user });
}

// One card per AutoMod action: what it did, its reason, when — and, for a
// hide still in force, the same Restore button the Hidden page uses.
function createAutoModLog(actions, document) {
  const container = document.createElement("div");
  container.className = "automod-log";
  if (!actions.length) {
    addText(document, container, "p", t("admin.noAutomod"), "empty-state");
    return container;
  }
  for (const entry of actions) {
    const card = document.createElement("div");
    card.className = "report-queue-item automod-entry";
    addText(document, card, "p", automodHead(entry), "report-queue-head");
    addText(document, card, "p", entry.reason, "report-queue-reason");
    addText(document, card, "p", new Date(entry.createdAt).toLocaleString(currentLocale()), "hidden-post-when");
    if (entry.action === "hide" && entry.stillHidden) {
      const restore = document.createElement("button");
      restore.className = "button";
      restore.type = "button";
      restore.textContent = t("admin.restore");
      restore.dataset.action = "post-restore";
      restore.dataset.postId = String(entry.targetId);
      card.append(restore);
    }
    container.append(card);
  }
  return container;
}

// Open DM reports: who reported which conversation and why. Staff read the
// conversation in the DM log, then resolve here.
function createDmReportQueue(reports, document) {
  const container = document.createElement("div");
  container.className = "dm-report-queue";
  if (!reports.length) {
    addText(document, container, "p", t("admin.noDmReports"), "empty-state");
    return container;
  }
  for (const report of reports) {
    const card = document.createElement("div");
    card.className = "report-queue-item";
    addText(document, card, "p", t("admin.dmReportHead", { reporter: report.reporter, other: report.other }), "report-queue-head");
    addText(document, card, "p", report.reason, "report-queue-reason");
    const resolve = document.createElement("button");
    resolve.className = "button";
    resolve.type = "button";
    resolve.textContent = t("admin.resolve");
    resolve.dataset.action = "resolve-dm-report";
    resolve.dataset.reportId = String(report.id);
    card.append(resolve);
    container.append(card);
  }
  return container;
}

export { createAutoModLog, createDmReportQueue };
