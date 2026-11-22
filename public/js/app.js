// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

import { api, setCsrfToken } from "./api.js";
import { i18nReady, t } from "./i18n.js";
import { addText } from "./forms.js";
import { renderBannedScreen } from "./banned.js";
import { boardLabel } from "./boards.js";
import { isPlainLeftClick, startRouter } from "./router.js";
import { buildNotFoundLinks } from "./not-found.js";
import { applyCornerPreference, initTheme } from "./theme.js";
import {
  renderTurnstileSlots,
  teardownTurnstile,
} from "./turnstile.js";
// v4.0 plan 4 Task 1: the shell singletons + panel helpers live in dom.js.
import {
  addHeading,
  clearConfirmHandler,
  confirmDialog,
  confirmBlock,
  confirmDelete,
  createPanel,
  element,
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
// The §4b door-swap: the boot-level ?wt redemption (before the router
// mounts) and every Accounts URL ride the pure sso.js helpers.
import { redeemReturnTicket, wempoAccountsSignInUrl } from "./sso.js";
// Invite links (v5.34): the /join landing and the one-time claim.
import { claimPendingInvite, createJoinPage, rememberInviteRef } from "./invite.js";
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
  renderSettingsRoute,
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
// Wave 5.14: "Sign out everywhere else" lives in account-security.js.
import { ACTIONS as accountSecurityActions } from "./account-security.js";
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
  renderWeekRoute,
  renderTagRoute,
} from "./routes/pages.js";

// v4.0 plan 4 Task 7: the appeals concern (the /appeals route and its
// submits) and the notifications concern (the /notifications route and
// its actions) live in routes/appeals.js and routes/notifications.js.
import {
  FORM_HANDLERS as appealFormHandlers,
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

// v4.0 plan 4 Task 9: the report dialog and the header chrome (mobile bar +
// site-section icons + logout) live in routes/reports.js and
// routes/account-nav.js.
import {
  ACTIONS as reportActions,
  FORM_HANDLERS as reportFormHandlers,
} from "./routes/reports.js";
import {
  ACTIONS as accountNavActions,
  renderAccountNavigation,
} from "./routes/account-nav.js";

// Blocks (v4.4): the blocked-members settings section lives in
// routes/blocks.js (rendered into the account area by routes/feed.js, like
// the two-factor section); its Unblock action merges here.
import { ACTIONS as blockActions } from "./routes/blocks.js";
// v5.39.0: member follows and bookmark folders.
import { createFollowActions } from "./follows.js";
import { createFolderActions } from "./bookmark-folders.js";
import { stopReadAloud } from "./read-aloud.js";
import { stopReadingProgress } from "./reading-progress.js";
import { applyTabUnread, normaliseTabCount, pageStorage } from "./tab-unread.js";
import { setTabBadgeCount } from "./tab-badge.js";
import { paintSourceLink } from "./source-link.js";
import { attachRecentSearches } from "./recent-searches.js";
import { wireSkipLink } from "./skip-link.js";
import { registerServiceWorker } from "./sw-register.js";
import { captureMoreFocus, restoreMoreFocus } from "./thread-actions.js";

async function prepareRouteContext(version) {
  const [sessionReply, setup] = await Promise.all([
    api("/api/session"),
    api("/api/setup/status"),
  ]);
  if (version !== state.renderVersion) return null;
  let session = sessionReply;
  // The invite claim below is a mutating POST, so the session's CSRF token
  // is stored first (v5.37 L1: set after it, the first load back from
  // sign-up sent no X-CSRF-Token and the claim was refused).
  setCsrfToken(session.csrfToken);
  // Invite links (v5.34): a ref this tab kept from /join is claimed once,
  // right after sign-in; the welcome card then names the inviter.
  if (session.user) {
    const inviter = await claimPendingInvite(api);
    if (inviter) session = { ...session, user: { ...session.user, invitedBy: inviter } };
    if (version !== state.renderVersion) return null;
  }
  state.currentUser = session.user;
  state.unreadNotifications = session.user ? normaliseTabCount(session.unreadNotifications) : 0;
  renderAccountNavigation(session.user, session.unreadNotifications ?? 0);
  return {
    session,
    setupRequired: setup.required,
    setupConfigured: setup.secretConfigured && setup.passwordSecurityConfigured,
  };
}

function setRouteTitle(route) {
  const pageNames = {
    home: t("app.siteName"),
    search: t("app.pageSearch"),
    settings: t("settings.title"),
    suggestions: t("app.pageSuggestions"),
    archive: t("app.pageArchive"),
    mine: t("app.pageMine"),
    leaderboard: t("app.pageLeaderboard"),
    rules: t("app.pageRules"),
    week: t("app.pageWeek"),
    tag: t("app.pageTag"),
    post: t("app.pagePost"),
    profile: t("app.pageProfile"),
    admin: t("app.pageAdmin"),
    appeals: t("app.pageAppeals"),
    notifications: t("app.pageNotifications"),
    bookmarks: t("app.pageBookmarks"),
    setup: t("app.pageSetup"),
    "not-found": t("app.pageNotFound"),
    join: t("join.title"),
  };
  document.title = route.name === "home"
    ? t("app.siteName")
    : route.name === "category"
      // Categories (v3.1): the title carries the category's display name.
      ? t("app.titleWithPage", { page: route.board ? boardLabel(route.board) : t("app.pageCategory") })
      : t("app.titleWithPage", { page: pageNames[route.name] || pageNames.home });
}

// Invite landing (v5.34): keep the ref for this tab, then either show the
// sign-up door (signed out) or claim it now and go home (signed in).
async function renderJoinRoute(route, context) {
  rememberInviteRef(undefined, route.ref);
  if (context.session.user) {
    await claimPendingInvite(api);
    state.router.navigate("/", { replace: true });
    return;
  }
  main.append(createJoinPage(document, wempoAccountsSignInUrl(window.location.origin)));
}

function renderNotFoundRoute() {
  // v5.2 (owner order "not found should say 404"): a large 404 above the
  // heading. The numerals are universal, so no string key; aria-hidden keeps
  // the h1 ("Page not found") as what assistive tech announces.
  const code = document.createElement("p");
  code.className = "not-found-code";
  code.setAttribute("aria-hidden", "true");
  code.textContent = "404";
  main.append(code);
  addHeading(main, t("app.notFoundHeading"), 1);
  addText(document, main, "p", t("app.notFoundBody"), "muted");
  main.append(buildNotFoundLinks(document, t, location.pathname));
}

async function renderRoute(route) {
  const version = ++state.renderVersion;
  // Read aloud (wave 2026-11-21-7): speech never outlives the page it read.
  stopReadAloud();
  // Reading progress (wave 5.26 F2): the bar and its listeners leave too.
  stopReadingProgress();
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
  applyTabUnread(document, state.unreadNotifications, pageStorage());
  setTabBadgeCount("notifications", state.unreadNotifications);

  const renderers = {
    setup: () => renderSetupRoute(context),
    home: () => renderHomeRoute(route, context, version),
    search: () => renderHomeRoute(route, context, version),
    settings: () => renderSettingsRoute(context, version),
    mine: () => renderMineRoute(context, version),
    leaderboard: () => renderLeaderboardRoute(context, version),
    rules: () => renderRulesRoute(context, version),
    week: () => renderWeekRoute(context, version),
    tag: () => renderTagRoute(route, context, version),
    category: () => renderCategoryRoute(route, context, version),
    archive: () => renderArchiveRoute(context, version),
    post: () => renderPostRoute(route, context, version),
    profile: () => renderProfileRoute(route, context, version),
    admin: () => renderAdminRoute(route, context, version),
    notifications: () => renderNotificationsRoute(context, version),
    bookmarks: () => renderBookmarksRoute(route, context, version),
    "not-found": () => renderNotFoundRoute(),
    join: () => renderJoinRoute(route, context),
  };
  const renderPage = renderers[route.name] || renderNotFoundRoute;
  try {
    await renderPage();
  } catch (error) {
    // A post that no longer exists (deleted, or a stale link/history entry)
    // is a 404 page, not an error bar (wave 5.6 F1).
    // An unknown tag (v5.44) is the same 404 page.
    if ((route.name !== "post" && route.name !== "tag") || error?.status !== 404 || version !== state.renderVersion) throw error;
    main.replaceChildren();
    renderNotFoundRoute();
  }
  await renderTurnstileSlots(main);
}

function readForm(form) {
  return new FormData(form);
}

async function submitForm(form) {
  const values = readForm(form);
  const type = form.dataset.form;
  const text = (name) => String(values.get(name) ?? "");

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
    // The two-factor confirm/disable/login step lives in routes/twofa.js.
    ...twofaFormHandlers,
  };
  const handler = handlers[type];
  // Forms this layer does not own (the chat lobby's) handle their own submit;
  // painting Saving… for them left it stuck on the status bar (wave 5.6 F3).
  if (!handler) return;
  setMessage(t("app.saving"));
  // Route-module handlers take (form, text, values); entries still owned in
  // app.js are zero-arg closures that ignore the arguments — call uniformly.
  await handler(form, text, values);
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
    // The blocked-members unblock action lives in routes/blocks.js.
    ...blockActions,
    // Follows and bookmark folders (v5.39.0).
    ...createFollowActions({ setMessage }),
    ...createFolderActions({ setMessage, prompt: (text, value) => window.prompt(text, value), confirm: (text) => window.confirm(text) }),
    // Two-factor setup lives in routes/twofa.js.
    ...twofaActions,
    // Signed-in devices (wave 5.14) live in account-security.js.
    ...accountSecurityActions,
    "confirm-block": async () => {
      if (!getConfirmHandler()) return;
      const handler = getConfirmHandler();
      // Disabled while pending: a double confirm can't fire the destructive
      // request twice while it is in flight. A REQUEST FAILURE keeps the
      // handler armed (the dialog stays open, the error bar carries the
      // message) so the user can retry the same confirm without closing the
      // dialog first; success clears it via the handler itself.
      confirmBlock.disabled = true
      try {
        await handler();
        clearConfirmHandler();
      } finally {
        confirmBlock.disabled = false
      }
    },
    "confirm-delete": async () => {
      if (!getConfirmHandler()) return;
      const handler = getConfirmHandler();
      // Disabled while pending: a double confirm can't fire the destructive
      // request twice while it is in flight. A REQUEST FAILURE keeps the
      // handler armed (the dialog stays open, the error bar carries the
      // message) so the user can retry the same confirm without closing the
      // dialog first; success clears it via the handler itself.
      confirmDelete.disabled = true
      try {
        await handler();
        clearConfirmHandler();
      } finally {
        confirmDelete.disabled = false
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
  // L5 (v5.57 review): an action inside the thread's More menu re-renders the
  // page; More reopens and focus returns to the control afterwards.
  const moreFocus = captureMoreFocus(button);
  try {
    await handleButtonAction(button);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    restoreMoreFocus(document, moreFocus);
  }
}
document.addEventListener("click", handleClick);
// v5.40.0: "Skip to content" moves focus to <main> without a URL change.
wireSkipLink(document);
// The attachment lightbox wires its own close/step listeners on first open
// (lightbox.js, wave 21); Escape is native to <dialog>.
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
  
  if (form.dataset.submitting == "true") return;

  form.dataset.submitting = "true";
  try {
    await submitForm(form);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    form.dataset.submitting = "false";
  }
});

// A banned redeem answers on the forum itself (spec §13): the boot stops
// into the ban screen — reason, expiry countdown, and the appeal form
// (whose credentials stay blank; the member fills them in) — instead of
// bouncing to Accounts, where a banned member would only ping-pong for
// fresh tickets.
function showBootBanScreen(error) {
  main.replaceChildren();
  renderBannedScreen(main, { reason: error.reason, expiresAt: error.expiresAt });
  setMessage();
}

// Every other refused redeem (the audit's fix: no catch-all redirect) stops
// the boot into the static can't-sign-in card. The Accounts link on it is
// MANUAL — a burned ticket, or a a timed-out redeem can all
// land here, and an automatic bounce would loop members cross-origin until a
// rate limiter parks them; a person clicking the link chooses the retry.
function showBootSignInCard() {
  main.replaceChildren();
  const panel = createPanel(
    t("app.signInFailedTitle"),
    t("app.signInFailedBody"),
  );
  const again = element("a", "button button-secondary sso-entry-button", t("app.signInFailedRetry"));
  again.href = wempoAccountsSignInUrl(location.origin);
  panel.append(again);
  main.append(panel);
}

// Theme storage may be unavailable in private/restricted contexts. That should
// never prevent the application state.router from running or leave the HTML shell
// stuck at its initial placeholder.
async function boot() {
  // AGPL-3.0 §13 footer link: synchronous, needs no translation or network.
  paintSourceLink(document);
  await i18nReady();
  try {
    let storage;
    try { storage = window.localStorage; }
    catch { storage = { getItem: () => null, setItem: () => {} }; }
    initTheme(document, storage);
    applyCornerPreference(document, storage);
    fillVersionTag().catch(() => {});
    // Batch K: static-asset cache + offline page, versioned by the build stamp.
    registerServiceWorker().catch(() => {});
    // The §4b door-swap: the forum has no
    // password sign-in UI anymore, so a signed-out open carrying
    // ?wt=<ticket> redeems the one-time ticket RIGHT HERE, before the
    // router mounts (the redeem must run on the forum's origin, where the
    // shared session cookie lives — including the guest session + CSRF the
    // redeem requires, which the boot probes first). A banned redeem stops
    // the boot into the ban screen; every other refusal stops it into the
    // static can't-sign-in card. redeemReturnTicket returning true means the
    // boot stops — the browser is NOT heading for the router.
    if (await redeemReturnTicket(window, api, {
      onBanned: showBootBanScreen,
      onRefused: showBootSignInCard,
      setCsrfToken,
    })) return;
    state.router = startRouter((route) => {
      renderRoute(route).catch((error) => {
        setMessage(error.message, true);
        main.replaceChildren();
        addHeading(main, t("app.errorHeading"), 1);
        addText(document, main, "p", error.message, "error-copy");
      });
    });
    // Wave 5.36: recent-search chips under the header search box (local only).
    const searchInput = document.querySelector("#search-query");
    if (searchInput) {
      attachRecentSearches(document, searchInput, {
        getAccountId: () => state.currentUser?.id ?? null,
        navigate: (path) => state.router.navigate(path),
      });
    }
  } catch (error) {
    console.error("Forum startup failed:", error);
    main.replaceChildren();
    addHeading(main, t("app.startupHeading"), 1);
    addText(document, main, "p",
      t("app.startupBody"),
      "error-copy");
  }
}

boot();

// The version tag + stale-build banner ride their own async task so a slow
// /api/version never delays the router mount.
async function fillVersionTag() {
  const info = await api("/api/version");
  const version = typeof info?.version === "string" ? info.version.split(".") : [];
  const shortVersion = version.length > 1 ? `v${version[0]}.${version[1]}` : "";
  const commit = typeof info?.commit === "string" ? info.commit : "";
  document.querySelector("#version-tag").textContent =
    [shortVersion, commit].filter(Boolean).join(" · ");
  // Stale-build notice (v4.3.1): the worker stamped the HTML with the build
  // this page was SERVED with; when the live one differs, this tab's JS is
  // an SPA-era relic and actions can misrender against the newer backend —
  // offer the reload rather than let the tab silently misbehave. No stamp
  // (older HTML, or the worker not yet deployed) never triggers the banner.
  const served = document.querySelector('meta[name="app-build"]')?.content || "";
  const live = [typeof info?.version === "string" ? info.version : "", commit].filter(Boolean).join("@");
  if (served && live && served !== live) showStaleBuildBanner();
  if (live) setInterval(() => {
    // The stamp only drifts AFTER the tab has been open across a deploy — a
    // boot-time check alone would always match. Re-check on a timer; the
    // banner shows once and stays.
    api("/api/version").then((info) => {
      const now = [typeof info?.version === "string" ? info.version : "",
        typeof info?.commit === "string" ? info.commit : ""].filter(Boolean).join("@");
      if (now && now !== served) showStaleBuildBanner();
    }).catch(() => { /* transient */ });
  }, 60_000).unref?.();
}

// The banner shows once per page load; the reload button is a plain
// location.reload() and the copy rides textContent — the CSP stays pure.
let staleBuildBannerShown = false;
function showStaleBuildBanner() {
  if (staleBuildBannerShown || document.querySelector(".stale-build-banner")) return;
  staleBuildBannerShown = true;
  const bar = document.createElement("div");
  bar.className = "stale-build-banner";
  const note = document.createElement("span");
  note.textContent = t("app.staleBanner");
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "button button-secondary";
  reload.textContent = t("app.reload");
  reload.addEventListener("click", () => location.reload());
  bar.append(note, reload);
  document.body.prepend(bar);
}
