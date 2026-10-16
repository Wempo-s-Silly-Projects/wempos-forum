import { api, setCsrfToken } from "./api.js";
import {
  COMPOSER_ACCEPT,
  MAX_COMPOSER_FILES,
  addComposerFiles,
  buildComposerBody,
} from "./attachments.js";
import {
  createActiveBanList,
  createAttachmentQueue,
  createAvatarQueue,
  createReportQueue,
} from "./admin.js";
import { addText, createForm, createInput, createTextarea } from "./forms.js";
import { COMPOSER_MAX_CHARS } from "./composer-limits.js";
import {
  appendPostList,
  closeEditForm,
  createPostCard,
  createSubReplyContainer,
  openEditForm,
} from "./render.js";
import { prefillQuote } from "./quotes.js";
import { isPlainLeftClick, startRouter } from "./router.js";
import { homepageInterests, homepageIntro } from "./home-intro.js";
import {
  createNotificationBell,
  renderNotificationsPage,
  updateBell,
} from "./notifications.js";
import { renderBannedScreen } from "./banned.js";
import { initTheme } from "./theme.js";
import {
  SOCIAL_LABELS,
  SOCIAL_PLATFORM_ORDER,
  invalidSocialKeys,
  renderProfileEditor,
  renderProfileSocials,
} from "./profile-editor.js";
import {
  addTurnstileSlot,
  refreshTurnstile,
  renderTurnstileSlots,
  takeTurnstileToken,
  teardownTurnstile,
} from "./turnstile.js";

const main = document.querySelector("#main-content");
const accountActions = document.querySelector("#account-actions");
const statusMessage = document.querySelector("#status-message");
const errorMessage = document.querySelector("#error-message");
const reportDialog = document.querySelector("#report-dialog");
const reportForm = reportDialog.querySelector('[data-form="report"]');
const attachmentLightbox = document.querySelector("#attachment-lightbox");

let router;
let currentUser = null;
let activeRoute = { name: "home" };
let renderVersion = 0;

// Suggestions board (v2.4.1): the /suggestions route reuses the feed UI, so
// its composer tags root posts with board=suggestions (form dataset flag read
// by submitNewPost) and its empty state speaks the board's copy.
const SUGGESTIONS_BOARD = "suggestions";
const SUGGESTIONS_EMPTY_TEXT = "No suggestions yet — be the first!";

const element = (tagName, className = "", text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setMessage(message = "", isError = false) {
  statusMessage.textContent = isError ? "" : message;
  errorMessage.textContent = isError ? message : "";
}

function addHeading(parent, text, level = 1) {
  const heading = element(`h${level}`, level === 1 ? "page-heading" : "", text);
  parent.append(heading);
  return heading;
}

function createPanel(title, description = "") {
  const panel = element("section", "panel");
  addHeading(panel, title, 2);
  if (description) addText(document, panel, "p", description, "muted");
  return panel;
}

function addSubmit(form, label) {
  const button = element("button", "button button-primary", label);
  button.type = "submit";
  form.append(button);
  return button;
}

function authForm(name, title, buttonLabel) {
  const section = element("section", "auth-card");
  addHeading(section, title, 2);
  const form = createForm(document, name, [
    createInput(document, {
      id: `${name}-username`,
      name: "username",
      label: "Username",
      autoComplete: "username",
      required: true,
      minLength: 3,
      maxLength: 24,
    }),
    createInput(document, {
      id: `${name}-password`,
      name: "password",
      label: "Password",
      type: "password",
      autoComplete: name === "login" ? "current-password" : "new-password",
      required: true,
      minLength: 12,
      maxLength: 128,
    }),
  ], buttonLabel);
  addTurnstileSlot(form, name === "login" ? "login" : "signup");
  section.append(form);
  return section;
}

function setupForm() {
  const panel = createPanel("Set up Wempo's Forum", "The first administrator requires a setup secret configured by the site owner.");
  panel.append(createForm(document, "setup", [
    createInput(document, {
      id: "setup-username", name: "username", label: "Administrator username",
      autoComplete: "username", required: true, minLength: 3, maxLength: 24,
    }),
    createInput(document, {
      id: "setup-password", name: "password", label: "Password",
      type: "password", autoComplete: "new-password", required: true, minLength: 12, maxLength: 128,
    }),
    createInput(document, {
      id: "setup-key", name: "setupKey", label: "Setup secret", type: "password",
      autoComplete: "off", required: true, minLength: 32, maxLength: 4096,
      description: "Provided by the site owner through Wrangler. Never share it.",
    }),
  ], "Create administrator"));
  return panel;
}

// Every composer is Turnstile-gated now: root posts use action "post", every
// reply composer (the detail-route root reply and reply-to-reply mini
// composers) uses action "reply". board (v2.4.1): the Suggestions composer
// carries its board value on the form's dataset — the ONLY caller-driven
// difference; submitNewPost reads the dataset flag so the payload picks the
// board up in the same wire format the rest of the body uses.
function createComposer(name, label, buttonLabel, postID = null,
  turnstileAction = null, board = null) {
  const panel = createPanel(board === "suggestions"
    ? "Share a suggestion"
    : name === "post-create" ? "Start a conversation" : "Reply");
  const form = document.createElement("form");
  form.dataset.form = name;
  if (postID !== null) form.dataset.postId = String(postID);
  if (board) form.dataset.board = board;
  // The reply-to-reply mini composer shares the "reply" form name with the
  // detail route's root composer, so the textarea id carries the target id to
  // keep label/for pairs unique in the document.
  form.append(createTextarea(document, {
    id: `${name}-${postID ?? "new"}-body`, name: "body", label,
    rows: 4, maxLength: COMPOSER_MAX_CHARS, required: true, counter: true,
  }));
  form.append(createComposerAttachmentRow());
  addTurnstileSlot(form, turnstileAction ?? (name === "post-create" ? "post" : "reply"));
  addSubmit(form, buttonLabel);
  panel.append(form);
  return panel;
}

// Image attachments on every composer (plan Task 7): a paperclip-style button
// driving a hidden multi-file input, plus a strip of chosen files rendered by
// renderComposerFileStrip. The chosen File objects never enter the DOM — they
// ride on a plain `composerFiles` property of the form, which readForm's
// FormData knows nothing about; submit handlers fold them into the payload.
// Uploads land in the moderation-pending state, so the note mirrors the
// avatar uploader's review-first wording.
function createComposerAttachmentRow() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = COMPOSER_ACCEPT;
  input.multiple = true;
  input.hidden = true;
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.dataset.composerInput = "images";
  const attach = element("button", "button button-quiet", "📎 Attach images");
  attach.type = "button";
  attach.dataset.action = "composer-attach";
  const description = element("span", "form-note");
  description.textContent =
    `Images are reviewed before they show publicly. Up to ${MAX_COMPOSER_FILES}, ` +
    "10 MiB or less each (JPEG, PNG, WebP, or GIF).";
  const strip = element("div", "composer-files");
  strip.dataset.composerStrip = "images";
  strip.hidden = true;
  const row = element("div", "composer-attach-row");
  row.append(attach, description, strip, input);
  return row;
}

function renderComposerFileStrip(form) {
  const strip = form.querySelector('[data-composer-strip]');
  if (!strip) return;
  const files = form.composerFiles ?? [];
  strip.replaceChildren();
  strip.hidden = files.length === 0;
  for (const [index, file] of files.entries()) {
    const chip = element("span", "composer-file", file.name);
    const remove = element("button", "button button-quiet composer-file-remove", "Remove");
    remove.type = "button";
    remove.dataset.action = "remove-composer-file";
    remove.dataset.fileIndex = String(index);
    chip.append(remove);
    strip.append(chip);
  }
}

function handleComposerFileSelection(input) {
  const form = input.closest("form");
  if (!form) return;
  const { files, notices } = addComposerFiles(form.composerFiles ?? [], input.files);
  form.composerFiles = files;
  renderComposerFileStrip(form);
  if (notices.length) setMessage(notices.join(" "), true);
  // Reset so re-picking the same file fires another change event.
  input.value = "";
}

function renderAccountNavigation(user, unreadNotifications = 0) {
  accountActions.replaceChildren();
  // Suggestions board link (v2.4.1): the header's site-section link, styled
  // exactly like the links around it and visible to guests and signed-in
  // members alike; internal navigation handles it like every other header
  // anchor. The brand stays Home.
  const suggestions = element("a", "button button-secondary", "Suggestions");
  suggestions.href = "/suggestions";
  suggestions.setAttribute("data-app-link", "");
  accountActions.append(suggestions);
  if (!user) {
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");
    accountActions.append(signIn);
    return;
  }
  const profile = element("a", "button button-secondary", user.username);
  profile.href = `/users/${encodeURIComponent(user.username)}`;
  accountActions.append(profile);
  accountActions.append(createNotificationBell(unreadNotifications, document));
  if (user.role === "admin" || user.role === "moderator") {
    const reports = element("a", "button button-secondary", "Moderation");
    reports.href = "/admin/reports";
    accountActions.append(reports);
  }
  const logout = element("button", "button button-quiet", "Log out");
  logout.type = "button";
  logout.dataset.action = "logout";
  accountActions.append(logout);
}

function renderIntroduction() {
  const intro = element("section", "personal-intro");
  addHeading(intro, "Wempo's Forum", 1);
  addText(document, intro, "p", homepageIntro, "personal-intro-copy");
  const interests = element("ul", "personal-tags");
  for (const interest of homepageInterests) interests.append(element("li", "", interest));
  intro.append(interests);
  const doodle = element("span", "intro-doodle", ":3");
  doodle.setAttribute("aria-hidden", "true");
  intro.append(doodle);
  main.append(intro);
}

function renderJoinPanel() {
  const panel = createPanel("Join the conversation", "Accounts use a username and password. There is no email collection or email-based recovery.");
  panel.id = "join";
  const grid = element("div", "auth-grid");
  grid.append(
    authForm("login", "Welcome back", "Sign in"),
    authForm("register", "New around here?", "Create account"),
  );
  panel.append(grid);
  main.append(panel);
}

function renderSetupLocked() {
  const panel = createPanel(
    "First-time setup is locked",
    "The site owner must configure valid SETUP_SECRET and PASSWORD_PEPPER values in Wrangler before the first administrator can be created.",
  );
  main.append(panel);
}

function renderHomeAccess(session, setupRequired, setupConfigured) {
  if (setupRequired) {
    if (setupConfigured) main.append(setupForm());
    else renderSetupLocked();
    return;
  }
  if (!session.user) renderJoinPanel();
}

function renderHomeContent(session, data, route) {
  if (session.user) main.append(createComposer("post-create", "What's on your mind?", "Post message"));
  addHeading(main, route.name === "search" ? "Search results" : "Recent conversations", 2);
  if (route.name === "search") {
    addText(document, main, "p", `Results for “${route.query}”`, "muted");
    renderSearchResults(main, data.search);
    return;
  }
  appendPostList(main, data.feed.posts, document, session.user);
  if (!data.feed.nextBefore || data.feed.posts.length !== 20) return;
  const older = element("button", "button button-secondary", "Load older posts");
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  main.append(older);
}

function renderAccountSettings() {
  const account = document.createElement("details");
  account.className = "panel";
  account.append(element("summary", "", "Account settings"));
  const passwordPanel = createPanel("Change password", "There is no email-based recovery; choose a password you can keep safe.");
  passwordPanel.append(createForm(document, "password", [
    createInput(document, {
      id: "current-password", name: "currentPassword", label: "Current password",
      type: "password", autoComplete: "current-password", required: true, minLength: 12, maxLength: 128,
    }),
    createInput(document, {
      id: "new-password", name: "newPassword", label: "New password",
      type: "password", autoComplete: "new-password", required: true, minLength: 12, maxLength: 128,
    }),
  ], "Update password"));
  account.append(passwordPanel);
  main.append(account);
}

function renderHome(session, setupRequired, setupConfigured, data, route) {
  renderIntroduction();
  renderHomeAccess(session, setupRequired, setupConfigured);
  renderHomeContent(session, data, route);
  if (session.user) renderAccountSettings();
}
function renderSearchResults(container, results) {
  const people = createPanel("People");
  if (results.users.length) {
    const list = element("ul", "result-list");
    for (const user of results.users) {
      const item = element("li");
      const link = element("a", "", user.username);
      link.href = `/users/${encodeURIComponent(user.username)}`;
      item.append(link);
      if (user.bio) addText(document, item, "p", user.bio, "muted");
      list.append(item);
    }
    people.append(list);
  } else {
    addText(document, people, "p", "No matching people.", "empty-state");
  }
  container.append(people);
  addHeading(container, "Posts", 2);
  appendPostList(container, results.posts, document, currentUser);
}

function renderProfilePosts(profile, user) {
  addHeading(main, "Posts", 2);
  if (!profile.posts.length) {
    addText(document, main, "p", "No posts yet.", "empty-state");
    return;
  }

  const list = element("div", "post-list profile-post-list");
  list.dataset.profileUsername = profile.username;
  for (const post of profile.posts) list.append(createPostCard(post, document, user));
  main.append(list);

  if (!profile.postsNextBefore) return;
  const older = element("button", "button button-secondary", "Load older posts");
  older.type = "button";
  older.dataset.action = "load-more-profile-posts";
  older.dataset.username = profile.username;
  older.dataset.before = String(profile.postsNextBefore);
  main.append(older);
}

// Collapsible socials (plan v2.3): the details/summary wrapper lives in
// profile-editor.js (renderProfileSocials, glue-testable); open state is a
// plain `details.open = isOwnProfile` assignment — owner's own profile OPEN,
// visitors CLOSED.
function appendProfileSocials(profile, isOwnProfile) {
  const details = renderProfileSocials(document, profile, isOwnProfile);
  if (details) main.append(details);
}

// Spec §8: promote/demote is admin-only, so admins get the control on member
// profiles too. The payload's role selects the single correct form (members →
// promote, moderators → demote); admins get nothing (server 403s anyway), and
// the viewer's own profile never needs one. Handlers re-render the current
// route, so both the desk and this surface refresh after a role change.
function appendProfileRoleControls(profile, session, container) {
  if (!session.user || session.user.role !== "admin") return;
  if (session.user.id === profile.id || profile.role === "admin") return;
  const [formName, label] = profile.role === "member"
    ? ["admin-promote", "Promote to moderator"]
    : ["admin-demote", "Demote to member"];
  const form = document.createElement("form");
  form.dataset.form = formName;
  form.dataset.userId = String(profile.id);
  const button = element("button", "button button-secondary", label);
  button.type = "submit";
  form.append(button);
  container.append(form);
}

function renderProfile(profile, session) {
  const heading = element("section", "profile-heading");
  if (profile.avatarUrl) {
    const image = element("img", "avatar profile-avatar");
    image.src = profile.avatarUrl;
    image.alt = `Avatar of ${profile.username}`;
    heading.append(image);
  }
  addHeading(heading, profile.username, 1);
  // The pending-upload status comes from the session payload (the profile
  // payload does not carry avatarStatus), so only the owner sees the badge —
  // everyone else just sees the currently approved avatar.
  if (session.user?.id === profile.id && session.user.avatarStatus === "pending") {
    heading.append(element("span", "avatar-pending-badge", "Avatar awaiting review"));
  }
  appendProfileRoleControls(profile, session, heading);
  main.append(heading);
  addText(document, main, "p", profile.bio || "This member hasn't added a bio yet.", "profile-bio");
  appendProfileSocials(profile, session.user?.id === profile.id);
  if (session.user?.id === profile.id) {
    // Bio (10,000 chars) plus the ten social fields; submission re-fetches the
    // profile instead of trusting the asymmetric PATCH echo.
    renderProfileEditor(main, profile);
    const pictures = createPanel("Profile picture",
      "Uploads are reviewed by moderators before they appear publicly.");
    const avatarForm = document.createElement("form");
    avatarForm.dataset.form = "avatar";
    avatarForm.append(createInput(document, {
      id: "profile-avatar", name: "avatar", label: "Profile picture (JPEG, PNG, or WebP; up to 1 MiB)",
      type: "file", accept: "image/jpeg,image/png,image/webp", required: true,
    }));
    addSubmit(avatarForm, "Upload picture");
    pictures.append(avatarForm);
    main.append(pictures);
  }
  renderProfilePosts(profile, session.user);
}

function renderAdmin(reportData, banData, avatarData, attachmentData, user) {
  addHeading(main, "Moderation desk", 1);
  addText(document, main, "p", "Review reports, hide inappropriate posts, and manage active bans.", "page-lede");
  addHeading(main, "Open reports", 2);
  main.append(createReportQueue(reportData.reports, document, user));
  addHeading(main, "Avatars awaiting review", 2);
  main.append(createAvatarQueue(avatarData.avatars, document));
  addHeading(main, "Images awaiting review", 2);
  main.append(createAttachmentQueue(attachmentData.attachments, document));
  addHeading(main, "Active bans", 2);
  main.append(createActiveBanList(banData.bans, document));
}

async function prepareRouteContext(version) {
  const [session, setup] = await Promise.all([
    api("/api/session"),
    api("/api/setup/status"),
  ]);
  if (version !== renderVersion) return null;
  currentUser = session.user;
  setCsrfToken(session.csrfToken);
  renderAccountNavigation(session.user, session.unreadNotifications ?? 0);
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
    post: "Post",
    profile: "Profile",
    admin: "Moderation",
    notifications: "Notifications",
    setup: "First-time setup",
    "not-found": "Not found",
  };
  document.title = route.name === "home"
    ? "Wempo's Forum"
    : `${pageNames[route.name] || pageNames.home} · Wempo's Forum`;
}

function renderSetupRoute(context) {
  if (context.setupRequired) {
    if (context.setupConfigured) main.append(setupForm());
    else renderSetupLocked();
    return;
  }
  addText(document, main, "p", "First-time setup has already been completed.", "empty-state");
}

async function renderHomeRoute(route, context, version) {
  const data = route.name === "search"
    ? { search: await api(`/api/search?q=${encodeURIComponent(route.query)}`) }
    : { feed: await api("/api/posts") };
  if (version !== renderVersion) return;
  renderHome(context.session, context.setupRequired, context.setupConfigured, data, route);
}

// Suggestions board route (v2.4.1): the existing feed UI, pointed at
// /api/posts?board=suggestions — same post cards, same decorators, same
// pagination pattern, with the board's composer flag and empty-state copy.
// The general feed route is untouched; the server treats a missing board as
// 'general', so Home never changes shape.
async function renderSuggestionsRoute(context, version) {
  // api() returns the parsed body UNWRAPPED ({posts, nextBefore}), so the
  // route wraps it in the exact { feed: ... } shape renderHomeRoute builds —
  // the two feed routes stay structurally identical, and the shared
  // data.feed.* reads below are correct.
  const data = { feed: await api("/api/posts?board=suggestions") };
  if (version !== renderVersion) return;
  if (context.session.user) {
    main.append(createComposer(
      "post-create", "Share a suggestion", "Post suggestion", null, null,
      SUGGESTIONS_BOARD,
    ));
  }
  addHeading(main, "Suggestions", 2);
  appendPostList(main, data.feed.posts, document, context.session.user,
    SUGGESTIONS_EMPTY_TEXT);
  if (!data.feed.nextBefore || data.feed.posts.length !== 20) return;
  const older = element("button", "button button-secondary", "Load older suggestions");
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  older.dataset.board = SUGGESTIONS_BOARD;
  main.append(older);
}

async function renderPostRoute(route, context, version) {
  const post = await api(`/api/posts/${route.id}`);
  if (version !== renderVersion) return;
  addHeading(main, "Conversation", 1);
  main.append(createPostCard(post, document, context.session.user));
  addHeading(main, "Replies", 2);
  if (post.replies.length) {
    const replyList = element("div", "post-list replies-list");
    replyList.dataset.repliesFor = String(post.id);
    for (const reply of post.replies) replyList.append(createPostCard(reply, document, context.session.user));
    main.append(replyList);
  } else {
    addText(document, main, "p", "No replies yet.", "empty-state");
  }
  if (post.repliesNextBefore) {
    const olderReplies = element("button", "button button-secondary", "Load older replies");
    olderReplies.type = "button";
    olderReplies.dataset.action = "load-older-replies";
    olderReplies.dataset.postId = String(post.id);
    olderReplies.dataset.before = String(post.repliesNextBefore);
    main.append(olderReplies);
  }
  if (context.session.user && post.visibility !== "hidden" && !post.parent) {
    main.append(createComposer("reply", "Write a thoughtful reply", "Reply", post.id));
  }
}

async function renderProfileRoute(route, context, version) {
  const profile = await api(`/api/users/${encodeURIComponent(route.username)}`);
  if (version !== renderVersion) return;
  renderProfile(profile, context.session);
}

async function renderAdminRoute(context, version) {
  const [reports, bans, avatars, attachments] = await Promise.all([
    api("/api/admin/reports"),
    api("/api/admin/bans"),
    api("/api/admin/avatars"),
    api("/api/admin/attachments"),
  ]);
  if (version !== renderVersion) return;
  renderAdmin(reports, bans, avatars, attachments, context.session.user);
}

async function renderNotificationsRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, "Notifications", 1);
    addText(document, main, "p", "Sign in to see your notifications.", "muted");
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    main.append(signIn);
    return;
  }
  const data = await api("/api/me/notifications");
  if (version !== renderVersion) return;
  renderNotificationsPage(main, data.notifications);
}

function renderNotFoundRoute() {
  addHeading(main, "Page not found", 1);
  addText(document, main, "p", "That page isn't available.", "muted");
}

async function renderRoute(route) {
  const version = ++renderVersion;
  activeRoute = route;
  main.classList.toggle("home-page", route.name === "home");
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
    suggestions: () => renderSuggestionsRoute(context, version),
    post: () => renderPostRoute(route, context, version),
    profile: () => renderProfileRoute(route, context, version),
    admin: () => renderAdminRoute(context, version),
    notifications: () => renderNotificationsRoute(context, version),
    "not-found": () => renderNotFoundRoute(),
  };
  const renderPage = renderers[route.name] || renderNotFoundRoute;
  await renderPage();
  await renderTurnstileSlots(main);
}
function readForm(form) {
  return new FormData(form);
}

async function submitSiteSearch(text) {
  router.navigate("/?q=" + encodeURIComponent(text("q").trim()));
}

async function submitAuthForm(type, form, text) {
  const endpoint = type === "login" ? "/api/auth/login" :
    type === "register" ? "/api/auth/register" : "/api/setup";
  const credentials = { username: text("username"), password: text("password") };
  if (type === "setup") {
    credentials.setupKey = text("setupKey");
  } else {
    credentials["cf-turnstile-response"] = takeTurnstileToken(form);
    refreshTurnstile(form);
  }
  let result;
  try {
    result = await api(endpoint, { method: "POST", body: credentials });
  } catch (error) {
    // Banned accounts get a dedicated screen (spec §13): api.js copies the 403
    // body's banned/reason/expiresAt onto the error object. Credentials were
    // verified server-side before this payload exists, so showing it is safe.
    if (error.banned === true) {
      main.replaceChildren();
      renderBannedScreen(main, { reason: error.reason, expiresAt: error.expiresAt });
      setMessage();
      return;
    }
    throw error;
  }
  setCsrfToken(result.csrfToken);
  router.navigate("/");
  setMessage(type === "setup" ? "Administrator account created." : "You're signed in.");
}

async function submitNewPost(form, text) {
  // buildComposerBody picks the wire format: FormData (repeatable "images"
  // parts) when files were chosen, otherwise the exact pre-attachment JSON
  // payload. api() passes FormData straight through without a Content-Type.
  // The Suggestions composer's form dataset carries board=suggestions, riding
  // the body in whichever format wins; the home composer has no dataset flag,
  // keeping its payload exactly as before.
  const submission = buildComposerBody({
    body: text("body"),
    turnstileToken: takeTurnstileToken(form),
    files: form.composerFiles ?? [],
    board: form.dataset.board,
  });
  refreshTurnstile(form);
  const post = await api("/api/posts", { method: "POST", body: submission.body });
  router.navigate("/posts/" + post.id);
  setMessage("Your post is live.");
}

async function submitReplyForm(form, text) {
  const postId = Number(form.dataset.postId);
  const threadId = form.dataset.threadId ?? postId;
  // Same dual wire format as posts; replies are Turnstile-gated server-side
  // with action "reply".
  const submission = buildComposerBody({
    body: text("body"),
    turnstileToken: takeTurnstileToken(form),
    files: form.composerFiles ?? [],
  });
  refreshTurnstile(form);
  await api("/api/posts/" + postId + "/replies", {
    method: "POST",
    body: submission.body,
  });
  // Reply-to-reply composers remember the thread root (declared above) so the
  // rerender lands back on the conversation, not on the level-1 reply's page.
  await renderRoute({ name: "post", id: Number(threadId) });
  setMessage("Your reply was added.");
}

async function submitProfileEditorForm(form, text) {
  const socials = {};
  for (const key of SOCIAL_PLATFORM_ORDER) {
    const value = text(key).trim();
    socials[key] = value === "" ? null : value;
  }
  const invalid = invalidSocialKeys(socials);
  if (invalid.length) {
    throw new Error(`Enter a valid ${SOCIAL_LABELS[invalid[0]]} handle.`);
  }
  // bio + socials in one PATCH /api/me (64 KB route cap covers a 10000-char
  // bio). The PATCH echo is asymmetric, so the rerender below re-fetches the
  // profile from GET /api/users/:username rather than trusting the response.
  await api("/api/me", {
    method: "PATCH",
    body: { bio: text("bio"), socials },
  });
  await renderRoute({ name: "profile", username: currentUser.username });
  setMessage("Your profile was updated.");
}

async function submitAvatarForm(values) {
  const upload = new FormData();
  upload.append("avatar", values.get("avatar"));
  await api("/api/me/avatar", { method: "POST", body: upload });
  await renderRoute({ name: "profile", username: currentUser.username });
  setMessage("Your profile picture was updated.");
}

async function submitPasswordForm(text) {
  await api("/api/me/password", {
    method: "PATCH",
    body: { currentPassword: text("currentPassword"), newPassword: text("newPassword") },
  });
  await renderRoute({ name: "home" });
  setMessage("Your password was changed. Other signed-in sessions were revoked.");
}

async function submitReportForm(text) {
  await api("/api/posts/" + reportForm.dataset.postId + "/reports", {
    method: "POST",
    body: { reason: text("reason") },
  });
  reportDialog.close();
  reportForm.reset();
  setMessage("Your report was sent to the moderators.");
}

// Author edit save (v2.4): JSON {body} to PATCH /api/posts/:id (api.js adds the
// CSRF header). The server reapplies the word filter and 1,000-char cap, stores
// the masked body, stamps edited_at, and never bumps last_activity_at — over-
// limit/filter rejections 400 into the shared error bar here, with the form
// left open so the author can fix the draft. On success the route re-render
// refetches the post, so the edited body, the (edited) marker, and the closed
// form all come back from the server — never from trusting the PATCH echo.
async function submitPostEditForm(form, text) {
  await api("/api/posts/" + form.dataset.postId, {
    method: "PATCH",
    body: { body: text("body") },
  });
  await renderRoute(activeRoute);
  setMessage("Your edit was saved.");
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
  await api("/api/admin/users/" + form.dataset.userId + "/bans", {
    method: "POST",
    body: { reason: text("reason") },
  });
  await renderRoute({ name: "admin" });
  setMessage("The user was banned and their sessions revoked.");
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
    "site-search": () => submitSiteSearch(text),
    login: () => submitAuthForm("login", form, text),
    register: () => submitAuthForm("register", form, text),
    setup: () => submitAuthForm("setup", form, text),
    "post-create": () => submitNewPost(form, text),
    reply: () => submitReplyForm(form, text),
    "profile-editor": () => submitProfileEditorForm(form, text),
    avatar: () => submitAvatarForm(values),
    password: () => submitPasswordForm(text),
    report: () => submitReportForm(text),
    "post-edit": () => submitPostEditForm(form, text),
    "admin-resolve": () => submitReportResolution(form),
    "admin-ban": () => submitBanForm(form, text),
    "admin-unban": () => submitUnbanForm(form, text),
    "admin-promote": () => submitRoleChange(form, "promote", text),
    "admin-demote": () => submitRoleChange(form, "demote", text),
    "admin-avatar-approve": () => submitAvatarModeration(form, "approve"),
    "admin-avatar-reject": () => submitAvatarModeration(form, "reject"),
    "admin-attachment-approve": () => submitAttachmentModeration(form, "approve"),
    "admin-attachment-reject": () => submitAttachmentModeration(form, "reject"),
  };
  const handler = handlers[type];
  if (handler) await handler();
}

function handleInternalNavigation(event) {
  if (!isPlainLeftClick(event)) return false;
  const anchor = event.target.closest("a");
  if (!anchor || anchor.origin !== location.origin || !anchor.pathname.startsWith("/") ||
      anchor.hash || anchor.hasAttribute("download")) return false;
  event.preventDefault();
  router.navigate(anchor.pathname + anchor.search);
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
  await renderRoute(activeRoute);
}

async function toggleReplyComposer(button) {
  const postId = button.dataset.postId;
  const article = main.querySelector(`article[data-post-id="${postId}"]`);
  if (!article) return;
  const existing = main.querySelector(`[data-reply-composer-for="${postId}"]`);
  if (existing) {
    existing.remove();
    return;
  }
  // Mini composer under the level-1 reply; replies go to /api/posts/:thatId
  // with Turnstile action "reply".
  const panel = createComposer("reply", "Write a reply", "Reply", postId, "reply");
  panel.dataset.replyComposerFor = postId;
  // submitReplyForm reads the FORM's dataset (the thread root it should
  // re-render after a successful reply), not the marker panel's — so the
  // thread id must ride on the form itself or the rerender would land on the
  // level-1 reply's own detail page instead of the conversation.
  if (activeRoute.name === "post") {
    panel.querySelector("form").dataset.threadId = String(activeRoute.id);
  }
  article.after(panel);
  await renderTurnstileSlots(panel);
}

async function toggleSubReplies(button) {
  // Double-click guard: one fetch per expand; a stale in-flight request never
  // builds a duplicate container (the old one is orphaned by re-render).
  if (button.dataset.loading === "1") return;
  const postId = button.dataset.postId;
  const existing = main.querySelector(`[data-sub-replies-for="${postId}"]`);
  if (existing) {
    const hidden = existing.hasAttribute("hidden");
    if (hidden) existing.removeAttribute("hidden");
    else existing.setAttribute("hidden", "");
    button.setAttribute("aria-expanded", String(hidden));
    button.textContent = hidden
      ? `Hide ${button.dataset.replyCount} replies`
      : `Show ${button.dataset.replyCount} replies`;
    return;
  }
  button.dataset.loading = "1";
  button.disabled = true;
  try {
    const page = await api("/api/posts/" + postId + "/replies");
    // Children arrive with publicLevel 2, so createPostCard renders them without
    // further reply buttons (server forbids level-2 targets). The wrapper div
    // (grouping class + cascade treatment) is render.js's createSubReplyContainer.
    const container = createSubReplyContainer(postId, page.replies, document, currentUser);
    const article = main.querySelector(`article[data-post-id="${postId}"]`);
    if (article) article.after(container);
    button.dataset.replyCount = String(page.replies.length);
    button.setAttribute("aria-expanded", "true");
    if (page.replies.length) button.textContent = `Hide ${page.replies.length} replies`;
  } finally {
    delete button.dataset.loading;
    button.disabled = false;
  }
}

async function openNotification(button) {
  // Mark-first is idempotent server-side; navigation then re-renders the bell
  // with a fresh unread count from GET /api/session.
  await api("/api/me/notifications/" + button.dataset.notificationId + "/read", {
    method: "POST",
  });
  router.navigate("/posts/" + button.dataset.postId);
}

async function markAllNotificationsRead() {
  await api("/api/me/notifications/read-all", { method: "POST" });
  // The rerender refetches the list (and the session's unread count); the
  // local update keeps the header honest even if the route render is slowed.
  updateBell(0);
  await renderRoute({ name: "notifications" });
  setMessage("All notifications were marked read.");
}

async function submitRoleChange(form, action, text) {
  const reason = text("reason").trim();
  await api("/api/admin/users/" + form.dataset.userId + "/" + action, {
    method: "POST",
    body: reason ? { reason } : {},
  });
  // Role-change forms live on the moderation desk and on member profiles;
  // re-rendering the current route refreshes whichever surface is showing.
  await renderRoute(activeRoute);
  setMessage(action === "promote"
    ? "The member was promoted to moderator."
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

// Edit-form swap/restore (v2.4): the DOM cycle lives in render.js
// (openEditForm/closeEditForm), testable against the mock element suite.
// A second Edit click on an already-open form is a no-op (openEditForm refuses
// a duplicate), and Cancel restores the exact original body nodes — the patch
// itself only happens through the form's submit path.
function editTargetArticle(button) {
  return main.querySelector(`article[data-post-id="${button.dataset.postId}"]`);
}

function attachComposerImages(button) {
  // The paperclip button lives inside the composer's form, so `.closest("form")`
  // always resolves the right composer even with several on one page.
  const form = button.closest("form");
  const input = form?.querySelector('[data-composer-input]');
  if (input) input.click();
}

function removeComposerFile(button) {
  const form = button.closest("form");
  if (!form) return;
  const files = form.composerFiles ?? [];
  const index = Number(button.dataset.fileIndex);
  if (Number.isInteger(index) && index >= 0 && index < files.length) {
    files.splice(index, 1);
  }
  form.composerFiles = files;
  renderComposerFileStrip(form);
}

function openReportDialog(button) {
  reportForm.dataset.postId = button.dataset.postId;
  reportDialog.showModal();
  reportForm.querySelector("textarea").focus();
}

// Quote button (plan v2.3): prefill the CURRENT thread's reply composer. The
// composer is resolved with the same convention toggleReplyComposer's
// submitReplyForm path relies on — the root composer's form carries the thread
// id in data-post-id (its reply target), while an open reply-to-reply mini
// composer carries it in data-thread-id — so both spellings resolve the same
// thread composer on the detail route. On routes without a composer
// (home/search/profile) a Quote click is a silent no-op. The snippet lands
// through quotes.js's prefillQuote: textarea .value property assignment only,
// never HTML.
function quoteIntoComposer(button) {
  if (activeRoute.name !== "post") return;
  const rootId = String(activeRoute.id);
  const form =
    main.querySelector(`form[data-form="reply"][data-thread-id="${rootId}"]`) ??
    main.querySelector(`form[data-form="reply"][data-post-id="${rootId}"]`);
  if (!form) return;
  const textarea = form.querySelector("textarea");
  if (!textarea) return;
  prefillQuote(textarea, button.dataset.quoteUsername ?? "", button.dataset.quoteSnippet ?? "");
  // prefillQuote assigns .value programmatically, which fires no `input`
  // event — so the composer's live character counter (wired in forms.js to the
  // input event) would keep showing the stale pre-quote count. Dispatch the
  // event it listens for so the counter reflects the post-prefill value.
  // Over-limit prefills are NOT clamped here (clamping would silently eat the
  // user's draft). Note the actual protection: native tooLong validity only
  // covers values "last changed by a user edit" (WHATWG constraint
  // validation), so a programmatically assigned value past 1000 chars sails
  // through client validity checks and the server 400 is the only gate. The
  // stale counter above is display-only and independent of that limit.
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  form.scrollIntoView({ block: "nearest" });
}

// Click-to-expand attachments (micro-batch): the strip caps render size with
// CSS, but the stored bytes are full-size — the lightbox just swaps in the
// same versioned URL uncapped (capped only by the viewport in CSS). The
// native <dialog> supplies Escape and focus handling for free; a click
// anywhere on the dialog or its backdrop closes it (wired once at load).
function openAttachmentLightbox(button) {
  const stripImage = button.querySelector("img.post-attachment");
  if (!stripImage || !attachmentLightbox) return;
  const fullImage = attachmentLightbox.querySelector("img");
  if (!fullImage) return;
  fullImage.src = stripImage.src;
  attachmentLightbox.showModal();
}

async function loadMorePosts(button) {
  // Board-aware (v2.4.1): the suggestions route's button carries dataset.board
  // and adds the board param; the home button keeps the original URL shape.
  // The emitted cursor is board-native (score_id for suggestions), so pages
  // keep walking the same keyset they started on.
  const board = button.dataset.board;
  const older = await api("/api/posts?before=" + button.dataset.before +
    (board ? "&board=" + board : ""));
  appendPostList(main, older.posts, document, currentUser,
    board === SUGGESTIONS_BOARD ? SUGGESTIONS_EMPTY_TEXT : undefined);
  button.remove();
  if (older.posts.length !== 20 || !older.nextBefore) return;
  const next = element("button", "button button-secondary",
    board === SUGGESTIONS_BOARD ? "Load older suggestions" : "Load older posts");
  next.type = "button";
  next.dataset.action = "load-more";
  next.dataset.before = String(older.nextBefore);
  if (board) next.dataset.board = board;
  main.append(next);
}

async function loadMoreProfilePosts(button) {
  const username = button.dataset.username;
  const page = await api("/api/users/" + encodeURIComponent(username) + "?before=" + button.dataset.before);
  const list = main.querySelector(".profile-post-list");
  if (!list) throw new Error("The profile post list is no longer available. Reload the profile.");
  for (const post of page.posts) list.append(createPostCard(post, document, currentUser));
  if (page.postsNextBefore) button.dataset.before = String(page.postsNextBefore);
  else button.remove();
}

async function loadOlderReplies(button) {
  const postId = button.dataset.postId;
  const older = await api("/api/posts/" + postId + "/replies?before=" + button.dataset.before);
  const replyList = main.querySelector('.replies-list[data-replies-for="' + postId + '"]');
  if (!replyList) throw new Error("The reply list is no longer available. Reload the conversation.");
  const fragment = document.createDocumentFragment();
  for (const reply of older.replies) fragment.append(createPostCard(reply, document, currentUser));
  replyList.prepend(fragment);
  if (older.nextBefore) button.dataset.before = String(older.nextBefore);
  else button.remove();
}

async function handleButtonAction(button) {
  const handlers = {
    logout: async () => {
      await api("/api/auth/logout", { method: "POST" });
      setCsrfToken("");
      router.navigate("/");
      setMessage("You are signed out.");
    },
    reaction: () => submitReaction(button),
    report: () => openReportDialog(button),
    "close-report": () => reportDialog.close(),
    "load-more": () => loadMorePosts(button),
    "load-more-profile-posts": () => loadMoreProfilePosts(button),
    "load-older-replies": () => loadOlderReplies(button),
    "reply-to": () => toggleReplyComposer(button),
    "expand-sub-replies": () => toggleSubReplies(button),
    quote: () => quoteIntoComposer(button),
    "open-notification": () => openNotification(button),
    "mark-notifications-read": () => markAllNotificationsRead(),
    "composer-attach": () => attachComposerImages(button),
    "remove-composer-file": () => removeComposerFile(button),
    "expand-attachment": () => openAttachmentLightbox(button),
    "edit-post": () => {
      const article = editTargetArticle(button);
      if (article) openEditForm(article, document);
    },
    "cancel-edit": () => {
      const article = editTargetArticle(button);
      if (article) closeEditForm(article);
    },
  };
  const handler = handlers[button.dataset.action];
  if (handler) await handler();
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
  if (input instanceof HTMLInputElement && input.dataset.composerInput === "images") {
    handleComposerFileSelection(input);
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

// Theme resolution and the header toggle come first, before the router mounts
// the page, so the manual-choice/OS-preference decision lands with the initial
// render (the inline no-flash script already pinned a stored "dark" pre-paint).
initTheme(document, localStorage);

// Footer version stamp: "v2.2 · <short sha>", straight from /api/version.
// Both halves are server-generated and only ever reach the DOM through
// textContent. A missing half renders as nothing, and a failed fetch (offline,
// endpoint gone) leaves the tag empty — silent by design, never an error.
async function fillVersionTag() {
  const info = await api("/api/version");
  const version = typeof info?.version === "string" ? info.version.split(".") : [];
  const shortVersion = version.length > 1 ? `v${version[0]}.${version[1]}` : "";
  const commit = typeof info?.commit === "string" ? info.commit : "";
  document.querySelector("#version-tag").textContent =
    [shortVersion, commit].filter(Boolean).join(" · ");
}

fillVersionTag().catch(() => {});

router = startRouter((route) => {
  renderRoute(route).catch((error) => {
    setMessage(error.message, true);
    main.replaceChildren();
    addHeading(main, "Something went wrong", 1);
    addText(document, main, "p", error.message, "error-copy");
  });
});