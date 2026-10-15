import { api, setCsrfToken } from "./api.js";
import { createActiveBanList, createReportQueue } from "./admin.js";
import { addText, createForm, createInput, createTextarea } from "./forms.js";
import { appendPostList, createPostCard } from "./render.js";
import { isPlainLeftClick, startRouter } from "./router.js";
import { homepageInterests, homepageIntro } from "./home-intro.js";
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

let router;
let currentUser = null;
let activeRoute = { name: "home" };
let renderVersion = 0;

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

function createComposer(name, label, buttonLabel, postID = null) {
  const panel = createPanel(name === "post-create" ? "Start a conversation" : "Reply");
  const form = document.createElement("form");
  form.dataset.form = name;
  if (postID !== null) form.dataset.postId = String(postID);
  form.append(createTextarea(document, {
    id: `${name}-body`, name: "body", label, rows: 4, maxLength: 2000, required: true,
  }));
  if (name === "post-create") addTurnstileSlot(form, "post");
  addSubmit(form, buttonLabel);
  panel.append(form);
  return panel;
}

function renderAccountNavigation(user) {
  accountActions.replaceChildren();
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
  if (user.role === "admin") {
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

function renderProfile(profile, session) {
  const heading = element("section", "profile-heading");
  if (profile.avatarUrl) {
    const image = element("img", "avatar profile-avatar");
    image.src = profile.avatarUrl;
    image.alt = `Avatar of ${profile.username}`;
    heading.append(image);
  }
  addHeading(heading, profile.username, 1);
  main.append(heading);
  addText(document, main, "p", profile.bio || "This member hasn't added a bio yet.", "profile-bio");
  if (session.user?.id === profile.id) {
    const edit = createPanel("Edit your profile");
    edit.append(createForm(document, "bio", [
      createTextarea(document, {
        id: "profile-bio", name: "bio", label: "Bio", rows: 3, maxLength: 280,
      }),
    ], "Save bio"));
    const avatarForm = document.createElement("form");
    avatarForm.dataset.form = "avatar";
    avatarForm.append(createInput(document, {
      id: "profile-avatar", name: "avatar", label: "Profile picture (JPEG, PNG, or WebP; up to 1 MiB)",
      type: "file", accept: "image/jpeg,image/png,image/webp", required: true,
    }));
    addSubmit(avatarForm, "Upload picture");
    edit.append(avatarForm);
    main.append(edit);
  }
  renderProfilePosts(profile, session.user);
}

function renderAdmin(reportData, banData) {
  addHeading(main, "Moderation desk", 1);
  addText(document, main, "p", "Review reports, hide inappropriate posts, and manage active bans.", "page-lede");
  addHeading(main, "Open reports", 2);
  main.append(createReportQueue(reportData.reports, document));
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
  renderAccountNavigation(session.user);
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
    post: "Post",
    profile: "Profile",
    admin: "Moderation",
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
  const [reports, bans] = await Promise.all([
    api("/api/admin/reports"),
    api("/api/admin/bans"),
  ]);
  if (version !== renderVersion) return;
  renderAdmin(reports, bans);
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
    post: () => renderPostRoute(route, context, version),
    profile: () => renderProfileRoute(route, context, version),
    admin: () => renderAdminRoute(context, version),
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
  const result = await api(endpoint, { method: "POST", body: credentials });
  setCsrfToken(result.csrfToken);
  router.navigate("/");
  setMessage(type === "setup" ? "Administrator account created." : "You're signed in.");
}

async function submitNewPost(form, text) {
  const credentials = { body: text("body") };
  credentials["cf-turnstile-response"] = takeTurnstileToken(form);
  refreshTurnstile(form);
  const post = await api("/api/posts", { method: "POST", body: credentials });
  router.navigate("/posts/" + post.id);
  setMessage("Your post is live.");
}

async function submitReplyForm(form, text) {
  const postId = Number(form.dataset.postId);
  await api("/api/posts/" + postId + "/replies", {
    method: "POST",
    body: { body: text("body") },
  });
  await renderRoute({ name: "post", id: postId });
  setMessage("Your reply was added.");
}

async function submitBioForm(text) {
  await api("/api/me", { method: "PATCH", body: { bio: text("bio") } });
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
    bio: () => submitBioForm(text),
    avatar: () => submitAvatarForm(values),
    password: () => submitPasswordForm(text),
    report: () => submitReportForm(text),
    "admin-resolve": () => submitReportResolution(form),
    "admin-ban": () => submitBanForm(form, text),
    "admin-unban": () => submitUnbanForm(form, text),
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
  await api("/api/posts/" + button.dataset.postId + "/reaction", {
    method: "PUT",
    body: { value: button.dataset.value },
  });
  await renderRoute(activeRoute);
}

function openReportDialog(button) {
  reportForm.dataset.postId = button.dataset.postId;
  reportDialog.showModal();
  reportForm.querySelector("textarea").focus();
}

async function loadMorePosts(button) {
  const older = await api("/api/posts?before=" + button.dataset.before);
  appendPostList(main, older.posts, document, currentUser);
  button.remove();
  if (older.posts.length !== 20 || !older.nextBefore) return;
  const next = element("button", "button button-secondary", "Load older posts");
  next.type = "button";
  next.dataset.action = "load-more";
  next.dataset.before = String(older.nextBefore);
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

router = startRouter((route) => {
  renderRoute(route).catch((error) => {
    setMessage(error.message, true);
    main.replaceChildren();
    addHeading(main, "Something went wrong", 1);
    addText(document, main, "p", error.message, "error-copy");
  });
});