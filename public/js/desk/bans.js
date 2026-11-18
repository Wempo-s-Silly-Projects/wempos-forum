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

// v4.0 plan 5 (spec step 6), task 1: the moderation desk's bans + member search (the unban/role surfaces live with them) section
// builders — bodies moved verbatim out of ../admin.js (now dissolved) and
// re-expressed on the vendored kit (5.0 wave 6).
import { el } from "../vendor/frontload/dom.mjs";
import { addText, createForm, createInput, createSelect } from "../vendor/designer/kit.mjs";
import { createCheckbox } from "../forms.js";

// Timed bans (v3.0.2): the duration picker's hours; 0 = permanent. The form
// submit handler (submitBanForm in app.js) turns hours into an absolute
// expiresAt, which the server validates (a minute to a year out).
const BAN_DURATION_HOURS = [
  { value: "0", label: "Permanent" },
  { value: "24", label: "1 day" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];

// One ban form — reason + duration + the opt-in IP ban — shared by the
// post-report queue, the profile-report queue, and the member search results,
// so a reported member can be banned from any desk.
const createBanForm = (userId, username) => {
  const form = createForm(document, "admin-ban", [
    createInput(document, {
      id: `ban-reason-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "reason",
      label: `Reason to ban ${username}`,
      required: true,
      maxLength: 500,
    }),
    createSelect(document, {
      id: `ban-duration-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "duration",
      label: "Ban duration",
      options: BAN_DURATION_HOURS,
      description: "Timed bans auto-reactivate the account when they expire.",
    }),
    createCheckbox(document, {
      id: `ban-ip-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "ipBan",
      label: "Also block this member's known networks (IP ban)",
      description: "Refuses sign-in and new accounts from every network they signed in from. Unbanning removes it. Shared connections (school/home networks) are blocked too — use with care.",
    }),
  ], "Ban member");
  form.dataset.userId = String(userId);
  return form;
};

// Find a member (v3.1, Pone's ask): staff search by username with the
// active-ban state attached. Results render into the results container the
// submit handler owns, so the desk section is self-contained.
function createMemberSearch() {
  const section = el("div", { class: "member-search" });
  const form = createForm(document, "admin-member-search", [
    createInput(document, {
      id: "member-search-q",
      name: "q",
      label: "Find a member",
      maxLength: 24,
      description: "Search by username to find members and unban them.",
    }),
  ], "Search");
  const results = el("div", { class: "member-search-results" });
  results.dataset.memberSearchResults = "";
  section.append(form, results);
  return section;
}

function renderMemberSearchResults(members) {
  const list = el("div", { class: "member-search-result-list" });
  if (!members.length) {
    addText(list, "No members matched.", "empty-state");
    return list;
  }
  for (const member of members) {
    const row = el("article", { class: "member-search-row" });
    row.append(el("a", {
      href: "/users/" + encodeURIComponent(member.username),
      "data-app-link": "",
      text: member.username,
    }));
    if (member.role === "owner" || member.role === "admin") {
      row.append(el("span", {
        class: "role-badge role-badge-" + member.role,
        text: member.role === "owner" ? "Owner" : "Admin",
      }));
    }
    if (member.banned) {
      row.append(el("p", {
        class: "member-search-ban-info",
        text: "Banned: " + (member.banReason || "no reason recorded") +
          (member.banExpiresAt
            ? " — expires " + new Date(member.banExpiresAt * 1000).toLocaleString()
            : " — permanent"),
      }));
      const unbanForm = createForm(document, "admin-unban", [
        createInput(document, {
          id: `unban-reason-search-${member.id}`,
          name: "reason",
          label: `Reason to unban ${member.username}`,
          required: true,
          maxLength: 500,
        }),
      ], "Unban member");
      unbanForm.dataset.userId = String(member.id);
      row.append(unbanForm);
    } else {
      addText(row, "Not banned.", "muted");
    }
    list.append(row);
  }
  return list;
}


// The active-bans list (spec §9): one card per ban — reason, expiry, and the
// unban form. Body moved verbatim out of ../admin.js (spec step 6).
function createActiveBanList(bans) {
  const list = el("div", { class: "ban-list" });
  if (!bans.length) {
    addText(list, "There are no active bans.", "empty-state");
    return list;
  }
  for (const ban of bans) {
    const card = el("article", { class: "ban-card" });
    card.append(el("h3", { text: ban.user.username }));
    addText(card, `Reason: ${ban.reason}`);
    if (ban.expiresAt) {
      addText(card, `Expires: ${new Date(ban.expiresAt).toLocaleString()}`);
    }
    const form = createForm(document, "admin-unban", [
      createInput(document, {
        id: `unban-reason-${ban.id}`,
        name: "reason",
        label: `Reason to unban ${ban.user.username}`,
        required: true,
        maxLength: 500,
      }),
    ], "Unban user");
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
