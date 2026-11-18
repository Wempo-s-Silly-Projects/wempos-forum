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

// v4.0 plan 4 Task 8: the moderation desk — the /admin route and its fourteen
// payloads, the desk section builders that live inside app.js's renderAdmin
// (profile-report queue, hidden posts queue, rules editor, CSS queue), and the
// desk submits (resolve, ban/unban, role changes, avatar/attachment
// moderation, member search). Bodies moved verbatim out of app.js; bare
// renderRoute calls inside moved bodies re-read the boot state
// (state.renderRoute). The queue/form section builders moved to the desk/
// modules in plan 6 (spec step 6): appeals, bans, chat-log, media,
// reports — imported below. The route is re-expressed on the vendored kit
// (5.0 wave 6); chat-log stays on its forms.js twins (untouched this wave).
import { el } from "../vendor/frontload/dom.mjs";
import { addHeading, addText } from "../vendor/designer/kit.mjs";
import { api } from "../api.js";
import { main, setMessage } from "../dom.js";
import { state } from "../state.js";
import { createAppealQueue } from "../desk/appeals.js";
import {
  createActiveBanList,
  createBanForm,
  createMemberSearch,
  renderMemberSearchResults,
} from "../desk/bans.js";
import { createChatLog, createDmLog } from "../desk/chat-log.js";
import {
  createAttachmentQueue,
  createAvatarQueue,
  createGifQueue,
} from "../desk/media.js";
import { createReportQueue } from "../desk/reports.js";
import { createFilterEditor } from "../desk/filter.js";

// The desk (v4.2 redesign): /admin is a section-routed panel — a sidebar rail
// of dedicated pages (each loading exactly one desk payload) plus a dashboard
// overview that counts every queue and shows what actually needs staff eyes.
// The old single page stacked all fourteen payloads fetch-at-once; sections
// keep the same endpoint surface, just one fetch per visit.
const DESK_SECTIONS = [
  { slug: "dashboard", label: "Overview" },
  { slug: "reports", label: "Post reports" },
  { slug: "profile-reports", label: "Profile reports" },
  { slug: "appeals", label: "Appeals" },
  { slug: "images", label: "Images" },
  { slug: "avatars", label: "Avatars" },
  { slug: "gifs", label: "GIF library" },
  { slug: "css", label: "Profile CSS" },
  { slug: "hidden", label: "Hidden posts" },
  { slug: "bans", label: "Bans & members" },
  { slug: "chat-log", label: "Chat log" },
  { slug: "dm-log", label: "DM log" },
  { slug: "rules", label: "Rules" },
  { slug: "filter", label: "Word filter" },
];

// slug → { lede, load(), build() }. Every build() appends the section's body
// to `main` after the shell; each loads only what it renders.
const DESK_BUILDERS = {
  "reports": {
    lede: "Open post reports, newest first — resolve, ban, or dismiss.",
    load: () => api("/api/admin/reports"),
    build: (data, user) => createReportQueue(data.reports, user),
  },
  "profile-reports": {
    lede: "Reported profiles — resolve, view, or ban the reported member.",
    load: () => api("/api/admin/profile-reports"),
    build: (data) => createProfileReportQueue(data.profileReports),
  },
  "appeals": {
    lede: "Second looks at bans a member appealed. Approve to revoke the ban — approval notifies the member.",
    load: () => api("/api/admin/appeals"),
    build: (data) => createAppealQueue(data.appeals),
  },
  "images": {
    lede: "Attachments awaiting review. Author sees their own pending images; approve makes them public.",
    load: () => api("/api/admin/attachments"),
    build: (data) => createAttachmentQueue(data.attachments),
  },
  "avatars": {
    lede: "Avatar uploads awaiting review. The previous avatar keeps serving until you decide.",
    load: () => api("/api/admin/avatars"),
    build: (data) => createAvatarQueue(data.avatars),
  },
  "gifs": {
    lede: "GIF submissions for the shared library.",
    load: () => api("/api/admin/gifs"),
    build: (data) => createGifQueue(data.gifs),
  },
  "css": {
    lede: "Custom profile CSS awaiting review. Approved themes serve scoped and sandboxed.",
    load: () => api("/api/admin/css"),
    build: (data) => createCssQueue(data.cssSubmissions),
  },
  "hidden": {
    lede: "Hidden posts and everything by actively banned members, bodies included.",
    load: () => api("/api/admin/hidden"),
    build: (data) => createHiddenPostsQueue(data.hidden),
  },
  "bans": {
    lede: "Active bans with unban forms, plus member search to act on anyone directly.",
    load: () => api("/api/admin/bans"),
    build: (data) => [
      createActiveBanList(data.bans),
      createMemberSearch(),
    ],
  },
  "chat-log": {
    lede: "The full public chat stream — banned authors included, deletable in place.",
    load: () => api("/api/admin/chat"),
    build: (data) => createChatLog(data.messages, document),
  },
  "dm-log": {
    lede: "The full 1:1 stream with both participants named — same scrutiny as the chat.",
    load: () => api("/api/admin/dms"),
    build: (data) => createDmLog(data.messages, document),
  },
  "rules": {
    lede: "The site copy every /rules visitor reads — markdown subset, word-filtered.",
    load: () => api("/api/rules"),
    build: (data) => createRulesEditor(data.rules),
  },
  "filter": {
    lede: "The word filter — edit the full list, or bulk-add pasted entries (duplicates skip).",
    load: () => api("/api/admin/filter"),
    build: (data) => createFilterEditor(data),
  },
};

async function renderAdminRoute(route, context, version) {
  const user = context.session.user;
  const staff = Boolean(user && (user.role === "owner" || user.role === "admin"));
  if (!staff) {
    addHeading(main, "Moderation desk", 1);
    addText(main, "Only staff can use the desk.", "muted");
    return;
  }
  const slug = DESK_BUILDERS[route.section] ? route.section : "dashboard";
  const content = renderAdminShell(user, slug);
  if (slug !== "dashboard") {
    const section = DESK_BUILDERS[slug];
    const data = await section.load();
    if (version !== state.renderVersion) return;
    addHeading(content, DESK_SECTIONS.find((s) => s.slug === slug).label, 1);
    addText(content, section.lede, "page-lede");
    const body = section.build(data, user);
    for (const node of Array.isArray(body) ? body : [body]) {
      node && content.append(node);
    }
    return;
  }
  // Dashboard: count every work queue and surface what actually needs eyes —
  // status cards first, then the queue tiles.
  const [reports, appeals, attachments, avatars, gifs, css, profileReports, hidden] = await Promise.all([
    api("/api/admin/reports"),
    api("/api/admin/appeals"),
    api("/api/admin/attachments"),
    api("/api/admin/avatars"),
    api("/api/admin/gifs"),
    api("/api/admin/css"),
    api("/api/admin/profile-reports"),
    api("/api/admin/hidden"),
  ]);
  if (version !== state.renderVersion) return;
  addHeading(content, "Overview", 1);
  addText(content,
    "Everything the desk watches, one glance: the queues with work show their counts. " +
    "Open a section from the rail to work it.", "page-lede");
  const counts = {
    "reports": reports.reports.length,
    "appeals": appeals.appeals.filter((a) => a.status === "pending").length,
    "images": attachments.attachments.length,
    "avatars": avatars.avatars.length,
    "gifs": gifs.gifs.length,
    "css": css.cssSubmissions.length,
    "profile-reports": profileReports.profileReports.length,
    "hidden": hidden.hidden.length,
  };
  content.append(createDashboardBoard(
    DESK_SECTIONS
      .filter((s) => s.slug !== "dashboard" && DESK_BUILDERS[s.slug])
      .map((s) => ({ slug: s.slug, label: s.label, count: counts[s.slug] })),
    document,
  ));
}

// The desk shell: sidebar rail + content column; the column is returned so
// each section renders INTO it (headings included).
function renderAdminShell(user, activeSlug) {
  const shell = el("div", { class: "desk-shell" });
  const nav = el("nav", { class: "desk-nav", "aria-label": "Moderation desk sections" });
  nav.append(el("p", { class: "desk-signin", text: "Signed in as " + user.username }));
  const list = el("ul", { class: "desk-nav-list" });
  for (const section of DESK_SECTIONS) {
    const item = el("li");
    item.append(el("a", {
      class: "desk-nav-link" + (section.slug === activeSlug ? " desk-nav-active" : ""),
      href: section.slug === "dashboard" ? "/admin" : "/admin/" + section.slug,
      "data-app-link": "",
      "aria-current": section.slug === activeSlug ? "page" : undefined,
      text: section.label,
    }));
    list.append(item);
  }
  nav.append(list);
  const content = el("div", { class: "desk-content" });
  shell.append(nav, content);
  main.append(shell);
  return content;
}

function createDashboardBoard(tiles) {
  const board = el("div");
  const tilesHost = el("div", { class: "desk-tiles" });
  for (const tile of tiles) {
    if (tile.count === null || tile.count === undefined) continue;
    const link = el("a", {
      class: "desk-tile" + (tile.count > 0 ? " desk-tile-waiting" : ""),
      href: "/admin/" + tile.slug,
      "data-app-link": "",
    });
    link.append(
      el("span", { class: "desk-tile-count", text: String(tile.count) }),
      el("span", { class: "desk-tile-label", text: tile.label }),
    );
    tilesHost.append(link);
  }
  board.append(tilesHost);
  return board;
}

function createProfileReportQueue(reports) {
  const container = el("div", { class: "profile-report-queue" });
  if (!reports.length) {
    addText(container, "No profile reports.", "empty-state");
    return container;
  }
  for (const report of reports) {
    const item = el("div", { class: "report-queue-item" });
    const head = el("p", {
      class: "report-queue-head",
      text: report.profileUsername + " (reported by " + report.reporter + ")",
    });
    const reason = el("p", { class: "report-queue-reason", text: report.reason });
    const resolve = el("button", { class: "button", text: "Resolve", type: "button" });
    resolve.dataset.action = "resolve-profile-report";
    resolve.dataset.reportId = String(report.id);
    const visit = el("a", {
      class: "button button-quiet",
      text: "View profile",
      href: "/users/" + encodeURIComponent(report.profileUsername),
      "data-app-link": "",
    });
    // Ban affordance (v3.0.2): a profile report used to be resolve-only —
    // the same admin-ban form as the post-report queue (reason + duration)
    // lets the mod act on the reported member right here. The generic
    // data-form="admin-ban" submit handler picks it up unchanged.
    item.append(head, reason, resolve, visit, createBanForm(report.profileUserId, report.profileUsername));
    container.append(item);
  }
  return container;
}

function createHiddenPostsQueue(items) {
  const container = el("div", { class: "hidden-posts-queue" });
  if (!items.length) {
    addText(container, "Nothing hidden right now.", "empty-state");
    return container;
  }
  for (const item of items) {
    const card = el("div", { class: "hidden-post-item" });
    const head = el("p", {
      class: "hidden-post-head",
      text: item.author.username + " — " +
        (item.banReason ? "ban: " + item.banReason : "hidden post") +
        (item.banExpiresAt ? " (until " + new Date(item.banExpiresAt).toLocaleString() + ")" : " (permanent)"),
    });
    const body = el("p", { class: "hidden-post-body", text: item.body });
    const when = el("p", { class: "hidden-post-when", text: new Date(item.createdAt).toLocaleString() });
    const link = el("a", {
      class: "button button-quiet",
      text: item.threadId === item.id ? "Open post" : "Open thread",
      href: "/posts/" + item.threadId,
      "data-app-link": "",
    });
    card.append(head, body, when, link);
    container.append(card);
  }
  return container;
}

function createRulesEditor(rulesData) {
  const container = el("div", { class: "rules-editor" });
  const label = el("p", { class: "accent-picker-label", text: "Forum rules (markdown — the subset bodies use)" });
  const textarea = el("textarea", { class: "css-editor-input", id: "rules-input", rows: 10, maxLength: 1000000 });
  textarea.value = typeof rulesData.rules === "string" ? rulesData.rules : "";
  const save = el("button", { class: "button", text: "Save rules", type: "button" });
  save.dataset.action = "save-forum-rules";
  container.append(label, textarea, save);
  return container;
}

function createCssQueue(submissions) {
  const container = el("div", { class: "css-queue" });
  if (!submissions.length) {
    addText(container, "No CSS waiting for review.", "empty-state");
    return container;
  }
  for (const submission of submissions) {
    const item = el("div", { class: "css-queue-item" });
    const head = el("p", {
      class: "css-queue-head",
      text: submission.username + " — " + submission.bytes + " chars",
    });
    const preview = el("pre", { class: "css-queue-preview", text: submission.css });
    const approve = el("button", { class: "button", text: "Approve", type: "button" });
    approve.dataset.action = "css-approve";
    approve.dataset.userId = String(submission.userId);
    approve.dataset.version = String(submission.version || "");
    const reject = el("button", { class: "button button-quiet", text: "Reject", type: "button" });
    reject.dataset.action = "css-reject";
    reject.dataset.userId = String(submission.userId);
    reject.dataset.version = String(submission.version || "");
    item.append(head, preview, approve, reject);
    container.append(item);
  }
  return container;
}

// Member search (v3.1): fetch and render into the section's results node.
async function submitMemberSearch(form, text) {
  const data = await api("/api/admin/users/search?q=" + encodeURIComponent(text("q").trim()));
  const results = form.parentElement?.querySelector("[data-member-search-results]");
  results?.replaceChildren(renderMemberSearchResults(data.members));
}

async function submitReportResolution(form) {
  await api("/api/admin/reports/" + form.dataset.reportId + "/resolve", {
    method: "POST",
    body: { action: form.dataset.action },
  });
  await state.renderRoute({ name: "admin" });
  setMessage("The report was updated.");
}

async function submitBanForm(form, text) {
  // Timed bans (v3.0.2): the optional duration select carries hours; 0 or
  // absent = permanent. Hours become an absolute epoch-seconds expiresAt —
  // the server re-validates the window (a minute to a year out).
  const durationSelect = form.querySelector("select[name=\"duration\"]");
  const hours = Number(durationSelect && durationSelect.value) || 0;
  const body = { reason: text("reason") };
  if (hours > 0) body.expiresAt = Math.floor(Date.now() / 1000) + hours * 3600;
  // IP bans (v3.1): the opt-in checkbox rides the same request.
  if (text("ipBan") === "on") body.ipBan = true;
  await api("/api/admin/users/" + form.dataset.userId + "/bans", {
    method: "POST",
    body,
  });
  await state.renderRoute({ name: "admin" });
  setMessage(hours > 0
    ? "The user was banned and their sessions revoked. Their account reactivates when the ban expires."
    : "The user was banned and their sessions revoked.");
}

async function submitUnbanForm(form, text) {
  await api("/api/admin/users/" + form.dataset.userId + "/bans", {
    method: "DELETE",
    body: { reason: text("reason") },
  });
  await state.renderRoute({ name: "admin" });
  setMessage("The ban was lifted.");
}

async function submitRoleChange(form, action, text) {
  const reason = text("reason").trim();
  await api("/api/admin/users/" + form.dataset.userId + "/" + action, {
    method: "POST",
    body: reason ? { reason } : {},
  });
  // Role-change forms live on the moderation desk and on member profiles;
  // re-rendering the current route refreshes whichever surface is showing.
  await state.renderRoute(state.activeRoute);
  setMessage(action === "promote"
    ? "The member was promoted to mod."
    : "The member was demoted to member.");
}

async function submitAvatarModeration(form, action) {
  await api("/api/admin/avatars/" + form.dataset.userId + "/" + action, {
    method: "POST",
    // pendingVersion (CAS): the server approves only the exact upload the
    // queue showed; a 409 means the member replaced it — rerender re-fetches.
    body: form.dataset.pendingVersion ? { pendingVersion: form.dataset.pendingVersion } : {},
  });
  await state.renderRoute({ name: "admin" });
  setMessage(action === "approve" ? "The avatar was approved." : "The avatar was rejected.");
}

// Attachment rows are per-post ids, not replaceable profile pairs, and an
// unknown/stale id 404s (never "already handled") — same rerender-and-report
// flow as the avatar desk above.
async function submitAttachmentModeration(form, action) {
  await api("/api/admin/attachments/" + form.dataset.attachmentId + "/" + action, {
    method: "POST",
  });
  await state.renderRoute({ name: "admin" });
  setMessage(action === "approve" ? "The image was approved." : "The image was rejected.");
}
export const FORM_HANDLERS = {
  "admin-resolve": (form) => submitReportResolution(form),
  "admin-ban": (form, text) => submitBanForm(form, text),
  "admin-unban": (form, text) => submitUnbanForm(form, text),
  "admin-promote": (form, text) => submitRoleChange(form, "promote", text),
  "admin-demote": (form, text) => submitRoleChange(form, "demote", text),
  "admin-avatar-approve": (form) => submitAvatarModeration(form, "approve"),
  "admin-avatar-reject": (form) => submitAvatarModeration(form, "reject"),
  "admin-attachment-approve": (form) => submitAttachmentModeration(form, "approve"),
  "admin-attachment-reject": (form) => submitAttachmentModeration(form, "reject"),
  "admin-member-search": (form, text) => submitMemberSearch(form, text),
  "filter-save": async (form, text) => submitFilterSave(form, text),
  "filter-bulk-add": async (form, text) => submitFilterBulkAdd(form, text),
};

// Filter store (v4.3): the desk's two writes. Save replaces the whole list
// (an empty list turns the filter off deliberately); bulk add appends and
// dedupes server-side, and the report counts both directions.
async function submitFilterSave(form, text) {
  await api("/api/admin/filter", { method: "PUT", body: { words: text("words") } });
  await state.renderRoute(state.activeRoute);
  setMessage("The filter list was saved.");
}

async function submitFilterBulkAdd(form, text) {
  const data = await api("/api/admin/filter/entries", {
    method: "POST",
    body: { entries: text("entries") },
  });
  await state.renderRoute(state.activeRoute);
  setMessage(
    data.added + (data.added === 1 ? " entry added" : " entries added") +
    (data.skipped ? " · " + data.skipped + (data.skipped === 1 ? " duplicate skipped." : " duplicates skipped.") : "."),
  );
}

export const ACTIONS = {
    // Pinned (C5): the mod desk's pin/unpin — POST to the admin route and
    // re-render; the payload's pinnedAt decides which control each card shows.
    "thread-pin": async (button) => {
      await api("/api/admin/threads/" + button.dataset.postId + "/pin", { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage("Thread pinned.");
    },
    "thread-unpin": async (button) => {
      await api("/api/admin/threads/" + button.dataset.postId + "/unpin", { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage("Thread unpinned.");
    },
    "gif-approve": async (button) => {
      await api("/api/admin/gifs/" + encodeURIComponent(button.dataset.gifId) + "/approve", { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage("GIF approved and added to the public library.");
    },
    "gif-reject": async (button) => {
      await api("/api/admin/gifs/" + encodeURIComponent(button.dataset.gifId) + "/reject", { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage("GIF submission rejected.");
    },
    "resolve-profile-report": async (button) => {
      await api("/api/admin/profile-reports/" + encodeURIComponent(button.dataset.reportId) + "/resolve", { method: "POST" });
      button.closest(".report-queue-item")?.remove();
      setMessage("Report resolved.");
    },
    "css-approve": async (button) => {
      const version = encodeURIComponent(button.dataset.version || "");
      await api("/api/admin/css/" + encodeURIComponent(button.dataset.userId) + "/approve?version=" + version, { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage("CSS approved.");
    },
    "css-reject": async (button) => {
      const version = encodeURIComponent(button.dataset.version || "");
      await api("/api/admin/css/" + encodeURIComponent(button.dataset.userId) + "/reject?version=" + version, { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage("CSS rejected.");
    },
    // The desk's chat/DM log cleanup buttons (the site's chat page and DM
    // panel retired to GooberCord — the logs and their in-place deletes
    // stay). Both rows carry the id on chatMessageId; the routes differ.
    "chat-delete": async (button) => {
      await api("/api/chat/" + encodeURIComponent(button.dataset.chatMessageId), { method: "DELETE" });
      button.closest("[data-chat-message-id]")?.remove();
      setMessage("Chat message deleted.");
    },
    "dm-delete": async (button) => {
      await api("/api/dm-messages/" + encodeURIComponent(button.dataset.chatMessageId), { method: "DELETE" });
      button.closest("[data-dm-message-id]")?.remove();
      setMessage("DM message deleted.");
    },
};

export { renderAdminRoute };
