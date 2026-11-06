// v4.0 plan 4 Task 8: the moderation desk — the /admin route and its fourteen
// payloads, the desk section builders that live inside app.js's renderAdmin
// (profile-report queue, hidden posts queue, rules editor, CSS queue), and the
// desk submits (resolve, ban/unban, role changes, avatar/attachment
// moderation, member search). Bodies moved verbatim out of app.js; bare
// renderRoute calls inside moved bodies re-read the boot state
// (state.renderRoute). The queue/form section builders moved to the desk/
// modules in plan 6 (spec step 6): automod, appeals, bans, chat-log, media,
// reports — imported below.
import { api } from "../api.js";
import { addHeading, element, main, setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import { createAppealQueue } from "../desk/appeals.js";
import {
  createActiveBanList,
  createBanForm,
  createMemberSearch,
  renderMemberSearchResults,
} from "../desk/bans.js";
import { createChatLog, createDmLog } from "../desk/chat-log.js";
import { createTextModSection, createVisionSection } from "../desk/automod.js";
import {
  createAttachmentQueue,
  createAvatarQueue,
  createGifQueue,
} from "../desk/media.js";
import { createReportQueue } from "../desk/reports.js";

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
  { slug: "automod", label: "Auto-mod" },
  { slug: "chat-log", label: "Chat log" },
  { slug: "dm-log", label: "DM log" },
  { slug: "rules", label: "Rules" },
];

// slug → { lede, load(), build() }. Every build() appends the section's body
// to `main` after the shell; each loads only what it renders.
const DESK_BUILDERS = {
  "reports": {
    lede: "Open post reports, newest first — resolve, ban, or dismiss.",
    load: () => api("/api/admin/reports"),
    build: (data, user) => createReportQueue(data.reports, document, user),
  },
  "profile-reports": {
    lede: "Reported profiles — resolve, view, or ban the reported member.",
    load: () => api("/api/admin/profile-reports"),
    build: (data) => createProfileReportQueue(data.profileReports, document),
  },
  "appeals": {
    lede: "Second looks at auto-mod removals and bans. Approve or deny — approval always notifies the member.",
    load: () => api("/api/admin/appeals"),
    build: (data) => createAppealQueue(data.appeals, document),
  },
  "images": {
    lede: "Attachments awaiting review. Author sees their own pending images; approve makes them public.",
    load: () => api("/api/admin/attachments"),
    build: (data) => createAttachmentQueue(data.attachments, document),
  },
  "avatars": {
    lede: "Avatar uploads awaiting review. The previous avatar keeps serving until you decide.",
    load: () => api("/api/admin/avatars"),
    build: (data) => createAvatarQueue(data.avatars, document),
  },
  "gifs": {
    lede: "GIF submissions for the shared library.",
    load: () => api("/api/admin/gifs"),
    build: (data) => createGifQueue(data.gifs, document),
  },
  "css": {
    lede: "Custom profile CSS awaiting review. Approved themes serve scoped and sandboxed.",
    load: () => api("/api/admin/css"),
    build: (data) => createCssQueue(data.cssSubmissions, document),
  },
  "hidden": {
    lede: "Hidden posts and everything by actively banned members, bodies included.",
    load: () => api("/api/admin/hidden"),
    build: (data) => createHiddenPostsQueue(data.hidden, document),
  },
  "bans": {
    lede: "Active bans with unban forms, plus member search to act on anyone directly.",
    load: () => api("/api/admin/bans"),
    build: (data, user) => [
      createActiveBanList(data.bans, document),
      createMemberSearch(document),
    ],
  },
  "automod": {
    lede: "Both auto-mod subsystems live here: Vision for pixels, OpenAI for text. Each has its own kill switch, independent of the API keys.",
    load: async () => [await api("/api/admin/vision"), await api("/api/admin/text-mod")],
    build: ([visionData, textModData], user) => [
      createVisionSection(visionData, document),
      createTextModSection(textModData, document),
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
    build: (data) => createRulesEditor(data.rules, document),
  },
};

async function renderAdminRoute(route, context, version) {
  const user = context.session.user;
  const staff = Boolean(user && (user.role === "owner" || user.role === "admin"));
  if (!staff) {
    addHeading(main, "Moderation desk", 1);
    addText(document, main, "p", "Only staff can use the desk.", "muted");
    return;
  }
  const slug = DESK_BUILDERS[route.section] ? route.section : "dashboard";
  const content = renderAdminShell(user, slug);
  if (slug !== "dashboard") {
    const section = DESK_BUILDERS[slug];
    const data = await section.load();
    if (version !== state.renderVersion) return;
    addHeading(content, DESK_SECTIONS.find((s) => s.slug === slug).label, 1);
    addText(document, content, "p", section.lede, "page-lede");
    const body = section.build(data, user);
    for (const node of Array.isArray(body) ? body : [body]) {
      node && content.append(node);
    }
    return;
  }
  // Dashboard: count every work queue and surface what actually needs eyes —
  // status cards first, then the queue tiles.
  const [reports, appeals, attachments, avatars, gifs, css, profileReports, hidden, vision, textMod] = await Promise.all([
    api("/api/admin/reports"),
    api("/api/admin/appeals"),
    api("/api/admin/attachments"),
    api("/api/admin/avatars"),
    api("/api/admin/gifs"),
    api("/api/admin/css"),
    api("/api/admin/profile-reports"),
    api("/api/admin/hidden"),
    api("/api/admin/vision"),
    api("/api/admin/text-mod"),
  ]);
  if (version !== state.renderVersion) return;
  addHeading(content, "Overview", 1);
  addText(document, content, "p",
    "Everything the desk watches, one glance: the queues with work show their counts, the auto-mod twins report their state. " +
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
    vision, textMod, document,
  ));
}

// The desk shell: sidebar rail + content column; the column is returned so
// each section renders INTO it (headings included).
function renderAdminShell(user, activeSlug) {
  const shell = document.createElement("div");
  shell.className = "desk-shell";
  const nav = document.createElement("nav");
  nav.className = "desk-nav";
  nav.setAttribute("aria-label", "Moderation desk sections");
  const name = document.createElement("p");
  name.className = "desk-signin";
  name.textContent = "Signed in as " + user.username;
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
    link.textContent = section.label;
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

function createDashboardBoard(tiles, vision, textMod, document) {
  const board = document.createElement("div");
  const status = document.createElement("div");
  status.className = "desk-status";
  status.append(createVisionSection(vision, document));
  status.append(createTextModSection(textMod, document));
  board.append(status);
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
    addText(document, container, "p", "No profile reports.", "empty-state");
    return container;
  }
  for (const report of reports) {
    const item = element("div", "report-queue-item");
    const head = element("p", "report-queue-head",
      report.profileUsername + " (reported by " + report.reporter + ")");
    const reason = element("p", "report-queue-reason");
    reason.textContent = report.reason;
    const resolve = element("button", "button", "Resolve");
    resolve.type = "button";
    resolve.dataset.action = "resolve-profile-report";
    resolve.dataset.reportId = String(report.id);
    const visit = element("a", "button button-quiet", "View profile");
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

function createHiddenPostsQueue(items, document) {
  const container = element("div", "hidden-posts-queue");
  if (!items.length) {
    addText(document, container, "p", "Nothing hidden right now.", "empty-state");
    return container;
  }
  for (const item of items) {
    const card = element("div", "hidden-post-item");
    const head = element("p", "hidden-post-head",
      item.author.username + " — " +
      (item.banReason ? "ban: " + item.banReason : "hidden post") +
      (item.banExpiresAt ? " (until " + new Date(item.banExpiresAt).toLocaleString() + ")" : " (permanent)"));
    const body = element("p", "hidden-post-body");
    body.textContent = item.body;
    const when = element("p", "hidden-post-when", new Date(item.createdAt).toLocaleString());
    const link = element("a", "button button-quiet", item.threadId === item.id ? "Open post" : "Open thread");
    link.href = "/posts/" + item.threadId;
    link.setAttribute("data-app-link", "");
    card.append(head, body, when, link);
    container.append(card);
  }
  return container;
}

function createRulesEditor(rulesData, document) {
  const container = element("div", "rules-editor");
  const label = element("p", "accent-picker-label", "Forum rules (markdown — the subset bodies use)");
  const textarea = element("textarea", "css-editor-input");
  textarea.id = "rules-input";
  textarea.rows = 10;
  textarea.maxLength = 1000000;
  textarea.value = typeof rulesData.rules === "string" ? rulesData.rules : "";
  const save = element("button", "button", "Save rules");
  save.type = "button";
  save.dataset.action = "save-forum-rules";
  container.append(label, textarea, save);
  return container;
}

function createCssQueue(submissions, document) {
  const container = element("div", "css-queue");
  if (!submissions.length) {
    addText(document, container, "p", "No CSS waiting for review.", "empty-state");
    return container;
  }
  for (const submission of submissions) {
    const item = element("div", "css-queue-item");
    const head = element("p", "css-queue-head", submission.username + " — " + submission.bytes + " chars");
    const preview = element("pre", "css-queue-preview");
    preview.textContent = submission.css;
    const approve = element("button", "button", "Approve");
    approve.type = "button";
    approve.dataset.action = "css-approve";
    approve.dataset.userId = String(submission.userId);
    approve.dataset.version = String(submission.version || "");
    const reject = element("button", "button button-quiet", "Reject");
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
};

export const ACTIONS = {
    // Pinned (C5): the mod desk's pin/unpin — POST to the admin route and
    // re-render; the payload's pinnedAt decides which control each card shows.
    "vision-kill": async () => {
      // Auto-mod kill switch (v3.1): one click, effective on the next upload.
      await api("/api/admin/vision-kill-switch", { method: "POST", body: { tripped: true } });
      await state.renderRoute(state.activeRoute);
      setMessage("Auto-mod is STOPPED — new uploads will not be checked.");
    },
    "vision-resume": async () => {
      await api("/api/admin/vision-kill-switch", { method: "POST", body: { tripped: false } });
      await state.renderRoute(state.activeRoute);
      setMessage("Auto-mod resumed.");
    },
    // Text auto-mod kill switch (v3.1): OpenAI Moderation's emergency stop —
    // independent of the Vision switch.
    "text-mod-kill": async () => {
      await api("/api/admin/text-mod-kill-switch", { method: "POST", body: { tripped: true } });
      await state.renderRoute(state.activeRoute);
      setMessage("Text auto-mod is STOPPED — member text will not be checked.");
    },
    "text-mod-resume": async () => {
      await api("/api/admin/text-mod-kill-switch", { method: "POST", body: { tripped: false } });
      await state.renderRoute(state.activeRoute);
      setMessage("Text auto-mod resumed.");
    },
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
};

export { renderAdminRoute };
