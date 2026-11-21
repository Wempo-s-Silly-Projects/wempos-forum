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

// v4.0 plan 5 (spec step 6), task 1: the moderation desk's bans + member search (the unban/role surfaces live with them) section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { createCheckbox, createForm, createInput, createSelect, addText } from "../forms.js";
import { currentLocale, t } from "../i18n.js";

// Timed bans (v3.0.2): the duration picker's hours; 0 = permanent. The form
// submit handler (submitBanForm in app.js) turns hours into an absolute
// expiresAt, which the server validates (a minute to a year out).
const banDurationHours = () => [
  { value: "0", label: t("desk.bans.durPermanent") },
  { value: "24", label: t("desk.bans.dur1d") },
  { value: "72", label: t("desk.bans.dur3d") },
  { value: "168", label: t("desk.bans.dur7d") },
  { value: "720", label: t("desk.bans.dur30d") },
];

// One ban form — reason + duration + the opt-in IP ban — shared by the
// post-report queue, the profile-report queue, and the member search results,
// so a reported member can be banned from any desk.
const createBanForm = (document, userId, username) => {
  const form = createForm(document, "admin-ban", [
    createInput(document, {
      id: `ban-reason-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "reason",
      label: t("desk.bans.reasonLabel", { username }),
      required: true,
      maxLength: 500,
    }),
    createSelect(document, {
      id: `ban-duration-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "duration",
      label: t("desk.bans.durationLabel"),
      options: banDurationHours(),
      description: t("desk.bans.durationHelp"),
    }),
    createCheckbox(document, {
      id: `ban-ip-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "ipBan",
      label: t("desk.bans.ipLabel"),
      description: t("desk.bans.ipHelp"),
    }),
  ], t("desk.bans.banButton"));
  form.dataset.userId = String(userId);
  return form;
};

// Find a member (v3.1, Pone's ask): staff search by username with the
// active-ban state attached. Results render into the results container the
// submit handler owns, so the desk section is self-contained.
function createMemberSearch(document) {
  const section = document.createElement("div");
  section.className = "member-search";
  const form = createForm(document, "admin-member-search", [
    createInput(document, {
      id: "member-search-q",
      name: "q",
      label: t("desk.bans.searchLabel"),
      maxLength: 24,
      description: t("desk.bans.searchHelp"),
    }),
  ], t("desk.bans.searchButton"));
  const results = document.createElement("div");
  results.className = "member-search-results";
  results.dataset.memberSearchResults = "";
  section.append(form, results);
  return section;
}

function renderMemberSearchResults(members, document) {
  const list = document.createElement("div");
  list.className = "member-search-result-list";
  if (!members.length) {
    addText(document, list, "p", t("desk.bans.noMatch"), "empty-state");
    return list;
  }
  for (const member of members) {
    const row = document.createElement("article");
    row.className = "member-search-row";
    const link = document.createElement("a");
    link.href = "/users/" + encodeURIComponent(member.username);
    link.setAttribute("data-app-link", "");
    link.textContent = member.username;
    row.append(link);
    if (member.role === "owner" || member.role === "admin") {
      addText(document, row, "span",
        member.role === "owner" ? t("desk.bans.owner") : t("desk.bans.admin"),
        "role-badge role-badge-" + member.role);
    }
    if (member.banned) {
      addText(document, row, "p",
        member.banExpiresAt
          ? t("desk.bans.bannedInfoExpires", {
            reason: member.banReason || t("desk.bans.noReasonRecorded"),
            when: new Date(member.banExpiresAt * 1000).toLocaleString(currentLocale()),
          })
          : t("desk.bans.bannedInfoPermanent", { reason: member.banReason || t("desk.bans.noReasonRecorded") }),
        "member-search-ban-info");
      const unbanForm = createForm(document, "admin-unban", [
        createInput(document, {
          id: `unban-reason-search-${member.id}`,
          name: "reason",
          label: t("desk.bans.unbanReason", { username: member.username }),
          required: true,
          maxLength: 500,
        }),
      ], t("desk.bans.unbanMember"));
      unbanForm.dataset.userId = String(member.id);
      row.append(unbanForm);
    } else {
      addText(document, row, "p", t("desk.bans.notBanned"), "muted");
    }
    list.append(row);
  }
  return list;
}


// The active-bans list (spec §9): one card per ban — reason, expiry, and the
// unban form. Body moved verbatim out of ../admin.js (spec step 6).
function createActiveBanList(bans, document) {
  const list = document.createElement("div");
  list.className = "ban-list";
  if (!bans.length) {
    addText(document, list, "p", t("desk.bans.empty"), "empty-state");
    return list;
  }
  for (const ban of bans) {
    const card = document.createElement("article");
    card.className = "ban-card";
    addText(document, card, "h3", ban.user.username);
    addText(document, card, "p", t("desk.bans.reason", { reason: ban.reason }));
    if (ban.expiresAt) {
      addText(document, card, "p", t("desk.bans.expires", { when: new Date(ban.expiresAt).toLocaleString(currentLocale()) }));
    }
    const form = createForm(document, "admin-unban", [
      createInput(document, {
        id: `unban-reason-${ban.id}`,
        name: "reason",
        label: t("desk.bans.unbanReason", { username: ban.user.username }),
        required: true,
        maxLength: 500,
      }),
    ], t("desk.bans.unbanUser"));
    form.dataset.userId = String(ban.user.id);
    card.append(form);
    list.append(card);
  }
  return list;
}

export {
  createBanForm,
  createActiveBanList,
  createMemberSearch,
  renderMemberSearchResults,
};
