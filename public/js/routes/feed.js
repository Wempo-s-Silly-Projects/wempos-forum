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

// v4.0 plan 4 Task 3: the feed concern — home/search/mine/category/bookmarks
// routes, the feed tabs, and the feed's pagination. Bodies moved verbatim
// out of app.js; the renderRoute and bare renderRoute calls inside moved
// bodies re-read the boot state through the bag (state.renderRoute). The
// composer family (builder, submits, gif/poll dialogs) lives in composer.js
// since the plan 7 follow-up; createComposer's consumers import it there.
import { addText, createForm, createInput } from "../forms.js";
import { api } from "../api.js";
import {
  addHeading,
  createPanel,
  element,
  main,
  setMessage,
} from "../dom.js";
import { state } from "../state.js";
import { renderHomeAccess } from "./auth.js";
import { renderTotpSettings } from "./twofa.js";
import { renderAccountSecurity } from "../account-security.js";
import { renderBlockedSettings } from "./blocks.js";
import { renderFollowingSettings } from "../follows.js";
import { renderNotificationPrefs } from "../notification-prefs.js";
import { createFolderFilter, createFolderManage, decorateSavedCards, folderAdder, folderItemsPath, FOLDERS_PATH } from "../bookmark-folders.js";
import { createComposer } from "./composer.js";
// The §4b door-swap: the guests' sign-in prompts (mine/bookmarks gates) are
// the Accounts handoff — the join panel they used to point at is gone.
import { wempoAccountsSignInUrl } from "../sso.js";
import { appendPostList } from "../render.js";
import { maskSpoilers } from "../markdown.js";
import { appendHighlighted } from "../search-highlight.js";
import { SEARCH_SECTION_IDS, createSearchSummary } from "../search-summary.js";
import { createSearchFilters, searchApiPath } from "../search-filters.js";
import { BOARDS, BOARD_BY_SLUG, composerBoardChoices } from "../boards.js";
import { homepageInterests, homepageIntro } from "../home-intro.js";
import { t } from "../i18n.js";
import { createTextSizePicker } from "../text-size.js";
import { createEasyReadingToggle, createLineSpacingPicker, createLinkUnderlineToggle } from "../reading-comfort.js";
import { createContrastPicker } from "../high-contrast.js";
import { applyTabUnread, createTabUnreadToggle } from "../tab-unread.js";
import { createQuietHoursControls } from "../quiet-hours.js";
import { createAppearanceReset } from "../appearance-reset.js";
import { createBoardRegulars } from "../board-regulars.js";
import { createDataExportPanel, downloadMyData } from "../data-export.js";
import { addSectionAnchors, createSettingsFilter } from "../settings-tools.js";
import { createQotdBanner, createShowcaseGallery } from "../traditions.js";
import { createNewestMembers, createWeekLink } from "../week.js";
import { renderNewcomerCards } from "../newcomer.js";
import { createInvitePanel } from "../invite.js";
import { createFeedViews, feedViewEmptyText, feedViewQuery } from "../feed-views.js";
import { numberSuggestionCards } from "../suggestion-rank.js";
import { createFeedEnd, reachedFeedEnd } from "../feed-end.js";
import {
  createRemoveSavedBoard,
  createSavedBoardFilter,
  removedSavedMessage,
  removeSavedBoard,
  savedEmptyText,
  savedListPath,
} from "../saved-boards.js";

// Suggestions board (v2.4.1): the /suggestions route reuses the feed UI, so
// its composer tags root posts with board=suggestions (form dataset flag read
// by submitNewPost) and its empty state speaks the board's copy.
const SUGGESTIONS_BOARD = "suggestions";
const suggestionsEmptyText = () => t("feed.suggestionsEmpty");

function renderIntroduction() {
  const intro = element("section", "personal-intro");
  addHeading(intro, t("feed.introTitle"), 1);
  addText(document, intro, "p", homepageIntro(), "personal-intro-copy");
  const interests = element("ul", "personal-tags");
  for (const interest of homepageInterests()) interests.append(element("li", "", interest));
  intro.append(interests);
  const doodle = element("span", "intro-doodle", ":3");
  doodle.setAttribute("aria-hidden", "true");
  intro.append(doodle);
  main.append(intro);
}

function renderHomeContent(session, data, route) {
  if (session.user && route.name === "home") {
    // Newcomer cards (wave 2026-11-21-20): welcome for new accounts, then the
    // tips card; each dismissible, remembered in this browser only.
    const newcomerSlot = element("div", "newcomer-slot");
    main.append(newcomerSlot);
    renderNewcomerCards(document, newcomerSlot, session.user);
    // My posts (v2.5): a tab pair right above the composer (owner spec — NOT
    // a top-bar item, and home only: the search route shares this builder but
    // gets no tabs, per the review). Real routes so tabs are anchors —
    // internal navigation, shareable URLs, working back button. Categories
    // (v3.1) widened the pair: Recent activity, My posts, and every category.
    main.append(renderFeedTabs("all"));
    // The home composer picks its category from a select (members post in
    // every category; the staff-only Updates category appears for staff
    // alone — the server 403s everyone else regardless).
    main.append(createComposer("post-create", t("feed.composerLabel"), t("feed.postMessage"),
      null, null, null, composerBoardChoices(session.user)));
  }
  // Recent activity (v3.1): the homepage mixes every category, 10 posts at a
  // time (the server's no-board feed page size).
  if (route.name === "home") {
    renderTodaysQotd();
    renderHomeHighlights();
  }
  addHeading(main, route.name === "search" ? t("feed.searchResults") : t("feed.recentActivity"), 2);
  if (route.name === "search") {
    addText(document, main, "p", t("feed.searchResultsFor", { query: route.query }), "muted");
    // Wave 5.36: date-range and sort chips (shareable via ?since=&sort=).
    main.append(createSearchFilters(document, route));
    renderSearchResults(main, data.search, route.query);
    return;
  }
  // Feed views (wave 33): Active / Newest / Unanswered chips under the heading.
  main.append(createFeedViews(document, "/", route.view));
  appendPostList(main, data.feed.posts, document, session.user, feedViewEmptyText(route.view));
  if (!data.feed.nextBefore) return;
  const older = element("button", "button button-secondary", t("feed.loadOlderPosts"));
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  if (route.view) older.dataset.view = route.view;
  main.append(older);
}
function renderAccountSettings(session) {
  const account = document.createElement("details");
  account.className = "panel";
  // v4.23: the area carries its own title (it used to render the browser's
  // bare "Details" label).
  const summary = document.createElement("summary");
  summary.className = "settings-summary";
  summary.textContent = t("settings.title");
  account.append(summary);
  // Appearance: the square-corners pref (v2.5) - a checkbox in the account
  // settings panel; stored client-side like the theme choice.
  const corners = document.createElement("label");
  corners.className = "corner-pref";
  const cornersBox = document.createElement("input");
  cornersBox.type = "checkbox";
  try { cornersBox.checked = window.localStorage.getItem("forum-corners") === "square"; } catch { /* storage blocked: keep the default */ }
  cornersBox.dataset.actionPref = "corners";
  corners.append(cornersBox, document.createTextNode(" " + t("feed.squareCorners")));
  cornersBox.addEventListener("change", () => {
    const square = cornersBox.checked;
    try { window.localStorage.setItem("forum-corners", square ? "square" : "round"); } catch { /* storage blocked: the pref stays session-only */ }
    document.documentElement.dataset.corners = square ? "square" : "round";
  });
  // Appearance panel (wave 2026-11-21-4): the corners checkbox and the
  // reader text size, both stored only in this browser.
  const appearance = createPanel(t("feed.appearanceTitle"), t("feed.appearanceNote"));
  let storage = null;
  try { storage = window.localStorage; } catch { /* storage blocked: storage stays null */ }
  // Wave 5.3: plus the opt-in unread count in the browser tab title; wave
  // 5.7 F3: then one button that puts the panel's choices back to defaults.
  appearance.append(corners, createTextSizePicker(document, storage),
    createTabUnreadToggle(document, storage, () => state.unreadNotifications));
  appearance.append(createAppearanceReset(document, storage, appearance));
  account.append(appearance);
  // Reading comfort (wave 5.27): line spacing, always-underline links and
  // high contrast, this browser only. Its own panel so Reset appearance
  // (which pins exactly corners, text size and the tab count) leaves it be.
  const readingComfort = createPanel(t("readingComfort.title"), t("readingComfort.help"));
  readingComfort.append(createLineSpacingPicker(document, storage));
  addText(document, readingComfort, "p", t("readingComfort.lineSpacingHelp"), "muted reading-comfort-help");
  readingComfort.append(createLinkUnderlineToggle(document, storage));
  addText(document, readingComfort, "p", t("readingComfort.underlineLinksHelp"), "muted reading-comfort-help");
  readingComfort.append(createEasyReadingToggle(document, storage));
  addText(document, readingComfort, "p", t("readingComfort.easyReadingHelp"), "muted reading-comfort-help");
  readingComfort.append(createContrastPicker(document, storage, window));
  addText(document, readingComfort, "p", t("readingComfort.contrastHelp"), "muted reading-comfort-help");
  account.append(readingComfort);
  // Quiet hours (wave 5.25 F2): opt-in, this device only; a change re-checks
  // the tab title at once.
  const quietHours = createPanel(t("quietHours.title"), t("quietHours.help"));
  quietHours.append(createQuietHoursControls(document, storage, {
    onChange: () => applyTabUnread(document, state.unreadNotifications, storage),
  }));
  account.append(quietHours);
  // Notification preferences (v5.40.0): one checkbox per kind, saved on the
  // server (it skips muted kinds when notifications are created).
  renderNotificationPrefs(account);

  const passwordPanel = createPanel(t("feed.changePasswordTitle"), t("feed.changePasswordNote"));
  passwordPanel.append(createForm(document, "password", [
    createInput(document, {
      id: "current-password", name: "currentPassword", label: t("feed.currentPassword"),
      type: "password", autoComplete: "current-password", required: true, minLength: 12, maxLength: 128,
    }),
    createInput(document, {
      id: "new-password", name: "newPassword", label: t("feed.newPassword"),
      type: "password", autoComplete: "new-password", required: true, minLength: 12, maxLength: 128,
    }),
  ], t("feed.updatePassword")));
  account.append(passwordPanel);
  // Delete account control (v2.4.1 feature): lives in the signed-in account
  // settings area only (this renderer never runs for guests), confirming
  // through the shared confirm dialog whose copy spells out the blast radius —
  // including other people's replies inside the account's own threads — before
  // anything is sent. The confirm button is disabled while the request is
  // pending (see the confirm-ok handler).
  // Two-factor sign-in (v4.0.1): the section lives in routes/twofa.js — the
  // off branch stages an authenticator secret, the on branch takes a disable
  // code. No recovery exists, by the feature's own spec.
  renderTotpSettings(account, session);
  // Wave 5.14: backup codes left (fills the 2FA backup panel) + signed-in
  // devices with "Sign out everywhere else" (public/js/account-security.js).
  renderAccountSecurity(account);
  // Blocks (v4.4): the blocked-members list + Unblock controls ride the
  // account settings area right after the two-factor section.
  renderBlockedSettings(account, session);
  // Follows (v5.39.0): the member's own Following list with Unfollow.
  renderFollowingSettings(account, session);
  // Invisible-mode toggle (day-2 misc): the roster honors presence.invisible
  // server-side; this is the member-facing seat. The read arm is the FLAG-LESS
  // heartbeat POST /api/presence (who-online.js already sends it) — its
  // response carries the stored invisible flag back, so the pair marks the
  // member's current choice straight from the server, never a localStorage
  // guess; a failed read just leaves both buttons unmarked. No roster wiring
  // rides here: an invisible member drops off the list on its next refresh.
  renderInvisibleToggle(account);
  // Download my data (v4.23): explicit button; nothing is fetched until the
  // member presses it.
  account.append(createDataExportPanel(document));
  // Invite a friend (v5.34): the member's own /join?ref= link + Copy.
  account.append(createInvitePanel(document, window.location.origin, session.user.username));
  const deletePanel = createPanel(t("feed.deleteAccountTitle"), t("feed.deleteAccountNote"));
  const deleteButton = element("button", "button button-danger", t("feed.deleteAccount"));
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-account";
  deletePanel.append(deleteButton);
  account.append(deletePanel);
  // v4.23: every section is appended synchronously above, so the anchors,
  // the jump list and the filter see the whole set right after the title.
  const panels = Array.from(account.querySelectorAll(":scope > section.panel"));
  const jumpNav = addSectionAnchors(document, panels);
  summary.after(createSettingsFilter(document, panels, jumpNav), jumpNav);
  main.append(account);
}

function renderHome(session, setupRequired, setupConfigured, data, route) {
  renderIntroduction();
  renderHomeAccess(session, setupRequired, setupConfigured);
  renderHomeContent(session, data, route);
  if (session.user) renderAccountSettings(session);
}

// The invisible toggle's two buttons (visible / invisible), each carrying its
// own flag in dataset.invisible so ONE action handler serves both arms. The
// active button is marked aria-pressed + the shared highlight class; the mark
// comes from wherever the latest truth came from (the heartbeat's echo on
// visit, the write response after a click).
const presenceInvisibleMark = (choice, toggles) => {
  for (const toggle of toggles) {
    toggle.setAttribute("aria-pressed",
      String(toggle.dataset.invisible === String(choice)));
  }
};

function renderInvisibleToggle(account) {
  const panel = createPanel(t("feed.presenceTitle"), t("feed.presenceNote"));
  const toggles = element("div", "presence-toggle");
  const visibleButton = element("button", "button button-secondary presence-invisible-toggle",
    t("feed.presenceVisible"));
  visibleButton.type = "button";
  visibleButton.dataset.action = "presence-invisible";
  visibleButton.dataset.invisible = "0";
  const invisibleButton = element("button", "button button-secondary presence-invisible-toggle",
    t("feed.presenceInvisible"));
  invisibleButton.type = "button";
  invisibleButton.dataset.action = "presence-invisible";
  invisibleButton.dataset.invisible = "1";
  toggles.append(visibleButton, invisibleButton);
  panel.append(toggles);
  account.append(panel);
  // The read arm: the flag-less heartbeat carries the stored flag back. On
  // failure the pair stays unmarked — the click still works, nothing breaks.
  api("/api/presence", { method: "POST", body: {} })
    .then((data) => presenceInvisibleMark(data.invisible ? 1 : 0,
      account.querySelectorAll(".presence-invisible-toggle")))
    .catch(() => {});
}
function renderSearchResults(container, results, query = "") {
  // Wave 5.9 F2: the "Jump to:" row (null when nothing matched).
  const summary = createSearchSummary(document, results, (id) => document.getElementById(id));
  if (summary) container.append(summary);
  // Deep reply results (v2.5): a Replies section under the Posts one.
  if (Array.isArray(results.replies)) {
    addHeading(container, t("feed.repliesTitle"), 2).id = SEARCH_SECTION_IDS.replies;
    if (!results.replies.length) {
      addText(document, container, "p", t("feed.noReplyMatches"), "empty-state");
    } else {
      const replyList = element("div", "reply-search-results");
      for (const reply of results.replies) {
        const miniCard = element("article", "reply-search-card");
        miniCard.append(element("a", "reply-search-thread",
          reply.parent ? t("feed.replyThreadByParent") : t("feed.replyThreadBySomeone")));
        const bodyBlock = element("p", "reply-search-body");
        // Mask first, then highlight: a search hit never reveals a spoiler.
        appendHighlighted(document, bodyBlock, maskSpoilers(reply.body), query);
        const link = element("a", "button button-quiet", t("feed.openThread"));
        link.href = "/posts/" + reply.threadId;
        link.setAttribute("data-app-link", "");
        miniCard.append(bodyBlock, link);
        replyList.append(miniCard);
      }
      container.append(replyList);
    }
  }
  const people = createPanel(t("feed.peopleTitle"));
  people.id = SEARCH_SECTION_IDS.people;
  if (results.users.length) {
    const list = element("ul", "result-list");
    for (const user of results.users) {
      const item = element("li");
      const link = appendHighlighted(document, element("a", ""), user.username, query);
      link.href = `/users/${encodeURIComponent(user.username)}`;
      item.append(link);
      if (user.bio) addText(document, item, "p", user.bio, "muted");
      list.append(item);
    }
    people.append(list);
  } else {
    addText(document, people, "p", t("feed.noUserMatches"), "empty-state");
  }
  container.append(people);
  addHeading(container, t("feed.postsTitle"), 2).id = SEARCH_SECTION_IDS.posts;
  appendPostList(container, results.posts, document, state.currentUser);
}
async function renderHomeRoute(route, context, version) {
  const data = route.name === "search"
    ? { search: await api(searchApiPath(route)) }
    : { feed: await api("/api/posts" + (feedViewQuery(route.view) ? "?" + feedViewQuery(route.view) : "")) };
  if (version !== state.renderVersion) return;
  renderHome(context.session, context.setupRequired, context.setupConfigured, data, route);
}

// Suggestions board route (v2.4.1): the existing feed UI, pointed at
// /api/posts?board=suggestions — same post cards, same decorators, same
// pagination pattern, with the board's composer flag and empty-state copy.
// The general feed route is untouched; the server treats a missing board as
// 'general', so Home never changes shape.
// My posts (v2.5): the tab pair above the composer — anchors styled as tabs;
// the active tab is aria-selected (the owner's "right above the start a
// conversation box" placement, not a top-bar item).
function renderFeedTabs(active) {
  const tabs = element("div", "feed-tabs");
  // Categories (v3.1, tab style): the tab pair above the composer is the
  // category navigation — Recent activity (every category mixed, 10 at a
  // time), My posts, then each category as its own route. `active` is the
  // category slug on category pages ("all" home, "mine" on /mine); a slug
  // match highlights that category's tab.
  const spec = [
    ["/", t("feed.recentActivity"), active === "all"],
    ["/mine", t("feed.myPosts"), active === "mine"],
    ...BOARDS.map((board) => ["/c/" + board.slug, board.label, active === board.slug]),
  ];
  for (const [href, label, isActive] of spec) {
    const tab = element("a", "feed-tab", label);
    tab.href = href;
    tab.setAttribute("data-app-link", "");
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tabs.append(tab);
  }
  return tabs;
}
async function renderMineRoute(context, version) {
  if (!context.session.user) {
    // A hand-typed /mine URL while signed out: a sign-in prompt, not an error.
    addHeading(main, t("feed.myPosts"), 2);
    addText(document, main, "p", t("feed.signInMine"), "muted");
    const signIn = element("a", "button button-secondary", t("common.signIn"));
    signIn.href = wempoAccountsSignInUrl(location.origin);
    main.append(signIn);
    return;
  }
  const data = { feed: await api("/api/posts?mine=1") };
  if (version !== state.renderVersion) return;
  main.append(renderFeedTabs("mine"));
  main.append(createComposer("post-create", t("feed.composerLabel"), t("feed.postMessage")));
  addHeading(main, t("feed.myPosts"), 2);
  appendPostList(main, data.feed.posts, document, context.session.user);
  if (!data.feed.nextBefore || data.feed.posts.length !== 20) return;
  const older = element("button", "button button-secondary", t("feed.loadOlderPosts"));
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  older.dataset.mine = "1";
  main.append(older);
}
// Category routes (v3.1, tab style): /c/<slug> (plus the /suggestions alias).
// One renderer for every category — the tab pair with this category active, a
// composer locked to the category (signed-in only, and staff-only on
// Updates), and the board's feed. Suggestions keeps its score sort
// server-side and carries the resolved/declined chips + staff status
// controls through the post payloads.
async function renderCategoryRoute(route, context, version) {
  const board = BOARD_BY_SLUG[route.board];
  // api() returns the parsed body UNWRAPPED ({posts, nextBefore}), so the
  // route wraps it in the exact { feed: ... } shape renderHomeRoute builds —
  // the feed routes stay structurally identical, and the shared
  // data.feed.* reads below are correct.
  const viewQuery = feedViewQuery(route.view);
  const data = { feed: await api("/api/posts?board=" + encodeURIComponent(board.slug) +
    (viewQuery ? "&" + viewQuery : "")) };
  if (version !== state.renderVersion) return;
  main.append(renderFeedTabs(board.slug));
  const user = context.session.user;
  const isStaff = Boolean(user && (user.role === "owner" || user.role === "admin"));
  if (user && (!board.staffOnly || isStaff)) {
    main.append(createComposer(
      "post-create",
      board.staffOnly ? t("feed.postSiteUpdate") : t("feed.startThreadIn", { board: board.label }),
      board.staffOnly ? t("feed.postUpdate") : t("feed.postMessage"),
      null, null, board.slug,
    ));
  }
  addHeading(main, board.label, 2);
  addText(document, main, "p", board.blurb, "muted");
  const regulars = board.staffOnly ? null : createBoardRegulars(document, data.feed.posts);
  if (regulars) main.append(regulars);
  if (board.slug === "showcase") renderShowcaseGallery();
  // Feed views (wave 33): not on Suggestions, which has its own order.
  if (board.slug !== SUGGESTIONS_BOARD) main.append(createFeedViews(document, "/c/" + board.slug, route.view));
  appendPostList(main, data.feed.posts, document, user,
    board.slug === SUGGESTIONS_BOARD
      ? suggestionsEmptyText()
      : (feedViewEmptyText(route.view) || t("feed.categoryEmpty", { board: board.label })));
  // Suggestion rank (wave 34): each card shows its place in the vote order.
  if (board.slug === SUGGESTIONS_BOARD) numberSuggestionCards(document, main);
  if (!data.feed.nextBefore) return;
  const older = element("button", "button button-secondary", t("feed.loadOlderPosts"));
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  older.dataset.board = board.slug;
  if (route.view) older.dataset.view = route.view;
  main.append(older);
}

// Community traditions (wave 2026-11-21-14). Both slots are appended
// synchronously (so they keep their place above the list) and filled after
// the fetch, re-checking renderVersion so a fast route switch never paints
// into the next page. No QOTD today removes the slot; a failed gallery read
// says so in place.
async function renderTodaysQotd() {
  const slot = element("div", "qotd-slot");
  main.append(slot);
  const version = state.renderVersion;
  let data;
  try {
    data = await api("/api/traditions/qotd");
  } catch {
    slot.remove();
    return;
  }
  if (version !== state.renderVersion) return;
  if (!data?.qotd) {
    slot.remove();
    return;
  }
  slot.append(createQotdBanner(document, data.qotd));
}

// v5.35: the link to /week and the "Newest members" list, home only. The
// slot keeps its place above the list; a failed or empty member read just
// leaves the link.
async function renderHomeHighlights() {
  const slot = element("div", "home-highlights");
  slot.append(createWeekLink(document));
  main.append(slot);
  const version = state.renderVersion;
  let data;
  try {
    data = await api("/api/members/newest");
  } catch {
    return;
  }
  if (version !== state.renderVersion) return;
  const members = createNewestMembers(document, data?.members);
  if (members) slot.append(members);
}

async function renderShowcaseGallery() {
  const panel = createPanel(t("traditions.galleryTitle"));
  panel.classList.add("showcase-gallery-panel");
  main.append(panel);
  const version = state.renderVersion;
  let data;
  try {
    data = await api("/api/traditions/showcase");
  } catch {
    if (version === state.renderVersion) panel.append(element("p", "empty-state", t("traditions.galleryLoadFailed")));
    return;
  }
  if (version !== state.renderVersion) return;
  panel.append(createShowcaseGallery(document, Array.isArray(data?.items) ? data.items : [], data?.staffPick || null));
}

// Bookmarks (C4): the private "Saved" page — the member's own saved list.
// Guests get a sign-in prompt (the API 401s the private list regardless).
// Wave 36: board chips + "Remove all saved from <board>" (saved-boards.js).
function appendOlderSaved(board, nextBefore, folder) {
  const older = element("button", "button button-secondary", t("feed.loadOlderSaved"));
  older.type = "button";
  older.dataset.action = "load-more-bookmarks";
  older.dataset.before = String(nextBefore);
  if (board) older.dataset.board = board;
  if (folder) older.dataset.folder = String(folder);
  main.append(older);
}
// v5.39.0 bookmark folders: the member's folders ride every /bookmarks render
// (a failed read just shows no folder controls); the page keeps them for the
// per-card controls on load-more pages.
let savedFolders = [];
const loadSavedFolders = () => api(FOLDERS_PATH).then((data) => (Array.isArray(data?.folders) ? data.folders : []), () => []);
function decorateSaved(folderId) {
  decorateSavedCards(main, document, {
    folders: savedFolders, activeFolderId: folderId || null,
    onAdd: folderAdder({ folders: savedFolders, setMessage }),
  });
}
async function renderFolderRoute(route, version) {
  const [data, folders] = await Promise.all([api(folderItemsPath(route.folder)), loadSavedFolders()]);
  if (version !== state.renderVersion) return;
  savedFolders = folders;
  addHeading(main, data.folder.name, 2);
  addText(document, main, "p", t("feed.savedPrivate"), "muted");
  main.append(createFolderFilter(document, folders, route.folder));
  main.append(createFolderManage(document, data.folder));
  appendPostList(main, data.posts, document, state.currentUser, t("folders.empty"));
  decorateSaved(route.folder);
  if (data.nextBefore) appendOlderSaved(null, data.nextBefore, route.folder);
}
async function renderBookmarksRoute(route, context, version) {
  if (!context.session.user) {
    addHeading(main, t("feed.savedTitle"), 2);
    addText(document, main, "p", t("feed.signInSaved"), "muted");
    const signIn = element("a", "button button-secondary", t("common.signIn"));
    signIn.href = wempoAccountsSignInUrl(location.origin);
    main.append(signIn);
    return;
  }
  if (route?.folder) {
    await renderFolderRoute(route, version);
    return;
  }
  const board = route?.board;
  const [data, folders] = await Promise.all([api(savedListPath(board)), loadSavedFolders()]);
  if (version !== state.renderVersion) return;
  savedFolders = folders;
  addHeading(main, t("feed.savedTitle"), 2);
  // Privacy note: this list belongs to the signed-in account.
  addText(document, main, "p", t("feed.savedPrivate"), "muted");
  main.append(createFolderFilter(document, folders, null));
  main.append(createSavedBoardFilter(document, board));
  if (board && data.bookmarks.length) main.append(createRemoveSavedBoard(document, board));
  appendPostList(main, data.bookmarks, document, context.session.user,
    savedEmptyText(board));
  decorateSaved(null);
  // Pagination (fix round 1): the composite (bookmarked_at, id) cursor.
  if (!data.nextBefore || data.bookmarks.length !== 20) return;
  appendOlderSaved(board, data.nextBefore);
}
async function loadMorePosts(button) {
  // Board-aware (v2.4.1): the suggestions route's button carries dataset.board
  // and adds the board param; the home button keeps the original URL shape.
  // The emitted cursor is board-native (score_id for suggestions), so pages
  // keep walking the same keyset they started on.
  const board = button.dataset.board;
  const mine = button.dataset.mine;
  const view = button.dataset.view;
  const viewQuery = feedViewQuery(view);
  const older = await api("/api/posts?before=" + button.dataset.before +
    (board ? "&board=" + board : "") + (mine ? "&mine=" + mine : "") +
    (viewQuery ? "&" + viewQuery : ""));
  if (older.posts.length) appendPostList(main, older.posts, document, state.currentUser,
    board === SUGGESTIONS_BOARD ? suggestionsEmptyText() : undefined);
  if (board === SUGGESTIONS_BOARD) numberSuggestionCards(document, main);
  button.remove();
  // Wave 35: the final page closes the list with End of feed + Back to top.
  if (reachedFeedEnd(older, { olderPage: true })) main.append(createFeedEnd(document, main));
  if (older.posts.length !== 20 || !older.nextBefore) return;
  const next = element("button", "button button-secondary",
    board === SUGGESTIONS_BOARD ? t("feed.loadOlderSuggestions") : t("feed.loadOlderPosts"));
  next.type = "button";
  next.dataset.action = "load-more";
  next.dataset.before = String(older.nextBefore);
  if (board) next.dataset.board = board;
  if (mine) next.dataset.mine = mine;
  if (view) next.dataset.view = view;
  main.append(next);
}

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch map;
// ACTIONS merges into handleButtonAction's dispatch map; the renderer functions
// ride renderRoute's table by name.

// Task 9: the card actions that ride every feed surface (reactions, the
// bookmark/subscribe toggles, suggestion status) moved here from app.js —
// the route re-render refetches fresh state, never trusting the echo.
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
  await state.renderRoute(state.activeRoute);
}

export const ACTIONS = {
  "load-more": (button) => loadMorePosts(button),
  reaction: (button) => submitReaction(button),
  "toggle-bookmark": async (button) => {
    // Bookmarks (C4): both directions are idempotent server-side; the
    // route re-render refetches the payload's fresh state.
    const bookmarked = String(button.getAttribute("aria-pressed")) === "true";
    await api("/api/posts/" + button.dataset.postId + "/bookmark", {
      method: bookmarked ? "DELETE" : "PUT",
    });
    await state.renderRoute(state.activeRoute);
    setMessage(bookmarked ? t("feed.bookmarkRemoved") : t("feed.bookmarkSaved"));
  },
  "toggle-subscribe": async (button) => {
    const subscribed = button.dataset.subscribed === "1";
    await api("/api/posts/" + button.dataset.postId + "/subscribe", {
      method: subscribed ? "DELETE" : "POST",
    });
    await state.renderRoute(state.activeRoute);
    setMessage(subscribed ? t("feed.unsubscribed") : t("feed.subscribed"));
  },
  // Suggestion status (v3.1): staff flip resolved/declined/open; the
  // route re-render refetches the payload so the chip and buttons come
  // back from the server, never from the echo.
  "suggestion-status": async (button) => {
    await api("/api/posts/" + button.dataset.postId + "/suggestion-status", {
      method: "POST",
      body: { status: button.dataset.status },
    });
    await state.renderRoute(state.activeRoute);
    setMessage(button.dataset.status === "open"
      ? t("feed.suggestionReopened")
      : button.dataset.status === "declined"
        ? t("feed.suggestionDeclined")
        : t("feed.suggestionResolved"));
  },
  "presence-invisible": async (button) => {
    // One handler for both arms (dataset.invisible picks 0/1 as a boolean per
    // the chat.mjs contract); the response's stored flag, never the echo
    // click, marks the pair — every toggle on the page, in case two render.
    const data = await api("/api/presence", {
      method: "POST",
      body: { invisible: button.dataset.invisible === "1" },
    });
    presenceInvisibleMark(data.invisible ? 1 : 0,
      document.querySelectorAll(".presence-invisible-toggle"));
  },
  "download-my-data": async (button) => {
    button.disabled = true;
    setMessage(t("settings.dataPreparing"));
    try {
      await downloadMyData({ api });
      setMessage(t("settings.dataReady"));
    } finally {
      button.disabled = false;
    }
  },
  "load-more-bookmarks": async (button) => {
    const folder = Number(button.dataset.folder) || null;
    if (folder) {
      const page = await api(folderItemsPath(folder, button.dataset.before));
      appendPostList(main, page.posts, document, state.currentUser, t("folders.empty"));
      decorateSaved(folder);
      button.remove();
      if (page.nextBefore) appendOlderSaved(null, page.nextBefore, folder);
      return;
    }
    const board = button.dataset.board;
    const older = await api(savedListPath(board, button.dataset.before));
    appendPostList(main, older.bookmarks, document, state.currentUser,
      savedEmptyText(board));
    decorateSaved(null);
    button.remove();
    if (!older.nextBefore || older.bookmarks.length !== 20) return;
    appendOlderSaved(board, older.nextBefore);
  },
  "remove-saved-board": async (button) => {
    button.disabled = true;
    try {
      const removed = await removeSavedBoard({
        api, confirm: (text) => window.confirm(text), board: button.dataset.board,
      });
      if (removed === null) return;
      await state.renderRoute(state.activeRoute);
      setMessage(removedSavedMessage(removed));
    } finally {
      button.disabled = false;
    }
  },
};

// The registration seam: ACTIONS merges into handleButtonAction's dispatch
// map (only the card actions; the composer family's entries live in
// composer.js); the renderer functions ride renderRoute's table by name.

export {
  renderHomeRoute,
  renderMineRoute,
  renderCategoryRoute,
  renderBookmarksRoute,
};
