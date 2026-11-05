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

async function renderAdminRoute(context, version) {
  const [reports, bans, avatars, attachments, css, profileReports, gifs, rules, hidden, appeals, vision, textMod, chat, dms] = await Promise.all([
    api("/api/admin/reports"),
    api("/api/admin/bans"),
    api("/api/admin/avatars"),
    api("/api/admin/attachments"),
    api("/api/admin/css"),
    api("/api/admin/profile-reports"),
    api("/api/admin/gifs"),
    api("/api/rules"),
    api("/api/admin/hidden"),
    api("/api/admin/appeals"),
    api("/api/admin/vision"),
    api("/api/admin/text-mod"),
    api("/api/admin/chat"),
    api("/api/admin/dms"),
  ]);
  if (version !== state.renderVersion) return;
  renderAdmin(reports, bans, avatars, attachments, css, profileReports, gifs, rules, hidden, context.session.user, appeals, vision, textMod, chat, dms);
}

function renderAdmin(reportData, banData, avatarData, attachmentData, cssData, profileReportData, gifData, rulesData, hiddenData, user, appealData, visionData, textModData, chatData, dmData) {
  addHeading(main, "Moderation desk", 1);
  addText(document, main, "p", "Review reports, hide inappropriate posts, and manage active bans.", "page-lede");
  // Auto-mod control (v3.1): the status line + THE kill switch, front and
  // center so stopping Vision never takes more than one click.
  addHeading(main, "Auto-mod (Google Vision)", 2);
  main.append(createVisionSection(visionData, document));
  // Text auto-mod control (v3.1): the OpenAI Moderation twin — its own kill
  // switch, independent of Vision's.
  addHeading(main, "Auto-mod (OpenAI text moderation)", 2);
  main.append(createTextModSection(textModData, document));
  addHeading(main, "Open reports", 2);
  main.append(createReportQueue(reportData.reports, document, user));
  addHeading(main, "Avatars awaiting review", 2);
  main.append(createAvatarQueue(avatarData.avatars, document));
  addHeading(main, "Images awaiting review", 2);
  main.append(createAttachmentQueue(attachmentData.attachments, document));
  addHeading(main, "Profile CSS awaiting review", 2);
  main.append(createCssQueue(cssData.cssSubmissions, document));
  addHeading(main, "Profile reports", 2);
  main.append(createProfileReportQueue(profileReportData.profileReports, document));
  addHeading(main, "Appeals", 2);
  main.append(createAppealQueue(appealData.appeals, document));
  // Chat log (v3.1): the full stream for staff — banned authors included —
  // with in-place deletion. Newest first.
  addHeading(main, "Chat log", 2);
  main.append(createChatLog(chatData.messages, document));
  // DM log (v3.1): 1:1 messages under the same scrutiny — both participants
  // named, deletable in place.
  addHeading(main, "DM log", 2);
  main.append(createDmLog(dmData.messages, document));
  addHeading(main, "Forum rules", 2);
  main.append(createRulesEditor(rulesData.rules, document));
  addHeading(main, "Gallery uploads awaiting review", 2);
  main.append(createGifQueue(gifData.gifs, document));
  // Hidden posts (v3.0.1, the nuke): the mod-only page — hidden rows
  // and anything by an actively banned author, bodies included.
  addHeading(main, "Hidden posts", 2);
  main.append(createHiddenPostsQueue(hiddenData.hidden, document));
  addHeading(main, "Active bans", 2);
  main.append(createActiveBanList(banData.bans, document));
  // Find a member (v3.1): username search with the unban form attached, so an
  // unban is one search + one button (Pone's ask).
  addHeading(main, "Find a member", 2);
  main.append(createMemberSearch(document));
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
