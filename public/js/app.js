import { api, setCsrfToken } from "./api.js";
import {
  createActiveBanList,
  createAppealQueue,
  createAttachmentQueue,
  createBanForm,
  createChatLog,
  createDmLog,
  createGifQueue,
  createAvatarQueue,
  createMemberSearch,
  createReportQueue,
  createTextModSection,
  createVisionSection,
  renderMemberSearchResults,
} from "./admin.js";
import { addText } from "./forms.js";
import { iconButton } from "./icons.js";
import { boardLabel } from "./boards.js";
import {
  appendPostList,
  createPostCard,
  createSubReplyContainer,
  renderBodyBlocks,
} from "./render.js";
import { isPlainLeftClick, startRouter } from "./router.js";
import { createNotificationBell } from "./notifications.js";
import {
  backToDmList,
  createChatButton,
  deleteChatMessage,
  deleteDmMessage,
  initChat,
  openDmThread,
  openDmWith,
  renderChatPage,
  setChatTab,
  submitChatMessage,
  submitDmMessage,
  updateChatSession,
  renderChatRoute,
} from "./chat.js";
import { applyCornerPreference, initTheme } from "./theme.js";
import {
  addTurnstileSlot,
  refreshTurnstile,
  renderTurnstileSlots,
  takeTurnstileToken,
  teardownTurnstile,
} from "./turnstile.js";
// v4.0 plan 4 Task 1: the shell singletons + panel helpers live in dom.js.
import {
  accountActions,
  addHeading,
  addSubmit,
  attachmentLightbox,
  clearConfirmHandler,
  confirmDialog,
  confirmOk,
  createPanel,
  element,
  getConfirmHandler,
  main,
  openConfirmDialog,
  reportDialog,
  reportForm,
  setMessage,
} from "./dom.js";
// v4.0 plan 4 Task 2: the auth concern (auth panels, setup screens, their
// submit handlers) lives in routes/auth.js; the route + form registries
// spread its handlers as the dispatch entries that used to live inline here.
import {
  FORM_HANDLERS as authFormHandlers,
  renderHomeAccess,
  renderSetupRoute,
} from "./routes/auth.js";

// v4.0 plan 4 Task 2: the boot state lives in state.js (route modules read
// and write the same bag). renderRoute is hoisted, so it can be published
// here at module scope before any route module runs.
import { state } from "./state.js";
state.renderRoute = renderRoute;
// v4.0 plan 4 Task 3: the feed concern (home/search/mine/category/bookmarks
// routes, feed tabs, the composer family + its dialogs, feed pagination) lives
// in routes/feed.js; registries spread its handlers as dispatch entries.
import {
  ACTIONS as feedActions,
  FORM_HANDLERS as feedFormHandlers,
  createComposer,
  handleComposerFileSelection,
  renderBookmarksRoute,
  renderCategoryRoute,
  renderHomeRoute,
  renderMineRoute,
  uploadCommunityGif,
} from "./routes/feed.js";
// v4.0 profile wall: its module owns the render + the post/pin registrations.
import {
  ACTIONS as wallActions,
  FORM_HANDLERS as wallFormHandlers,
  renderProfileWall,
} from "./wall.js";
// v4.0 plan 4 Task 4: the post-detail concern (the /post/:id route, its
// reply mini-composers and sub-reply cascades, quote prefill, the edit
// flow, and the attachment lightbox) lives in routes/post.js; registries
// spread its handlers as the dispatch entries that used to live inline.
import {
  ACTIONS as postActions,
  FORM_HANDLERS as postFormHandlers,
  renderPostRoute,
} from "./routes/post.js";
// v4.0 plan 4 Task 5: the profile concern (the /users/:username
// route plus its surface, submit handlers, and delete dialogs) lives
// in routes/profile.js; registries spread its handlers as dispatch
// entries.
import {
  ACTIONS as profileActions,
  FORM_HANDLERS as profileFormHandlers,
  renderProfileRoute,
} from "./routes/profile.js";
import { clearProfileTheme } from "./routes/profile.js";

// v4.0 plan 4 Task 6: the content pages (rules/leaderboard/archive) plus
// the site-search submit and page actions (archive paging, rules save) live
// in routes/pages.js.
import {
  ACTIONS as pagesActions,
  FORM_HANDLERS as pagesFormHandlers,
  renderArchiveRoute,
  renderLeaderboardRoute,
  renderRulesRoute,
} from "./routes/pages.js";

// v4.0 plan 4 Task 7: the appeals concern (the /appeals route and its
// submits) and the notifications concern (the /notifications route and
// its actions) live in routes/appeals.js and routes/notifications.js
// (the /chat route wrapper moved into chat.js itself).
import {
  FORM_HANDLERS as appealFormHandlers,
  renderAppealsRoute,
} from "./routes/appeals.js";
import {
  ACTIONS as notificationActions,
  renderNotificationsRoute,
} from "./routes/notifications.js";

function renderAccountNavigation(user, unreadNotifications = 0) {
  accountActions.replaceChildren();
  // The mobile bar's last item mirrors the session: Profile (signed in) --
  // the static markup ships a Sign-in item for guests; the id marks it.
  const mobileSignIn = document.querySelector("#mobile-signin") ||
    document.querySelector("#mobile-profile") ||
    document.querySelector(".mobile-bar .mobile-bar-item:last-child");
  if (mobileSignIn) {
    const span = mobileSignIn.querySelector("span:last-of-type");
    mobileSignIn.id = user ? "mobile-profile" : "mobile-signin";
    mobileSignIn.href = user ? "/users/" + encodeURIComponent(user.username) : "/#join";
    mobileSignIn.setAttribute("aria-label", user ? "Profile" : "Sign in");
    mobileSignIn.title = user ? "Profile" : "Sign in";
    if (span) span.textContent = user ? "Profile" : "Sign in";
    if (user) mobileSignIn.dataset.appLink = "";
    else mobileSignIn.removeAttribute("data-app-link");
  }
  // Suggestions board link (v2.4.1): the header's site-section link, styled
  // exactly like the links around it and visible to guests and signed-in
  // members alike; internal navigation handles it like every other header
  // anchor. The brand stays Home.
  const suggestions = iconButton(document, "lightbulb", {
    tagName: "a",
    className: "button button-secondary icon-button",
    dataset: { href: "/suggestions" },
  });
  suggestions.setAttribute("data-app-link", "");
  accountActions.append(suggestions);
  // Accountability archive (v2.4.1): public to guests and members alike.
  const archiveLink = iconButton(document, "archive", {
    tagName: "a",
    className: "button button-secondary icon-button",
    dataset: { href: "/archive" },
  });
  archiveLink.setAttribute("data-app-link", "");
  accountActions.append(archiveLink);
  const leaderboardLink = iconButton(document, "trophy", {
    tagName: "a",
    className: "button button-secondary icon-button",
    dataset: { href: "/leaderboard" },
  });
  leaderboardLink.setAttribute("data-app-link", "");
  accountActions.append(leaderboardLink);
  const rulesLink = iconButton(document, "scroll", {
    tagName: "a",
    className: "button button-secondary icon-button",
    dataset: { href: "/rules" },
  });
  rulesLink.setAttribute("data-app-link", "");
  accountActions.append(rulesLink);
  // Live chat (v3.1): the panel toggle carries the online counter. Guests
  // read the stream and see the count; sending needs a session.
  accountActions.append(createChatButton(document));
  if (!user) {
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");
    accountActions.append(signIn);
    return;
  }
  const profile = iconButton(document, "person", {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: "Profile — " + user.username,
    dataset: { href: "/users/" + encodeURIComponent(user.username) },
  });
  profile.setAttribute("data-app-link", "");
  accountActions.append(profile);
  // Bookmarks (C4): the private saved list — members only.
  const saved = iconButton(document, "bookmarks", {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: "Saved posts",
    dataset: { href: "/bookmarks" },
  });
  saved.setAttribute("data-app-link", "");
  accountActions.append(saved);
  // Appeals (v3.1): the member surface for auto-mod decisions and history.
  const appeals = iconButton(document, "flag", {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: "Appeals",
    dataset: { href: "/appeals" },
  });
  appeals.setAttribute("data-app-link", "");
  accountActions.append(appeals);
  accountActions.append(createNotificationBell(unreadNotifications, document));
  if (user.role === "owner" || user.role === "admin") {
    const reports = iconButton(document, "shield", {
      tagName: "a",
      className: "button button-secondary icon-button",
      dataset: { href: "/admin/reports" },
    });
    accountActions.append(reports);
  }
  const logout = iconButton(document, "logout", {
    className: "button button-quiet icon-button",
    dataset: { action: "logout" },
  });
  accountActions.append(logout);
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

async function prepareRouteContext(version) {
  const [session, setup] = await Promise.all([
    api("/api/session"),
    api("/api/setup/status"),
  ]);
  if (version !== state.renderVersion) return null;
  state.currentUser = session.user;
  setCsrfToken(session.csrfToken);
  renderAccountNavigation(session.user, session.unreadNotifications ?? 0);
  // Live chat (v3.1): mirror the session into the chat module — heartbeat
  // start/stop and the send form's availability. Cheap on repeats.
  updateChatSession(session.user);
  return {
    session,
    setupRequired: setup.required,
    setupConfigured: setup.secretConfigured && setup.passwordSecurityConfigured,
  };
}

function setRouteTitle(route) {
  const pageNames = {
    home: "Wempo's Forum",
    search: "Search",
    suggestions: "Suggestions",
    archive: "Archive",
    mine: "My posts",
    leaderboard: "Leaderboard",
    rules: "Rules",
    chat: "Chat",
    post: "Post",
    profile: "Profile",
    admin: "Moderation",
    appeals: "Appeals",
    notifications: "Notifications",
    bookmarks: "Saved posts",
    setup: "First-time setup",
    "not-found": "Not found",
  };
  document.title = route.name === "home"
    ? "Wempo's Forum"
    : route.name === "category"
      // Categories (v3.1): the title carries the category's display name.
      ? `${route.board ? boardLabel(route.board) : "Category"} · Wempo's Forum`
      : `${pageNames[route.name] || pageNames.home} · Wempo's Forum`;
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

function renderNotFoundRoute() {
  addHeading(main, "Page not found", 1);
  addText(document, main, "p", "That page isn't available.", "muted");
}

async function renderRoute(route) {
  const version = ++state.renderVersion;
  state.activeRoute = route;
  main.classList.toggle("home-page", route.name === "home");
  // Profile themes (v2.5): main outlives routes — a member's accent class
  // must never tint another route (the review caught exactly that).
  main.classList.remove("profile-section");
  // Profile accent + banner (any hex, v3.0.2): both ride CSS custom
  // properties on main — main outlives routes, so a member's colors must
  // never tint another route (the review caught exactly that for classes).
  main.style.removeProperty("--profile-accent");
  main.style.removeProperty("--banner-color");
  // Custom profile CSS (v2.5): the tracked <link> lives in routes/profile.js
  // (applyProfileTheme removes it at the next profile render — the scoped
  // selectors are inert elsewhere); the scope class must be dropped here so
  // the class never tints a non-profile route (the review caught exactly
  // that for the accent).
  main.classList.remove("profile-theme-scope");
  clearProfileTheme();
  teardownTurnstile();
  main.replaceChildren();
  setMessage();

  const context = await prepareRouteContext(version);
  if (!context) return;
  setRouteTitle(route);

  const renderers = {
    setup: () => renderSetupRoute(context),
    home: () => renderHomeRoute(route, context, version),
    search: () => renderHomeRoute(route, context, version),
    mine: () => renderMineRoute(context, version),
    leaderboard: () => renderLeaderboardRoute(context, version),
    rules: () => renderRulesRoute(context, version),
    category: () => renderCategoryRoute(route, context, version),
    chat: () => renderChatRoute(context, version),
    archive: () => renderArchiveRoute(context, version),
    post: () => renderPostRoute(route, context, version),
    profile: () => renderProfileRoute(route, context, version),
    admin: () => renderAdminRoute(context, version),
    appeals: () => renderAppealsRoute(context, version),
    notifications: () => renderNotificationsRoute(context, version),
    bookmarks: () => renderBookmarksRoute(context, version),
    "not-found": () => renderNotFoundRoute(),
  };
  const renderPage = renderers[route.name] || renderNotFoundRoute;
  await renderPage();
  await renderTurnstileSlots(main);
}

// Member search (v3.1): fetch and render into the section's results node.
async function submitMemberSearch(form, text) {
  const data = await api("/api/admin/users/search?q=" + encodeURIComponent(text("q").trim()));
  const results = form.parentElement?.querySelector("[data-member-search-results]");
  results?.replaceChildren(renderMemberSearchResults(data.members, document));
}

function readForm(form) {
  return new FormData(form);
}

async function submitReportForm(text) {
  const targetType = reportForm.dataset.targetType || "post";
  const targetId = encodeURIComponent(reportForm.dataset.targetId || "");
  const endpoint = targetType === "profile"
    ? "/api/users/" + targetId + "/reports"
    : "/api/posts/" + targetId + "/reports";
  await api(endpoint, { method: "POST", body: { reason: text("reason") } });
  reportDialog.close();
  reportForm.reset();
  delete reportForm.dataset.targetType;
  delete reportForm.dataset.targetId;
  document.querySelector("#report-title").textContent = "Report this post";
  setMessage("Your report was sent to the mods.");
}

async function submitReportResolution(form) {
  await api("/api/admin/reports/" + form.dataset.reportId + "/resolve", {
    method: "POST",
    body: { action: form.dataset.action },
  });
  await renderRoute({ name: "admin" });
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
  await renderRoute({ name: "admin" });
  setMessage(hours > 0
    ? "The user was banned and their sessions revoked. Their account reactivates when the ban expires."
    : "The user was banned and their sessions revoked.");
}

async function submitUnbanForm(form, text) {
  await api("/api/admin/users/" + form.dataset.userId + "/bans", {
    method: "DELETE",
    body: { reason: text("reason") },
  });
  await renderRoute({ name: "admin" });
  setMessage("The ban was lifted.");
}

async function submitForm(form) {
  const values = readForm(form);
  const type = form.dataset.form;
  const text = (name) => String(values.get(name) ?? "");
  setMessage("Saving…");

  const handlers = {
    ...authFormHandlers,
    ...feedFormHandlers,
    ...wallFormHandlers,
    // The post-detail edit form lives in routes/post.js.
    ...postFormHandlers,
    // The profile submit handlers live in routes/profile.js.
    ...profileFormHandlers,
    // The site-search submit lives in routes/pages.js.
    ...pagesFormHandlers,
    // The appeal submits live in routes/appeals.js.
    ...appealFormHandlers,
    report: () => submitReportForm(text),
    "admin-resolve": () => submitReportResolution(form),
    "admin-ban": () => submitBanForm(form, text),
    "admin-unban": () => submitUnbanForm(form, text),
    "admin-promote": () => submitRoleChange(form, "promote", text),
    "admin-demote": () => submitRoleChange(form, "demote", text),
    "admin-avatar-approve": () => submitAvatarModeration(form, "approve"),
    "admin-avatar-reject": () => submitAvatarModeration(form, "reject"),
    "admin-attachment-approve": () => submitAttachmentModeration(form, "approve"),
    "admin-attachment-reject": () => submitAttachmentModeration(form, "reject"),
    "admin-member-search": () => submitMemberSearch(form, text),
    "chat-send": async () => {
      // submitForm's generic "Saving…" status reads wrong for a live chat;
      // clear it once the message lands (errors still surface via api()).
      await submitChatMessage(form);
      setMessage();
    },
    "dm-send": async () => {
      await submitDmMessage(form);
      setMessage();
    },
  };
  const handler = handlers[type];
  // Route-module handlers take (form, text, values); entries still owned in
  // app.js are zero-arg closures that ignore the arguments — call uniformly.
  if (handler) await handler(form, text, values);
}

function handleInternalNavigation(event) {
  if (!isPlainLeftClick(event)) return false;
  const anchor = event.target.closest("a");
  if (!anchor || anchor.origin !== location.origin || !anchor.pathname.startsWith("/") ||
      anchor.hash || anchor.hasAttribute("download")) return false;
  event.preventDefault();
  state.router.navigate(anchor.pathname + anchor.search);
  return true;
}

async function submitReaction(button) {
  // Stateful toggle: an "active" button carries the viewer's own reaction, so
  // clicking it retracts (DELETE); otherwise it sets the value (PUT).
  if (button.dataset.state === "active") {
    await api("/api/posts/" + button.dataset.postId + "/reaction", { method: "DELETE" });
  } else {
    await api("/api/posts/" + button.dataset.postId + "/reaction", {
      method: "PUT",
      body: { value: button.dataset.value },
    });
  }
  await renderRoute(state.activeRoute);
}

async function submitRoleChange(form, action, text) {
  const reason = text("reason").trim();
  await api("/api/admin/users/" + form.dataset.userId + "/" + action, {
    method: "POST",
    body: reason ? { reason } : {},
  });
  // Role-change forms live on the moderation desk and on member profiles;
  // re-rendering the current route refreshes whichever surface is showing.
  await renderRoute(state.activeRoute);
  setMessage(action === "promote"
    ? "The member was promoted to mod."
    : "The member was demoted to member.");
}

async function submitAvatarModeration(form, action) {
  await api("/api/admin/avatars/" + form.dataset.userId + "/" + action, {
    method: "POST",
  });
  await renderRoute({ name: "admin" });
  setMessage(action === "approve" ? "The avatar was approved." : "The avatar was rejected.");
}

// Attachment rows are per-post ids, not replaceable profile pairs, and an
// unknown/stale id 404s (never "already handled") — same rerender-and-report
// flow as the avatar desk above.
async function submitAttachmentModeration(form, action) {
  await api("/api/admin/attachments/" + form.dataset.attachmentId + "/" + action, {
    method: "POST",
  });
  await renderRoute({ name: "admin" });
  setMessage(action === "approve" ? "The image was approved." : "The image was rejected.");
}

// GIF picker functions (v2.5): open renders the approved library into the
// dialog grid; confirm folds the selection into the composer state; cancel
// closes. Selected thumbs carry aria-pressed so keyboard/AT state is real.
function openReportDialog(target) {
  const isButton = target instanceof HTMLButtonElement;
  const targetType = isButton ? "post" : target.type;
  const targetId = isButton ? target.dataset.postId : target.id;
  if (!["post", "profile"].includes(targetType) || !targetId) {
    throw new Error("That report target is no longer available.");
  }
  reportForm.dataset.targetType = targetType;
  reportForm.dataset.targetId = String(targetId);
  document.querySelector("#report-title").textContent =
    targetType === "profile" ? "Report this profile" : "Report this post";
  reportDialog.showModal();
  reportForm.querySelector("textarea").focus();
}

async function handleButtonAction(button) {
  const handlers = {
    logout: async () => {
      await api("/api/auth/logout", { method: "POST" });
      setCsrfToken("");
      state.router.navigate("/");
      setMessage("You are signed out.");
    },
    reaction: () => submitReaction(button),
    report: () => openReportDialog(button),
    "close-report": () => reportDialog.close(),
    // Feed + composer actions live in routes/feed.js.
    ...feedActions,
    // Profile wall actions (v4.0).
    ...wallActions,
    // The post-detail conversation actions live in routes/post.js.
    ...postActions,
    // The profile surface's actions live in routes/profile.js.
    ...profileActions,
    // The content-page actions (archive paging, rules save) live in routes/pages.js.
    ...pagesActions,
    // Notification actions live in routes/notifications.js.
    ...notificationActions,
    // Suggestion status (v3.1): staff flip resolved/declined/open; the
    // route re-render refetches the payload so the chip and buttons come
    // back from the server, never from the echo.
    "suggestion-status": async () => {
      await api("/api/posts/" + button.dataset.postId + "/suggestion-status", {
        method: "POST",
        body: { status: button.dataset.status },
      });
      await renderRoute(state.activeRoute);
      setMessage(button.dataset.status === "open"
        ? "Suggestion reopened."
        : "Suggestion marked " + button.dataset.status + ".");
    },
    "chat-tab": () => setChatTab(button.dataset.chatTab),
    "dm-open-thread": () => openDmThread(button.dataset.threadId, button.dataset.otherUsername),
    "dm-back": () => backToDmList(),
    // The profile Message button find-or-creates the thread, then lands on
    // /chat where the pending thread opens.
    "dm-open": async () => {
      await openDmWith(button.dataset.username);
      state.router.navigate("/chat");
    },
    "chat-delete": () => deleteChatMessage(button),
    "dm-delete": () => deleteDmMessage(button),
    "toggle-bookmark": async () => {
      // Bookmarks (C4): both directions are idempotent server-side; the
      // route re-render refetches the payload's fresh state.
      const bookmarked = String(button.getAttribute("aria-pressed")) === "true";
      await api("/api/posts/" + button.dataset.postId + "/bookmark", {
        method: bookmarked ? "DELETE" : "PUT",
      });
      await renderRoute(state.activeRoute);
      setMessage(bookmarked ? "Removed from your saved posts." : "Saved.");
    },
    "toggle-subscribe": async () => {
      const subscribed = button.dataset.subscribed === "1";
      await api("/api/posts/" + button.dataset.postId + "/subscribe", {
        method: subscribed ? "DELETE" : "POST",
      });
      await renderRoute(state.activeRoute);
      setMessage(subscribed ? "You unsubscribed from this thread." : "You will get notifications for replies here.");
    },
    // Pinned (C5): the mod desk's pin/unpin — POST to the admin route and
    // re-render; the payload's pinnedAt decides which control each card shows.
    "vision-kill": async () => {
      // Auto-mod kill switch (v3.1): one click, effective on the next upload.
      await api("/api/admin/vision-kill-switch", { method: "POST", body: { tripped: true } });
      await renderRoute(state.activeRoute);
      setMessage("Auto-mod is STOPPED — new uploads will not be checked.");
    },
    "vision-resume": async () => {
      await api("/api/admin/vision-kill-switch", { method: "POST", body: { tripped: false } });
      await renderRoute(state.activeRoute);
      setMessage("Auto-mod resumed.");
    },
    // Text auto-mod kill switch (v3.1): OpenAI Moderation's emergency stop —
    // independent of the Vision switch.
    "text-mod-kill": async () => {
      await api("/api/admin/text-mod-kill-switch", { method: "POST", body: { tripped: true } });
      await renderRoute(state.activeRoute);
      setMessage("Text auto-mod is STOPPED — member text will not be checked.");
    },
    "text-mod-resume": async () => {
      await api("/api/admin/text-mod-kill-switch", { method: "POST", body: { tripped: false } });
      await renderRoute(state.activeRoute);
      setMessage("Text auto-mod resumed.");
    },
    "thread-pin": async () => {
      await api("/api/admin/threads/" + button.dataset.postId + "/pin", { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("Thread pinned.");
    },
    "thread-unpin": async () => {
      await api("/api/admin/threads/" + button.dataset.postId + "/unpin", { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("Thread unpinned.");
    },
    // Polls (C3): the vote PUT (one changeable vote per member) and the
    // re-render refetches the payload's fresh counts.
    "poll-vote": async () => {
      if (state.activeRoute.name !== "post") return;
      const postId = state.activeRoute.id;
      await api("/api/posts/" + postId + "/poll", {
        method: "PUT",
        body: { optionId: Number(button.dataset.optionId) },
      });
      await renderRoute(state.activeRoute);
    },
    "gif-approve": async () => {
      await api("/api/admin/gifs/" + encodeURIComponent(button.dataset.gifId) + "/approve", { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("GIF approved and added to the public library.");
    },
    "gif-reject": async () => {
      await api("/api/admin/gifs/" + encodeURIComponent(button.dataset.gifId) + "/reject", { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("GIF submission rejected.");
    },
    "report-profile": () => openReportDialog({ type: "profile", id: button.dataset.profileId }),
    "resolve-profile-report": async (button) => {
      await api("/api/admin/profile-reports/" + encodeURIComponent(button.dataset.reportId) + "/resolve", { method: "POST" });
      button.closest(".report-queue-item")?.remove();
      setMessage("Report resolved.");
    },
    "css-approve": async (button) => {
      const version = encodeURIComponent(button.dataset.version || "");
      await api("/api/admin/css/" + encodeURIComponent(button.dataset.userId) + "/approve?version=" + version, { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("CSS approved.");
    },
    "css-reject": async (button) => {
      const version = encodeURIComponent(button.dataset.version || "");
      await api("/api/admin/css/" + encodeURIComponent(button.dataset.userId) + "/reject?version=" + version, { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("CSS rejected.");
    },
    "confirm-ok": async () => {
      if (!getConfirmHandler()) return;
      const handler = getConfirmHandler();
      // Disabled while pending: a double confirm can't fire the destructive
      // request twice while it is in flight. A REQUEST FAILURE keeps the
      // handler armed (the dialog stays open, the error bar carries the
      // message) so the user can retry the same confirm without closing the
      // dialog first; success clears it via the handler itself.
      confirmOk.disabled = true;
      try {
        await handler();
        clearConfirmHandler();
      } finally {
        confirmOk.disabled = false;
      }
    },
    "confirm-cancel": () => {
      clearConfirmHandler();
      confirmDialog.close();
    },
  };
  const handler = handlers[button.dataset.action];
  // Pass the button: handlers written as (button) => {} MUST get it — calling
  // them bare crashes with "reading 'dataset' of undefined" (the live
  // resolve-profile-report/css-desk breakage).
  if (handler) await handler(button);
}

async function handleClick(event) {
  if (handleInternalNavigation(event)) return;
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  try {
    await handleButtonAction(button);
  } catch (error) {
    setMessage(error.message, true);
  }
}
document.addEventListener("click", handleClick);
// The attachment lightbox closes on any click inside it (image included) or on
// its backdrop; Escape is native to <dialog>.
attachmentLightbox?.addEventListener("click", () => attachmentLightbox.close());
// Composer file inputs: folder/picker selections are folded into the form's
// chosen list at change time (cap + size messages surface on the status bar).
document.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.composerInput === "images") {
    handleComposerFileSelection(input);
  } else if (input.dataset.composerInput === "gif-marketplace") {
    uploadCommunityGif(input).catch((error) => setMessage(error.message, true));
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  try {
    await submitForm(form);
  } catch (error) {
    setMessage(error.message, true);
  }
});

// Theme storage may be unavailable in private/restricted contexts. That should
// never prevent the application state.router from running or leave the HTML shell
// stuck at its initial placeholder.
async function fillVersionTag() {
  const info = await api("/api/version");
  const version = typeof info?.version === "string" ? info.version.split(".") : [];
  const shortVersion = version.length > 1 ? `v${version[0]}.${version[1]}` : "";
  const commit = typeof info?.commit === "string" ? info.commit : "";
  document.querySelector("#version-tag").textContent =
    [shortVersion, commit].filter(Boolean).join(" · ");
}

try {
  let storage;
  try { storage = window.localStorage; }
  catch { storage = { getItem: () => null, setItem: () => {} }; }
  initTheme(document, storage);
  applyCornerPreference(document, storage);
  // Live chat (v3.1): the poll loop starts at boot so the header's online
  // counter is fresh even before the panel is ever opened.
  initChat();
  fillVersionTag().catch(() => {});
  state.router = startRouter((route) => {
    renderRoute(route).catch((error) => {
      setMessage(error.message, true);
      main.replaceChildren();
      addHeading(main, "Something went wrong:(", 1);
      addText(document, main, "p", error.message, "error-copy");
    });
  });
} catch (error) {
  console.error("Forum startup failed:", error);
  main.replaceChildren();
  addHeading(main, "The forum could not start:(", 1);
  addText(document, main, "p",
    "A startup error interrupted the forum! Refresh after the site is updated.",
    "error-copy");
}
