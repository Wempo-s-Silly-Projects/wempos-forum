import { api, setCsrfToken } from "./api.js";
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

// v4.0 plan 4 Task 8: the moderation desk (the /admin route, its section
// builders, and its submits/actions) lives in routes/admin.js.
import {
  ACTIONS as adminActions,
  FORM_HANDLERS as adminFormHandlers,
  renderAdminRoute,
} from "./routes/admin.js";

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
    // The desk submits live in routes/admin.js.
    ...adminFormHandlers,
    report: () => submitReportForm(text),
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
    // The desk actions live in routes/admin.js.
    ...adminActions,
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
    "report-profile": () => openReportDialog({ type: "profile", id: button.dataset.profileId }),
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
