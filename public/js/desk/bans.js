// v4.0 plan 5 (spec step 6), task 1: the moderation desk's bans + member search (the unban/role surfaces live with them) section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { createCheckbox, createForm, createInput, createSelect, addText } from "../forms.js";

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
const createBanForm = (document, userId, username) => {
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
function createMemberSearch(document) {
  const section = document.createElement("div");
  section.className = "member-search";
  const form = createForm(document, "admin-member-search", [
    createInput(document, {
      id: "member-search-q",
      name: "q",
      label: "Find a member",
      maxLength: 24,
      description: "Search by username to find members and unban them.",
    }),
  ], "Search");
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
    addText(document, list, "p", "No members matched.", "empty-state");
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
        member.role === "owner" ? "Owner" : "Admin",
        "role-badge role-badge-" + member.role);
    }
    if (member.banned) {
      addText(document, row, "p",
        "Banned: " + (member.banReason || "no reason recorded") +
        (member.banExpiresAt
          ? " — expires " + new Date(member.banExpiresAt * 1000).toLocaleString()
          : " — permanent"),
        "member-search-ban-info");
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
      addText(document, row, "p", "Not banned.", "muted");
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
    addText(document, list, "p", "There are no active bans.", "empty-state");
    return list;
  }
  for (const ban of bans) {
    const card = document.createElement("article");
    card.className = "ban-card";
    addText(document, card, "h3", ban.user.username);
    addText(document, card, "p", `Reason: ${ban.reason}`);
    if (ban.expiresAt) {
      addText(document, card, "p", `Expires: ${new Date(ban.expiresAt).toLocaleString()}`);
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
