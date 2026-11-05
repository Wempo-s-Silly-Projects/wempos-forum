import { api, setCsrfToken } from "./api.js";
import { addText } from "./forms.js";
import { boardLabel } from "./boards.js";
import { isPlainLeftClick, startRouter } from "./router.js";
import {
  ACTIONS as chatActions,
  FORM_HANDLERS as chatFormHandlers,
  initChat,
  updateChatSession,
  renderChatRoute,
} from "./chat.js";
import { applyCornerPreference, initTheme } from "./theme.js";
import {
  renderTurnstileSlots,
  teardownTurnstile,
} from "./turnstile.js";
// v4.0 plan 4 Task 1: the shell singletons + panel helpers live in dom.js.
import {
  addHeading,
  attachmentLightbox,
  clearConfirmHandler,
  confirmDialog,
  confirmOk,
  getConfirmHandler,
  main,
  setMessage,
} from "./dom.js";
// v4.0 plan 4 Task 2: the auth concern (auth panels, setup screens, their
// submit handlers) lives in routes/auth.js; the route + form registries
// spread its handlers as the dispatch entries that used to live inline here.
import {
  FORM_HANDLERS as authFormHandlers,
  renderSetupRoute,
} from "./routes/auth.js";

// v4.0 plan 4 Task 2: the boot state lives in state.js (route modules read
// and write the same bag). renderRoute is hoisted, so it can be published
// here at module scope before any route module runs.
import { state } from "./state.js";
state.renderRoute = renderRoute;
// v4.0 plan 4 Task 3: the feed concern (home/search/mine/category/bookmarks
// routes, feed tabs, feed pagination + card actions) lives in routes/feed.js;
// the composer family (builder, submits, gif/poll dialogs) lives in
// composer.js since the plan 7 follow-up; registries spread both modules'
// handlers as dispatch entries.
import {
  ACTIONS as feedActions,
  renderBookmarksRoute,
  renderCategoryRoute,
  renderHomeRoute,
  renderMineRoute,
} from "./routes/feed.js";
import {
  ACTIONS as composerActions,
  FORM_HANDLERS as composerFormHandlers,
  handleComposerFileSelection,
  uploadCommunityGif,
} from "./routes/composer.js";
// v4.0.1: the two-factor section (settings + login step) lives in routes/twofa.js.
import {
  ACTIONS as twofaActions,
  FORM_HANDLERS as twofaFormHandlers,
} from "./routes/twofa.js";
// v4.0 profile wall: its module owns the render + the post/pin registrations.
import {
  ACTIONS as wallActions,
  FORM_HANDLERS as wallFormHandlers,
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

// v4.0 plan 4 Task 9: the report dialog, the header chrome (mobile bar +
// site-section icons + logout), and the chat panel's dispatch entries live
// in routes/reports.js, routes/account-nav.js, and chat.js.
import {
  ACTIONS as reportActions,
  FORM_HANDLERS as reportFormHandlers,
} from "./routes/reports.js";
import {
  ACTIONS as accountNavActions,
  renderAccountNavigation,
} from "./routes/account-nav.js";

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

async function submitForm(form) {
  const values = readForm(form);
  const type = form.dataset.form;
  const text = (name) => String(values.get(name) ?? "");
  setMessage("Saving…");

  const handlers = {
    ...authFormHandlers,
    // The create/reply submits live in composer.js.
    ...composerFormHandlers,
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
    // The report form lives in routes/reports.js.
    ...reportFormHandlers,
    // The chat/DM sends live in chat.js.
    ...chatFormHandlers,
    // The two-factor confirm/disable/login step lives in routes/twofa.js.
    ...twofaFormHandlers,
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

async function handleButtonAction(button) {
  const handlers = {
    // The card reactions, bookmark/subscribe toggles, and suggestion status
    // live in routes/feed.js.
    ...feedActions,
    // The composer attachment/gif/poll actions live in composer.js.
    ...composerActions,
    // Profile wall actions (v4.0).
    ...wallActions,
    // The post-detail conversation actions (incl. polls) live in routes/post.js.
    ...postActions,
    // The profile surface's actions live in routes/profile.js.
    ...profileActions,
    // The content-page actions (archive paging, rules save) live in routes/pages.js.
    ...pagesActions,
    // Notification actions live in routes/notifications.js.
    ...notificationActions,
    // The desk actions live in routes/admin.js.
    ...adminActions,
    // The report dialog lives in routes/reports.js.
    ...reportActions,
    // The header's sign-out lives in routes/account-nav.js.
    ...accountNavActions,
    // The chat/DM page actions live in chat.js.
    ...chatActions,
    // Two-factor setup lives in routes/twofa.js.
    ...twofaActions,
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
