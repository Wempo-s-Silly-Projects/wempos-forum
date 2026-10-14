import { createActiveBanList, createReportQueue } from "./admin.js";
import { addText, createForm, createInput, createTextarea } from "./forms.js";
import { appendPostList, createPostCard } from "./render.js";
import { homepageInterests, homepageIntro } from "./home-intro.js";

function element(document, tagName, className = "", text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function heading(document, parent, text, level = 1) {
  return addText(document, parent, `h${level}`, text, level === 1 ? "page-heading" : "");
}

function panel(document, title, description = "") {
  const section = element(document, "section", "panel");
  heading(document, section, title, 2);
  if (description) addText(document, section, "p", description, "muted");
  return section;
}

const submitButton = (document, form, label) => {
  const button = element(document, "button", "button button-primary", label);
  button.type = "submit";
}
  form.append(button);
}

function authForm(document, name, title, buttonLabel) {
  const section = element(document, "section", "auth-card");
  heading(document, section, title, 3);
  const login = name === "login";
  section.append(createForm(document, name, [
    createInput(document, {
      id: `${name}-username`,
      name: "username",
      label: "Username",
      autoComplete: "username",
      required: true,
      minLength: 3,
      maxLength: 24,
      description: "Use 3–24 letters, numbers, underscores, or hyphens.",
    }),
    createInput(document, {
      id: `${name}-password`,
      name: "password",
      label: "Password",
      type: "password",
      autoComplete: login ? "current-password" : "new-password",
      required: true,
      minLength: 12,
      maxLength: 128,
      description: "Use 12–128 characters.",
    }),
  ], buttonLabel));
  return section;
}

function setupForm(document) {
  const setup = panel(
    document,
    "Set up Wempo's Forum",
    "Create the first administrator account. This setup form disappears after the first admin is created.",
  );
  setup.append(createForm(document, "setup", [
    createInput(document, {
      id: "setup-username",
      name: "username",
      label: "Administrator username",
      autoComplete: "username",
      required: true,
      minLength: 3,
      maxLength: 24,
      description: "Use 3–24 letters, numbers, underscores, or hyphens.",
    }),
    createInput(document, {
      id: "setup-password",
      name: "password",
      label: "Password",
      type: "password",
      autoComplete: "new-password",
      required: true,
      minLength: 12,
      maxLength: 128,
      description: "Use 12–128 characters.",
    }),
  ], "Create administrator"));
  return setup;
}

function composer(document, name, label, buttonLabel, postID = null) {
  const view = panel(document, name === "post-create" ? "Start a conversation" : "Reply");
  const form = element(document, "form");
  form.dataset.form = name;
  if (postID !== null) form.dataset.postId = String(postID);
  form.append(createTextarea(document, {
    id: `${name}-body`,
    name: "body",
    label,
    rows: 4,
    maxLength: 2000,
    required: true,
    description: "Posts can be up to 2,000 characters.",
  }));
  submitButton(document, form, buttonLabel);
  view.append(form);
  return view;
}

function personalIntro(document) {
  const intro = element(document, "section", "personal-intro");
  heading(document, intro, "Wempo's Forum");
  addText(document, intro, "p", homepageIntro, "personal-intro-copy");
  const interests = element(document, "ul", "personal-tags");
  for (const interest of homepageInterests) {
    interests.append(element(document, "li", "", interest));
  }
  intro.append(interests);
  const doodle = element(document, "span", "intro-doodle", ":3");
  doodle.setAttribute("aria-hidden", "true");
  intro.append(doodle);
  return intro;
}

function accountSettings(document) {
  const account = element(document, "details", "panel");
  account.append(element(document, "summary", "", "Account settings"));
  const passwordPanel = panel(
    document,
    "Change password",
    "There is no email-based recovery; choose a password you can keep safe.",
  );
  passwordPanel.append(createForm(document, "password", [
    createInput(document, {
      id: "current-password",
      name: "currentPassword",
      label: "Current password",
      type: "password",
      autoComplete: "current-password",
      required: true,
      minLength: 12,
      maxLength: 128,
    }),
    createInput(document, {
      id: "new-password",
      name: "newPassword",
      label: "New password",
      type: "password",
      autoComplete: "new-password",
      required: true,
      minLength: 12,
      maxLength: 128,
      description: "Use 12–128 characters.",
    }),
  ], "Update password"));
  account.append(passwordPanel);
  return account;
}

function searchResults(document, results, currentUser) {
  const container = element(document, "section", "search-results");
  const people = panel(document, "People");
  if (results.users.length) {
    const list = element(document, "ul", "result-list");
    for (const user of results.users) {
      const item = element(document, "li");
      const link = element(document, "a", "", user.username);
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
  heading(document, container, "Posts", 2);
  appendPostList(container, results.posts, document, currentUser);
  return container;
}

function addPagination(document, container, feed) {
  if (!feed.nextBefore || feed.posts.length !== 20) return;
  const button = element(document, "button", "button button-secondary", "Load older posts");
  button.type = "button";
  button.dataset.action = "load-more";
  button.dataset.before = String(feed.nextBefore);
  container.append(button);
}

export function createHomeView(document, { session, setupRequired, route, feed, search }) {
  const view = element(document, "div", "home-page");
  view.append(personalIntro(document));

  if (setupRequired) {
    view.append(setupForm(document));
  } else if (!session.user) {
    const join = panel(
      document,
      "Join the conversation",
      "Accounts use a username and password. There is no email collection or email-based recovery.",
    );
    join.id = "join";
    const grid = element(document, "div", "auth-grid");
    grid.append(
      authForm(document, "login", "Welcome back", "Sign in"),
      authForm(document, "register", "New around here?", "Create account"),
    );
    join.append(grid);
    view.append(join);
  }

  if (session.user) view.append(composer(document, "post-create", "What's on your mind?", "Post message"));
  heading(document, view, route.name === "search" ? "Search results" : "Recent conversations", 2);
  if (route.name === "search") {
    addText(document, view, "p", `Results for “${route.query}”`, "muted");
    view.append(searchResults(document, search, session.user));
  } else {
    appendPostList(view, feed.posts, document, session.user);
    addPagination(document, view, feed);
  }
  if (session.user) view.append(accountSettings(document));
  return view;
}

export function createSetupView(document, setupRequired) {
  const view = element(document, "div", "setup-page");
  if (setupRequired) {
    view.append(setupForm(document));
  } else {
    heading(document, view, "Setup already complete");
    addText(document, view, "p", "First-time setup has already been completed.", "empty-state");
  }
  return view;
}

export function createPostView(document, post, session) {
  const view = element(document, "div", "post-page");
  heading(document, view, "Conversation");
  view.append(createPostCard(post, document, session.user));
  if (post.replies.length) {
    heading(document, view, "Replies", 2);
    appendPostList(view, post.replies, document, session.user);
  } else {
    addText(document, view, "p", "No replies yet.", "empty-state");
  }
  if (session.user && post.visibility !== "hidden") {
    view.append(composer(document, "reply", "Write a thoughtful reply", "Reply", post.id));
  }
  return view;
}

export function createProfileView(document, profile, session) {
  const view = element(document, "div", "profile-page");
  const header = element(document, "section", "profile-heading");
  if (profile.avatarUrl) {
    const avatar = element(document, "img", "avatar profile-avatar");
    avatar.src = profile.avatarUrl;
    avatar.alt = `Avatar of ${profile.username}`;
    header.append(avatar);
  }
  heading(document, header, profile.username);
  view.append(header);
  addText(document, view, "p", profile.bio || "This member hasn't added a bio yet.", "profile-bio");

  if (session.user?.id === profile.id) {
    const edit = panel(document, "Edit your profile");
    edit.append(createForm(document, "bio", [
      createTextarea(document, {
        id: "profile-bio",
        name: "bio",
        label: "Bio",
        rows: 3,
        maxLength: 280,
        description: "Your bio can be up to 280 characters.",
      }),
    ], "Save bio"));
    const avatarForm = element(document, "form");
    avatarForm.dataset.form = "avatar";
    avatarForm.append(createInput(document, {
      id: "profile-avatar",
      name: "avatar",
      label: "Profile picture",
      type: "file",
      accept: "image/jpeg,image/png,image/webp",
      required: true,
      description: "JPEG, PNG, or WebP; up to 2 MiB.",
    }));
    submitButton(document, avatarForm, "Upload picture");
    edit.append(avatarForm);
    view.append(edit);
  }

  heading(document, view, "Posts", 2);
  appendPostList(view, profile.posts, document, session.user);
  return view;
}

export function createAdminView(document, { reports, bans }) {
  const view = element(document, "div", "admin-page");
  heading(document, view, "Moderation desk");
  addText(document, view, "p", "Review reports, hide inappropriate posts, and manage active bans.", "page-lede");
  heading(document, view, "Open reports", 2);
  view.append(createReportQueue(reports, document));
  heading(document, view, "Active bans", 2);
  view.append(createActiveBanList(bans, document));
  return view;
}

export function createNotFoundView(document) {
  const view = element(document, "div", "not-found-page");
  heading(document, view, "Page not found");
  addText(document, view, "p", "That page isn't available.", "muted");
  return view;
}
