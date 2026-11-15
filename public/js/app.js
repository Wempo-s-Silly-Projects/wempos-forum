
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
  confirmBlock,
  confirmDelete,
  getConfirmHandler,
  main,
  setMessage,
} from "./dom.js";
// v4.0 plan 4 Task 2: auth panels, setup screens and submit handlers.
import {
  FORM_HANDLERS as authFormHandlers,
  renderSetupRoute,
} from "./routes/auth.js";

// Shared application state.
import { state } from "./state.js";
state.renderRoute = renderRoute;

// Feed routes and actions.
import {
  ACTIONS as feedActions,
  renderBookmarksRoute,
  renderCategoryRoute,
  renderHomeRoute,
  renderMineRoute,
} from "./routes/feed.js";

// Composer actions and handlers.
import {
  ACTIONS as composerActions,
  FORM_HANDLERS as composerFormHandlers,
  handleComposerFileSelection,
  uploadCommunityGif,
} from "./routes/composer.js";

// Two-factor authentication.
import {
  ACTIONS as twofaActions,
  FORM_HANDLERS as twofaFormHandlers,
} from "./routes/twofa.js";

// Profile wall.
import {
  ACTIONS as wallActions,
  FORM_HANDLERS as wallFormHandlers,
} from "./wall.js";

// Post detail.
import {
  ACTIONS as postActions,
  FORM_HANDLERS as postFormHandlers,
  renderPostRoute,
} from "./routes/post.js";

// Profile routes.
import {
  ACTIONS as profileActions,
  FORM_HANDLERS as profileFormHandlers,
  renderProfileRoute,
  clearProfileTheme,
} from "./routes/profile.js";

// Content pages.
import {
  ACTIONS as pagesActions,
  FORM_HANDLERS as pagesFormHandlers,
  renderArchiveRoute,
  renderLeaderboardRoute,
  renderRulesRoute,
} from "./routes/pages.js";

// Appeals.
import {
  FORM_HANDLERS as appealFormHandlers,
} from "./routes/appeals.js";

// Notifications.
import {
  ACTIONS as notificationActions,
  renderNotificationsRoute,
} from "./routes/notifications.js";

// Moderation desk.
import {
  ACTIONS as adminActions,
  FORM_HANDLERS as adminFormHandlers,
  renderAdminRoute,
} from "./routes/admin.js";

// Reports.
import {
  ACTIONS as reportActions,
  FORM_HANDLERS as reportFormHandlers,
} from "./routes/reports.js";

// Account navigation.
import {
  ACTIONS as accountNavActions,
  renderAccountNavigation,
} from "./routes/account-nav.js";

// Blocked members.
import { ACTIONS as blockActions } from "./routes/blocks.js";

// -----------------------------------------------------------------------------
// Shared handler registries
// -----------------------------------------------------------------------------

const FORM_HANDLERS = {
  ...authFormHandlers,
  ...composerFormHandlers,
  ...wallFormHandlers,
  ...postFormHandlers,
  ...profileFormHandlers,
  ...pagesFormHandlers,
  ...appealFormHandlers,
  ...adminFormHandlers,
  ...reportFormHandlers,
  ...chatFormHandlers,
  ...twofaFormHandlers,
};

const ACTION_HANDLERS = {
  ...feedActions,
  ...composerActions,
  ...wallActions,
  ...postActions,
  ...profileActions,
  ...pagesActions,
  ...notificationActions,
  ...adminActions,
  ...reportActions,
  ...accountNavActions,
  ...chatActions,
  ...blockActions,
  ...twofaActions,

  "confirm-block": async () => {
    const handler = getConfirmHandler();
    if (!handler) return;

    // Prevent duplicate destructive requests while one is pending.
    confirmBlock.disabled = true;

    try {
      await handler();
      clearConfirmHandler();
    } finally {
      confirmBlock.disabled = false;
    }
  },

  "confirm-delete": async () => {
    const handler = getConfirmHandler();
    if (!handler) return;

    // Prevent duplicate destructive requests while one is pending.
    confirmDelete.disabled = true;

    try {
      await handler();
      clearConfirmHandler();
    } finally {
      confirmDelete.disabled = false;
    }
  },

  "confirm-cancel": () => {
    clearConfirmHandler();
    confirmDialog.close();
  },
};

// -----------------------------------------------------------------------------
// Route context
// -----------------------------------------------------------------------------

async function prepareRouteContext(version) {
  const [session, setup] = await Promise.all([
    api("/api/session"),
    api("/api/setup/status"),
  ]);

  if (version !== state.renderVersion) return null;

  state.currentUser = session.user;
  setCsrfToken(session.csrfToken);

  renderAccountNavigation(
    session.user,
    session.unreadNotifications ?? 0,
  );

  updateChatSession(session.user);

  return {
    session,
    setupRequired: setup.required,
    setupConfigured:
      setup.secretConfigured &&
      setup.passwordSecurityConfigured,
  };
}

// -----------------------------------------------------------------------------
// Page titles
// -----------------------------------------------------------------------------

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
      ? `${route.board ? boardLabel(route.board) : "Category"} · Wempo's Forum`
      : `${pageNames[route.name] || pageNames.home} · Wempo's Forum`;
}

// -----------------------------------------------------------------------------
// Route rendering
// -----------------------------------------------------------------------------

function renderNotFoundRoute() {
  addHeading(main, "Page not found", 1);
  addText(document, main, "p", "That page isn't available.", "muted");
}

async function renderRoute(route) {
  const version = ++state.renderVersion;
  state.activeRoute = route;

  main.classList.toggle("home-page", route.name === "home");

  // Clear profile-specific styling before rendering another route.
  main.classList.remove("profile-section");
  main.style.removeProperty("--profile-accent");
  main.style.removeProperty("--banner-color");
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
    admin: () => renderAdminRoute(route, context, version),
    notifications: () => renderNotificationsRoute(context, version),
    bookmarks: () => renderBookmarksRoute(context, version),
    "not-found": () => renderNotFoundRoute(),
  };

  const renderPage = renderers[route.name] || renderNotFoundRoute;

  await renderPage();

  // An older route must not render Turnstile after a newer navigation.
  if (version !== state.renderVersion) return;

  await renderTurnstileSlots(main);
}

// -----------------------------------------------------------------------------
// Form handling
// -----------------------------------------------------------------------------

function readForm(form) {
  return new FormData(form);
}

async function submitForm(form) {
  const values = readForm(form);
  const type = form.dataset.form;
  const text = (name) => String(values.get(name) ?? "");

  setMessage("Saving…");

  const handler = Object.hasOwn(FORM_HANDLERS, type)
    ? FORM_HANDLERS[type]
    : null;

  if (!handler) {
    setMessage("This form is not supported.", true);
    return;
  }

  // All route-module handlers receive (form, text, values).
  await handler(form, text, values);
}

// -----------------------------------------------------------------------------
// Internal navigation
// -----------------------------------------------------------------------------

function handleInternalNavigation(event) {
  if (!isPlainLeftClick(event)) return false;

  const anchor = event.target.closest("a");

  if (
    !anchor ||
    anchor.origin !== location.origin ||
    !anchor.pathname.startsWith("/") ||
    anchor.hash ||
    anchor.hasAttribute("download")
  ) {
    return false;
  }

  event.preventDefault();
  state.router.navigate(anchor.pathname + anchor.search);

  return true;
}

// -----------------------------------------------------------------------------
// Button actions
// -----------------------------------------------------------------------------

async function handleButtonAction(button) {
  const action = button.dataset.action;

  const handler = Object.hasOwn(ACTION_HANDLERS, action)
    ? ACTION_HANDLERS[action]
    : null;

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

// Attachment lightbox closes on an image or backdrop click.
attachmentLightbox?.addEventListener("click", () => {
  attachmentLightbox.close();
});

// -----------------------------------------------------------------------------
// File input handling
// -----------------------------------------------------------------------------

document.addEventListener("change", (event) => {
  const input = event.target;

  if (!(input instanceof HTMLInputElement)) return;

  if (input.dataset.composerInput === "images") {
    handleComposerFileSelection(input);
  } else if (input.dataset.composerInput === "gif-marketplace") {
    uploadCommunityGif(input).catch((error) => {
      setMessage(error.message, true);
    });
  }
});

// -----------------------------------------------------------------------------
// Form submission delegation
// -----------------------------------------------------------------------------

document.addEventListener("submit", async (event) => {
  const form = event.target;

  if (!(form instanceof HTMLFormElement)) return;

  event.preventDefault();

  if (form.dataset.submitting === "true") return;

  form.dataset.submitting = "true";

  try {
    await submitForm(form);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    form.dataset.submitting = "false";
  }
});

// -----------------------------------------------------------------------------
// Version information and stale-build detection
// -----------------------------------------------------------------------------

async function fillVersionTag() {
  const info = await api("/api/version");

  const version = typeof info?.version === "string"
    ? info.version.split(".")
    : [];

  const shortVersion = version.length > 1
    ? `v${version[0]}.${version[1]}`
    : "";

  const commit = typeof info?.commit === "string"
    ? info.commit
    : "";

  const versionTag = document.querySelector("#version-tag");

  if (versionTag) {
    versionTag.textContent = [shortVersion, commit]
      .filter(Boolean)
      .join(" · ");
  }

  // Compare the build served with the currently deployed build.
  const served =
    document.querySelector('meta[name="app-build"]')?.content || "";

  const live = [
    typeof info?.version === "string" ? info.version : "",
    commit,
  ].filter(Boolean).join("@");

  if (served && live && served !== live) {
    showStaleBuildBanner();
  }

  if (live) {
    setInterval(() => {
      api("/api/version")
        .then((info) => {
          const now = [
            typeof info?.version === "string" ? info.version : "",
            typeof info?.commit === "string" ? info.commit : "",
          ].filter(Boolean).join("@");

          // Do not show a warning if the original HTML had no build stamp.
          if (served && now && now !== served) {
            showStaleBuildBanner();
          }
        })
        .catch(() => {
          // A temporary version-check failure is not fatal.
        });
    }, 60_000).unref?.();
  }
}

// -----------------------------------------------------------------------------
// Stale-build banner
// -----------------------------------------------------------------------------

let staleBuildBannerShown = false;

function showStaleBuildBanner() {
  if (
    staleBuildBannerShown ||
    document.querySelector(".stale-build-banner")
  ) {
    return;
  }

  staleBuildBannerShown = true;

  const bar = document.createElement("div");
  bar.className = "stale-build-banner";

  const note = document.createElement("span");
  note.textContent =
    "The forum was updated while this page was open. Reload for the newest version.";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "button button-secondary";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => location.reload());

  bar.append(note, reload);
  document.body.prepend(bar);
}

// -----------------------------------------------------------------------------
// Application startup
// -----------------------------------------------------------------------------

try {
  let storage;

  try {
    storage = window.localStorage;
  } catch {
    storage = {
      getItem: () => null,
      setItem: () => {},
    };
  }

  initTheme(document, storage);
  applyCornerPreference(document, storage);

  // Start chat polling at boot so the online counter stays current.
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

  addText(
    document,
    main,
    "p",
    "A startup error interrupted the forum! Refresh after the site is updated.",
    "error-copy",
  );
}
