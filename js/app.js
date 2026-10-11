import { api, setCsrfToken } from "./api.js";
import { createActiveBanList, createReportQueue } from "./admin.js";
import { addText, createForm, createInput, createTextarea } from "./forms.js";
import { appendPostList, createPostCard } from "./render.js";
import { startRouter } from "./router.js";
import { homepageInterests, homepageIntro } from "./home-intro.js";

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
      autoComplete: name === "login" ? "username" : "username",
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
  section.append(form);
  return section;
}

function setupForm() {
  const panel = createPanel("Set up Wempo's Forum", "Create the first administrator account. This setup form disappears after the first admin is created.");
  panel.append(createForm(document, "setup", [
    createInput(document, {
      id: "setup-username", name: "username", label: "Administrator username",
      autoComplete: "username", required: true, minLength: 3, maxLength: 24,
    }),
    createInput(document, {
      id: "setup-password", name: "password", label: "Password",
      type: "password", autoComplete: "new-password", required: true, minLength: 12, maxLength: 128,
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

function renderHome(session, setupRequired, data, route) {
  const intro = element("section", "personal-intro");
  addHeading(intro, "Wempo's Forum", 1);
  addText(document, intro, "p", homepageIntro, "personal-intro-copy");
  const interests = element("ul", "personal-tags");
  for (const interest of homepageInterests) {
    interests.append(element("li", "", interest));
  }
  intro.append(interests);
  const doodle = element("span", "intro-doodle", ":3");
  doodle.setAttribute("aria-hidden", "true");
  intro.append(doodle);
  main.append(intro);

  if (setupRequired) {
    main.append(setupForm());
  } else if (!session.user) {
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

  if (session.user) {
    main.append(createComposer("post-create", "What's on your mind?", "Post message"));
  }
  addHeading(main, route.name === "search" ? "Search results" : "Recent conversations", 2);
  if (route.name === "search") {
    addText(document, main, "p", `Results for “${route.query}”`, "muted");
    renderSearchResults(main, data.search);
  } else {
    appendPostList(main, data.feed.posts, document, session.user);
    if (data.feed.nextBefore && data.feed.posts.length === 20) {
      const older = element("button", "button button-secondary", "Load older posts");
      older.type = "button";
      older.dataset.action = "load-more";
      older.dataset.before = String(data.feed.nextBefore);
      main.append(older);
    }
  }

  if (session.user) {
    const account = document.createElement("details");
    account.className = "panel";
    const summary = element("summary", "", "Account settings");
    account.append(summary);
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
      id: "profile-avatar", name: "avatar", label: "Profile picture (JPEG, PNG, or WebP; up to 2 MiB)",
      type: "file", accept: "image/jpeg,image/png,image/webp", required: true,
    }));
    addSubmit(avatarForm, "Upload picture");
    edit.append(avatarForm);
    main.append(edit);
  }
  addHeading(main, "Posts", 2);
  appendPostList(main, profile.posts, document, session.user);
}

function renderAdmin(reportData, banData) {
  addHeading(main, "Moderation desk", 1);
  addText(document, main, "p", "Review reports, hide inappropriate posts, and manage active bans.", "page-lede");
  addHeading(main, "Open reports", 2);
  main.append(createReportQueue(reportData.reports, document));
  addHeading(main, "Active bans", 2);
  main.append(createActiveBanList(banData.bans, document));
}

async function renderRoute(route) {
  const version = ++renderVersion;
  activeRoute = route;
  main.classList.toggle("home-page", route.name === "home");
  main.replaceChildren();
  setMessage();
  const [session, setup] = await Promise.all([
    api("/api/session"),
    api("/api/setup/status"),
  ]);
  if (version !== renderVersion) return;
  currentUser = session.user;
  setCsrfToken(session.csrfToken);
  renderAccountNavigation(session.user);
  const setupRequired = setup.required;
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

  if (route.name === "setup") {
    if (setupRequired) main.append(setupForm());
    else addText(document, main, "p", "First-time setup has already been completed.", "empty-state");
    return;
  }
  if (route.name === "home" || route.name === "search") {
    const data = route.name === "search"
      ? { search: await api(`/api/search?q=${encodeURIComponent(route.query)}`) }
      : { feed: await api("/api/posts") };
    if (version !== renderVersion) return;
    renderHome(session, setupRequired, data, route);
    return;
  }
  if (route.name === "post") {
    const post = await api(`/api/posts/${route.id}`);
    if (version !== renderVersion) return;
    addHeading(main, "Conversation", 1);
    main.append(createPostCard(post, document, session.user));
    if (post.replies.length) appendPostList(main, post.replies, document, session.user);
    else addText(document, main, "p", "No replies yet.", "empty-state");
    if (session.user && post.visibility !== "hidden") {
      main.append(createComposer("reply", "Write a thoughtful reply", "Reply", post.id));
    }
    return;
  }
  if (route.name === "profile") {
    const profile = await api(`/api/users/${encodeURIComponent(route.username)}`);
    if (version !== renderVersion) return;
    renderProfile(profile, session);
    return;
  }
  if (route.name === "admin") {
    const [reports, bans] = await Promise.all([
      api("/api/admin/reports"),
      api("/api/admin/bans"),
    ]);
    if (version !== renderVersion) return;
    renderAdmin(reports, bans);
    return;
  }
  if (route.name === "not-found") {
    addHeading(main, "Page not found", 1);
    addText(document, main, "p", "That page isn't available.", "muted");
  }
}

function readForm(form) {
  return new FormData(form);
}

async function submitForm(form) {
  const values = readForm(form);
  const type = form.dataset.form;
  const text = (name) => String(values.get(name) ?? "");
  setMessage("Saving…");

  if (type === "site-search") {
    router.navigate(`/?q=${encodeURIComponent(text("q").trim())}`);
    return;
  }
  if (type === "login" || type === "register" || type === "setup") {
    const endpoint = type === "login" ? "/api/auth/login" :
      type === "register" ? "/api/auth/register" : "/api/setup";
    const result = await api(endpoint, {
      method: "POST",
      body: { username: text("username"), password: text("password") },
    });
    setCsrfToken(result.csrfToken);
    router.navigate("/");
    setMessage(type === "setup" ? "Administrator account created." : "You're signed in.");
    return;
  }
  if (type === "post-create") {
    const post = await api("/api/posts", { method: "POST", body: { body: text("body") } });
    router.navigate(`/posts/${post.id}`);
    setMessage("Your post is live.");
    return;
  }
  if (type === "reply") {
    await api(`/api/posts/${form.dataset.postId}/replies`, {
      method: "POST",
      body: { body: text("body") },
    });
    await renderRoute({ name: "post", id: Number(form.dataset.postId) });
    setMessage("Your reply was added.");
    return;
  }
  if (type === "bio") {
    await api("/api/me", { method: "PATCH", body: { bio: text("bio") } });
    await renderRoute({ name: "profile", username: currentUser.username });
    setMessage("Your profile was updated.");
    return;
  }
  if (type === "avatar") {
    const upload = new FormData();
    upload.append("avatar", values.get("avatar"));
    await api("/api/me/avatar", { method: "POST", body: upload });
    await renderRoute({ name: "profile", username: currentUser.username });
    setMessage("Your profile picture was updated.");
    return;
  }
  if (type === "password") {
    await api("/api/me/password", {
      method: "PATCH",
      body: { currentPassword: text("currentPassword"), newPassword: text("newPassword") },
    });
    await renderRoute({ name: "home" });
    setMessage("Your password was changed. Other signed-in sessions were revoked.");
    return;
  }
  if (type === "report") {
    await api(`/api/posts/${reportForm.dataset.postId}/reports`, {
      method: "POST",
      body: { reason: text("reason") },
    });
    reportDialog.close();
    reportForm.reset();
    setMessage("Your report was sent to the moderators.");
    return;
  }
  if (type === "admin-resolve") {
    await api(`/api/admin/reports/${form.dataset.reportId}/resolve`, {
      method: "POST",
      body: { action: form.dataset.action },
    });
    await renderRoute({ name: "admin" });
    setMessage("The report was updated.");
    return;
  }
  if (type === "admin-ban") {
    await api(`/api/admin/users/${form.dataset.userId}/bans`, {
      method: "POST",
      body: { reason: text("reason") },
    });
    await renderRoute({ name: "admin" });
    setMessage("The user was banned and their sessions revoked.");
    return;
  }
  if (type === "admin-unban") {
    await api(`/api/admin/users/${form.dataset.userId}/bans`, {
      method: "DELETE",
      body: { reason: text("reason") },
    });
    await renderRoute({ name: "admin" });
    setMessage("The ban was lifted.");
  }
}

async function handleClick(event) {
  const anchor = event.target.closest("a");
  if (anchor && anchor.origin === location.origin && anchor.pathname.startsWith("/") &&
      !anchor.hash && !anchor.hasAttribute("download")) {
    event.preventDefault();
    router.navigate(`${anchor.pathname}${anchor.search}`);
    return;
  }
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      setCsrfToken("");
      router.navigate("/");
      setMessage("You are signed out.");
    } else if (action === "reaction") {
      await api(`/api/posts/${button.dataset.postId}/reaction`, {
        method: "PUT",
        body: { value: button.dataset.value },
      });
      await renderRoute(activeRoute);
    } else if (action === "report") {
      reportForm.dataset.postId = button.dataset.postId;
      reportDialog.showModal();
      reportForm.querySelector("textarea").focus();
    } else if (action === "close-report") {
      reportDialog.close();
    } else if (action === "load-more") {
      const older = await api(`/api/posts?before=${button.dataset.before}`);
      appendPostList(main, older.posts, document, currentUser);
      button.remove();
      if (older.posts.length === 20 && older.nextBefore) {
        const next = element("button", "button button-secondary", "Load older posts");
        next.type = "button";
        next.dataset.action = "load-more";
        next.dataset.before = String(older.nextBefore);
        main.append(next);
      }
    }
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