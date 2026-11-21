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
// reports — imported below.
import { api } from "../api.js";
import { addHeading, element, main, setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import { currentLocale, t, tn } from "../i18n.js";
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
import { createMemberPeek } from "../desk/member-tools.js";
import { createFilterEditor } from "../desk/filter.js";

// The desk (v4.2 redesign): /admin is a section-routed panel — a sidebar rail
// of dedicated pages (each loading exactly one desk payload) plus a dashboard
// overview that counts every queue and shows what actually needs staff eyes.
// The old single page stacked all fourteen payloads fetch-at-once; sections
// keep the same endpoint surface, just one fetch per visit.
const DESK_SECTIONS = [
  { slug: "dashboard", labelKey: "admin.section.dashboard" },
  { slug: "reports", labelKey: "admin.section.reports" },
  { slug: "profile-reports", labelKey: "admin.section.profileReports" },
  { slug: "appeals", labelKey: "admin.section.appeals" },
  { slug: "images", labelKey: "admin.section.images" },
  { slug: "avatars", labelKey: "admin.section.avatars" },
  { slug: "gifs", labelKey: "admin.section.gifs" },
  { slug: "css", labelKey: "admin.section.css" },
  { slug: "hidden", labelKey: "admin.section.hidden" },
  { slug: "bans", labelKey: "admin.section.bans" },
  { slug: "chat-log", labelKey: "admin.section.chatLog" },
  { slug: "dm-log", labelKey: "admin.section.dmLog" },
  { slug: "rules", labelKey: "admin.section.rules" },
  { slug: "filter", labelKey: "admin.section.filter" },
];

// slug → { lede, load(), build() }. Every build() appends the section's body
// to `main` after the shell; each loads only what it renders.
const DESK_BUILDERS = {
  "reports": {
    ledeKey: "admin.lede.reports",
    load: () => api("/api/admin/reports"),
    build: (data, user) => createReportQueue(data.reports, document, user),
  },
  "profile-reports": {
    ledeKey: "admin.lede.profileReports",
    load: () => api("/api/admin/profile-reports"),
    build: (data) => createProfileReportQueue(data.profileReports, document),
  },
  "appeals": {
    ledeKey: "admin.lede.appeals",
    load: () => api("/api/admin/appeals"),
    build: (data) => createAppealQueue(data.appeals, document),
  },
  "images": {
    ledeKey: "admin.lede.images",
    load: () => api("/api/admin/attachments"),
    build: (data) => createAttachmentQueue(data.attachments, document),
  },
  "avatars": {
    ledeKey: "admin.lede.avatars",
    load: () => api("/api/admin/avatars"),
    build: (data) => createAvatarQueue(data.avatars, document),
  },
  "gifs": {
    ledeKey: "admin.lede.gifs",
    load: () => api("/api/admin/gifs"),
    build: (data) => createGifQueue(data.gifs, document),
  },
  "css": {
    ledeKey: "admin.lede.css",
    load: () => api("/api/admin/css"),
    build: (data) => createCssQueue(data.cssSubmissions, document),
  },
  "hidden": {
    ledeKey: "admin.lede.hidden",
    load: () => api("/api/admin/hidden"),
    build: (data) => createHiddenPostsQueue(data.hidden, document),
  },
  "bans": {
    ledeKey: "admin.lede.bans",
    load: () => api("/api/admin/bans"),
    build: (data, user) => [
      createActiveBanList(data.bans, document),
      createMemberSearch(document),
    ],
  },
  "chat-log": {
    ledeKey: "admin.lede.chatLog",
    load: () => api("/api/admin/chat"),
    build: (data) => createChatLog(data.messages, document),
  },
  "dm-log": {
    ledeKey: "admin.lede.dmLog",
    load: () => api("/api/admin/dms"),
    build: (data) => createDmLog(data.messages, document),
  },
  "rules": {
    ledeKey: "admin.lede.rules",
    load: () => api("/api/rules"),
    build: (data) => createRulesEditor(data.rules, document),
  },
  "filter": {
    ledeKey: "admin.lede.filter",
    load: () => api("/api/admin/filter"),
    build: (data) => createFilterEditor(data, document),
  },
};

async function renderAdminRoute(route, context, version) {
  const user = context.session.user;
  const staff = Boolean(user && (user.role === "owner" || user.role === "admin"));
  if (!staff) {
    addHeading(main, t("admin.staffOnlyTitle"), 1);
    addText(document, main, "p", t("admin.staffOnly"), "muted");
    return;
  }
  const slug = DESK_BUILDERS[route.section] ? route.section : "dashboard";
  const content = renderAdminShell(user, slug);
  if (slug !== "dashboard") {
    const section = DESK_BUILDERS[slug];
    const data = await section.load();
    if (version !== state.renderVersion) return;
    addHeading(content, t(DESK_SECTIONS.find((s) => s.slug === slug).labelKey), 1);
    addText(document, content, "p", t(section.ledeKey), "page-lede");
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
  addHeading(content, t("admin.section.dashboard"), 1);
  addText(document, content, "p",
    t("admin.overviewLede"), "page-lede");
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
      .map((s) => ({ slug: s.slug, label: t(s.labelKey), count: counts[s.slug] })),
    document,
  ));
}

// The desk shell: sidebar rail + content column; the column is returned so
// each section renders INTO it (headings included).
function renderAdminShell(user, activeSlug) {
  const shell = document.createElement("div");
  shell.className = "desk-shell";
  const nav = document.createElement("nav");
  nav.className = "desk-nav";
  nav.setAttribute("aria-label", t("admin.navLabel"));
  const name = document.createElement("p");
  name.className = "desk-signin";
  name.textContent = t("admin.signedInAs", { username: user.username });
  nav.append(name);
  const list = document.createElement("ul");
  list.className = "desk-nav-list";
  for (const section of DESK_SECTIONS) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "desk-nav-link" + (section.slug === activeSlug ? " desk-nav-active" : "");
    link.href = section.slug === "dashboard" ? "/admin" : "/admin/" + section.slug;
    link.setAttribute("data-app-link", "");
    if (section.slug === activeSlug) link.setAttribute("aria-current", "page");
    link.textContent = t(section.labelKey);
    item.append(link);
    list.append(item);
  }
  nav.append(list);
  const content = document.createElement("div");
  content.className = "desk-content";
  shell.append(nav, content);
  main.append(shell);
  return content;
}

function createDashboardBoard(tiles, document) {
  const board = document.createElement("div");
  const tilesHost = document.createElement("div");
  tilesHost.className = "desk-tiles";
  for (const tile of tiles) {
    if (tile.count === null || tile.count === undefined) continue;
    const link = document.createElement("a");
    link.className = "desk-tile" + (tile.count > 0 ? " desk-tile-waiting" : "");
    link.href = "/admin/" + tile.slug;
    link.setAttribute("data-app-link", "");
    const count = document.createElement("span");
    count.className = "desk-tile-count";
    count.textContent = String(tile.count);
    const label = document.createElement("span");
    label.className = "desk-tile-label";
    label.textContent = tile.label;
    link.append(count, label);
    tilesHost.append(link);
  }
  board.append(tilesHost);
  return board;
}

function createProfileReportQueue(reports, document) {
  const container = element("div", "profile-report-queue");
  if (!reports.length) {
    addText(document, container, "p", t("admin.noProfileReports"), "empty-state");
    return container;
  }
  for (const report of reports) {
    const item = element("div", "report-queue-item");
    const head = element("p", "report-queue-head",
      t("admin.profileReportHead", { profile: report.profileUsername, reporter: report.reporter }));
    const reason = element("p", "report-queue-reason");
    reason.textContent = report.reason;
    const resolve = element("button", "button", t("admin.resolve"));
    resolve.type = "button";
    resolve.dataset.action = "resolve-profile-report";
    resolve.dataset.reportId = String(report.id);
    const visit = element("a", "button button-quiet", t("admin.viewProfile"));
    visit.href = "/users/" + encodeURIComponent(report.profileUsername);
    visit.setAttribute("data-app-link", "");
    // Ban affordance (v3.0.2): a profile report used to be resolve-only —
    // the same admin-ban form as the post-report queue (reason + duration)
    // lets the mod act on the reported member right here. The generic
    // data-form="admin-ban" submit handler picks it up unchanged.
    item.append(head, reason, resolve, visit, createBanForm(document, report.profileUserId, report.profileUsername));
    container.append(item);
  }
  return container;
}

// Hidden-post card head: author — ban reason or "hidden post" — expiry.
function hiddenHeadText(item) {
  const vars = {
    author: item.author.username,
    reason: item.banReason,
    when: item.banExpiresAt ? new Date(item.banExpiresAt).toLocaleString(currentLocale()) : "",
  };
  if (item.banReason) {
    return item.banExpiresAt ? t("admin.hiddenBanUntil", vars) : t("admin.hiddenBanPermanent", vars);
  }
  return item.banExpiresAt ? t("admin.hiddenPostUntil", vars) : t("admin.hiddenPostPermanent", vars);
}

function createHiddenPostsQueue(items, document) {
  const container = element("div", "hidden-posts-queue");
  if (!items.length) {
    addText(document, container, "p", t("admin.nothingHidden"), "empty-state");
    return container;
  }
  for (const item of items) {
    const card = element("div", "hidden-post-item");
    const head = element("p", "hidden-post-head",
      hiddenHeadText(item));
    const body = element("p", "hidden-post-body");
    body.textContent = item.body;
    const when = element("p", "hidden-post-when", new Date(item.createdAt).toLocaleString(currentLocale()));
    const link = element("a", "button button-quiet", item.threadId === item.id ? t("admin.openPost") : t("admin.openThread"));
    link.href = "/posts/" + item.threadId;
    link.setAttribute("data-app-link", "");
    card.append(head, body, when, link);
    // Wave 2026-11-21-9: moderator-hidden posts can be restored in place
    // (banned-author rows return on unban; staged uploads publish themselves).
    if (item.visibility === "hidden" && !item.staged) {
      const restore = element("button", "button", t("admin.restore"));
      restore.type = "button";
      restore.dataset.action = "post-restore";
      restore.dataset.postId = String(item.id);
      card.append(restore);
    }
    container.append(card);
  }
  return container;
}

function createRulesEditor(rulesData, document) {
  const container = element("div", "rules-editor");
  const label = element("p", "accent-picker-label", t("admin.rulesLabel"));
  const textarea = element("textarea", "css-editor-input");
  textarea.id = "rules-input";
  textarea.rows = 10;
  textarea.maxLength = 1000000;
  textarea.value = typeof rulesData.rules === "string" ? rulesData.rules : "";
  const save = element("button", "button", t("admin.saveRules"));
  save.type = "button";
  save.dataset.action = "save-forum-rules";
  container.append(label, textarea, save);
  return container;
}

function createCssQueue(submissions, document) {
  const container = element("div", "css-queue");
  if (!submissions.length) {
    addText(document, container, "p", t("admin.noCss"), "empty-state");
    return container;
  }
  for (const submission of submissions) {
    const item = element("div", "css-queue-item");
    const head = element("p", "css-queue-head", t("admin.cssHead", { username: submission.username, bytes: submission.bytes }));
    const preview = element("pre", "css-queue-preview");
    preview.textContent = submission.css;
    const approve = element("button", "button", t("admin.approve"));
    approve.type = "button";
    approve.dataset.action = "css-approve";
    approve.dataset.userId = String(submission.userId);
    approve.dataset.version = String(submission.version || "");
    const reject = element("button", "button button-quiet", t("admin.reject"));
    reject.type = "button";
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
  results?.replaceChildren(renderMemberSearchResults(data.members, document));
}

async function submitReportResolution(form) {
  await api("/api/admin/reports/" + form.dataset.reportId + "/resolve", {
    method: "POST",
    body: { action: form.dataset.action },
  });
  await state.renderRoute({ name: "admin" });
  setMessage(t("admin.msg.reportUpdated"));
}

// Hide a spam run (wave 2026-11-21-9): destructive, so it confirms first;
// every hidden post can be restored from the Hidden posts page.
async function submitHideRecent(form, text) {
  const count = Number(text("count"));
  if (!window.confirm(tn("desk.hideRecent.confirm", count, { username: form.dataset.username }))) return;
  const data = await api("/api/admin/users/" + form.dataset.userId + "/hide-recent", {
    method: "POST",
    body: { count },
  });
  await state.renderRoute(state.activeRoute);
  setMessage(tn("admin.msg.hidRecent", data.hidden));
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
    ? t("admin.msg.bannedTimed")
    : t("admin.msg.banned"));
}

async function submitUnbanForm(form, text) {
  await api("/api/admin/users/" + form.dataset.userId + "/bans", {
    method: "DELETE",
    body: { reason: text("reason") },
  });
  await state.renderRoute({ name: "admin" });
  setMessage(t("admin.msg.unbanned"));
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
    ? t("admin.msg.promoted")
    : t("admin.msg.demoted"));
}

async function submitAvatarModeration(form, action) {
  await api("/api/admin/avatars/" + form.dataset.userId + "/" + action, {
    method: "POST",
    // pendingVersion (CAS): the server approves only the exact upload the
    // queue showed; a 409 means the member replaced it — rerender re-fetches.
    body: form.dataset.pendingVersion ? { pendingVersion: form.dataset.pendingVersion } : {},
  });
  await state.renderRoute({ name: "admin" });
  setMessage(action === "approve" ? t("admin.msg.avatarApproved") : t("admin.msg.avatarRejected"));
}

// Attachment rows are per-post ids, not replaceable profile pairs, and an
// unknown/stale id 404s (never "already handled") — same rerender-and-report
// flow as the avatar desk above.
async function submitAttachmentModeration(form, action) {
  await api("/api/admin/attachments/" + form.dataset.attachmentId + "/" + action, {
    method: "POST",
  });
  await state.renderRoute({ name: "admin" });
  setMessage(action === "approve" ? t("admin.msg.imageApproved") : t("admin.msg.imageRejected"));
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
  "admin-hide-recent": (form, text) => submitHideRecent(form, text),
  "filter-save": async (form, text) => submitFilterSave(form, text),
  "filter-bulk-add": async (form, text) => submitFilterBulkAdd(form, text),
};

// Filter store (v4.3): the desk's two writes. Save replaces the whole list
// (an empty list turns the filter off deliberately); bulk add appends and
// dedupes server-side, and the report counts both directions.
async function submitFilterSave(form, text) {
  await api("/api/admin/filter", { method: "PUT", body: { words: text("words") } });
  await state.renderRoute(state.activeRoute);
  setMessage(t("admin.msg.filterSaved"));
}

async function submitFilterBulkAdd(form, text) {
  const data = await api("/api/admin/filter/entries", {
    method: "POST",
    body: { entries: text("entries") },
  });
  await state.renderRoute(state.activeRoute);
  setMessage(
    tn("admin.msg.filterAdded", data.added) +
    (data.skipped ? tn("admin.msg.filterSkipped", data.skipped) : "."),
  );
}

// Recent-activity peek (wave 2026-11-21-9): loads once into the card's region,
// then the toggle only shows/hides it.
async function toggleMemberPeek(button) {
  const region = document.getElementById(button.getAttribute("aria-controls"));
  if (!region) return;
  const opening = button.getAttribute("aria-expanded") !== "true";
  if (opening && !region.childElementCount) {
    const data = await api("/api/admin/users/" + encodeURIComponent(button.dataset.userId) + "/recent-posts");
    region.replaceChildren(createMemberPeek(document, data));
  }
  region.hidden = !opening;
  button.setAttribute("aria-expanded", String(opening));
  button.textContent = t(opening ? "desk.peek.hide" : "desk.peek.show");
}

export const ACTIONS = {
    "member-peek": (button) => toggleMemberPeek(button),
    "post-restore": async (button) => {
      const data = await api("/api/admin/posts/unhide", { method: "POST", body: { ids: [Number(button.dataset.postId)] } });
      await state.renderRoute(state.activeRoute);
      setMessage(tn("admin.msg.restored", data.restored));
    },
    // Pinned (C5): the mod desk's pin/unpin — POST to the admin route and
    // re-render; the payload's pinnedAt decides which control each card shows.
    "thread-pin": async (button) => {
      await api("/api/admin/threads/" + button.dataset.postId + "/pin", { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage(t("admin.msg.threadPinned"));
    },
    "thread-unpin": async (button) => {
      await api("/api/admin/threads/" + button.dataset.postId + "/unpin", { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage(t("admin.msg.threadUnpinned"));
    },
    "gif-approve": async (button) => {
      await api("/api/admin/gifs/" + encodeURIComponent(button.dataset.gifId) + "/approve", { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage(t("admin.msg.gifApproved"));
    },
    "gif-reject": async (button) => {
      await api("/api/admin/gifs/" + encodeURIComponent(button.dataset.gifId) + "/reject", { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage(t("admin.msg.gifRejected"));
    },
    "resolve-profile-report": async (button) => {
      await api("/api/admin/profile-reports/" + encodeURIComponent(button.dataset.reportId) + "/resolve", { method: "POST" });
      button.closest(".report-queue-item")?.remove();
      setMessage(t("admin.msg.reportResolved"));
    },
    "css-approve": async (button) => {
      const version = encodeURIComponent(button.dataset.version || "");
      await api("/api/admin/css/" + encodeURIComponent(button.dataset.userId) + "/approve?version=" + version, { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage(t("admin.msg.cssApproved"));
    },
    "css-reject": async (button) => {
      const version = encodeURIComponent(button.dataset.version || "");
      await api("/api/admin/css/" + encodeURIComponent(button.dataset.userId) + "/reject?version=" + version, { method: "POST" });
      await state.renderRoute(state.activeRoute);
      setMessage(t("admin.msg.cssRejected"));
    },
    // The desk's chat/DM log cleanup buttons (the site's chat page and DM
    // panel retired — the logs and their in-place deletes
    // stay). Both rows carry the id on chatMessageId; the routes differ.
    "chat-delete": async (button) => {
      await api("/api/chat/" + encodeURIComponent(button.dataset.chatMessageId), { method: "DELETE" });
      button.closest("[data-chat-message-id]")?.remove();
      setMessage(t("admin.msg.chatDeleted"));
    },
    "dm-delete": async (button) => {
      await api("/api/dm-messages/" + encodeURIComponent(button.dataset.chatMessageId), { method: "DELETE" });
      button.closest("[data-dm-message-id]")?.remove();
      setMessage(t("admin.msg.dmDeleted"));
    },
};

export { renderAdminRoute };
