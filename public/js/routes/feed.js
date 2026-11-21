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

// v4.0 plan 4 Task 3: the feed concern — home/search/mine/category/bookmarks
// routes, the feed tabs, and the feed's pagination. Bodies moved verbatim
// out of app.js; the renderRoute and bare renderRoute calls inside moved
// bodies re-read the boot state through the bag (state.renderRoute). The
// composer family (builder, submits, gif/poll dialogs) lives in composer.js
// since the plan 7 follow-up; createComposer's consumers import it there.
import { addText, createForm, createInput, createTextarea } from "../forms.js";
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
import { renderBlockedSettings } from "./blocks.js";
import { createComposer } from "./composer.js";
// The §4b door-swap: the guests' sign-in prompts (mine/bookmarks gates) are
// the Accounts handoff — the join panel they used to point at is gone.
import { wempoAccountsSignInUrl } from "../sso.js";
import { appendPostList } from "../render.js";
import { maskSpoilers } from "../markdown.js";
import { BOARDS, BOARD_BY_SLUG, composerBoardChoices } from "../boards.js";
import { homepageInterests, homepageIntro } from "../home-intro.js";
import { t } from "../i18n.js";

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
  addHeading(main, route.name === "search" ? t("feed.searchResults") : t("feed.recentActivity"), 2);
  if (route.name === "search") {
    addText(document, main, "p", t("feed.searchResultsFor", { query: route.query }), "muted");
    renderSearchResults(main, data.search);
    return;
  }
  appendPostList(main, data.feed.posts, document, session.user);
  if (!data.feed.nextBefore) return;
  const older = element("button", "button button-secondary", t("feed.loadOlderPosts"));
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  main.append(older);
}
function renderAccountSettings(session) {
  const account = document.createElement("details");
  account.className = "panel";
  // Appearance: the square-corners pref (v2.5) - a checkbox in the account
  // settings panel; stored client-side like the theme choice.
  const corners = document.createElement("label");
  corners.className = "corner-pref";
  const cornersBox = document.createElement("input");
  cornersBox.type = "checkbox";
  try { cornersBox.checked = window.localStorage.getItem("forum-corners") === "square"; } catch {}
  cornersBox.dataset.actionPref = "corners";
  corners.append(cornersBox, document.createTextNode(" " + t("feed.squareCorners")));
  cornersBox.addEventListener("change", () => {
    const square = cornersBox.checked;
    try { window.localStorage.setItem("forum-corners", square ? "square" : "round"); } catch {}
    document.documentElement.dataset.corners = square ? "square" : "round";
  });

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
  // Blocks (v4.4): the blocked-members list + Unblock controls ride the
  // account settings area right after the two-factor section.
  renderBlockedSettings(account, session);
  // Invisible-mode toggle (day-2 misc): the roster honors presence.invisible
  // server-side; this is the member-facing seat. The read arm is the FLAG-LESS
  // heartbeat POST /api/presence (who-online.js already sends it) — its
  // response carries the stored invisible flag back, so the pair marks the
  // member's current choice straight from the server, never a localStorage
  // guess; a failed read just leaves both buttons unmarked. No roster wiring
  // rides here: an invisible member drops off the list on its next refresh.
  renderInvisibleToggle(account);
  const deletePanel = createPanel(t("feed.deleteAccountTitle"), t("feed.deleteAccountNote"));
  const deleteButton = element("button", "button button-danger", t("feed.deleteAccount"));
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-account";
  deletePanel.append(deleteButton);
  account.append(deletePanel);
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
function renderSearchResults(container, results) {
  // Deep reply results (v2.5): a Replies section under the Posts one.
  if (Array.isArray(results.replies)) {
    addHeading(container, t("feed.repliesTitle"), 2);
    if (!results.replies.length) {
      addText(document, container, "p", t("feed.noReplyMatches"), "empty-state");
    } else {
      const replyList = element("div", "reply-search-results");
      for (const reply of results.replies) {
        const miniCard = element("article", "reply-search-card");
        miniCard.append(element("a", "reply-search-thread",
          reply.parent ? t("feed.replyThreadByParent") : t("feed.replyThreadBySomeone")));
        const bodyBlock = element("p", "reply-search-body");
        bodyBlock.textContent = maskSpoilers(reply.body);
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
    addText(document, people, "p", t("feed.noUserMatches"), "empty-state");
  }
  container.append(people);
  addHeading(container, t("feed.postsTitle"), 2);
  appendPostList(container, results.posts, document, state.currentUser);
}
async function renderHomeRoute(route, context, version) {
  const data = route.name === "search"
    ? { search: await api(`/api/search?q=${encodeURIComponent(route.query)}&in=replies`) }
    : { feed: await api("/api/posts") };
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
  const data = { feed: await api("/api/posts?board=" + encodeURIComponent(board.slug)) };
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
  appendPostList(main, data.feed.posts, document, user,
    board.slug === SUGGESTIONS_BOARD
      ? suggestionsEmptyText()
      : t("feed.categoryEmpty", { board: board.label }));
  if (!data.feed.nextBefore) return;
  const older = element("button", "button button-secondary", t("feed.loadOlderPosts"));
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  older.dataset.board = board.slug;
  main.append(older);
}

// Bookmarks (C4): the private "Saved" page — the member's own saved list.
// Guests get a sign-in prompt (the API 401s the private list regardless).
const bookmarksEmptyText = () => t("feed.bookmarksEmpty");
async function renderBookmarksRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, t("feed.savedTitle"), 2);
    addText(document, main, "p", t("feed.signInSaved"), "muted");
    const signIn = element("a", "button button-secondary", t("common.signIn"));
    signIn.href = wempoAccountsSignInUrl(location.origin);
    main.append(signIn);
    return;
  }
  const data = await api("/api/me/bookmarks");
  if (version !== state.renderVersion) return;
  addHeading(main, t("feed.savedTitle"), 2);
  // Privacy note: this list belongs to the signed-in account.
  addText(document, main, "p", t("feed.savedPrivate"), "muted");
  appendPostList(main, data.bookmarks, document, context.session.user,
    bookmarksEmptyText());
  // Pagination (fix round 1): the composite (bookmarked_at, id) cursor.
  if (!data.nextBefore || data.bookmarks.length !== 20) return;
  const older = element("button", "button button-secondary", t("feed.loadOlderSaved"));
  older.type = "button";
  older.dataset.action = "load-more-bookmarks";
  older.dataset.before = String(data.nextBefore);
  main.append(older);
}
async function loadMorePosts(button) {
  // Board-aware (v2.4.1): the suggestions route's button carries dataset.board
  // and adds the board param; the home button keeps the original URL shape.
  // The emitted cursor is board-native (score_id for suggestions), so pages
  // keep walking the same keyset they started on.
  const board = button.dataset.board;
  const mine = button.dataset.mine;
  const older = await api("/api/posts?before=" + button.dataset.before +
    (board ? "&board=" + board : "") + (mine ? "&mine=" + mine : ""));
  appendPostList(main, older.posts, document, state.currentUser,
    board === SUGGESTIONS_BOARD ? suggestionsEmptyText() : undefined);
  button.remove();
  if (older.posts.length !== 20 || !older.nextBefore) return;
  const next = element("button", "button button-secondary",
    board === SUGGESTIONS_BOARD ? t("feed.loadOlderSuggestions") : t("feed.loadOlderPosts"));
  next.type = "button";
  next.dataset.action = "load-more";
  next.dataset.before = String(older.nextBefore);
  if (board) next.dataset.board = board;
  if (mine) next.dataset.mine = mine;
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
  "load-more-bookmarks": async (button) => {
    const older = await api("/api/me/bookmarks?before=" + button.dataset.before);
    appendPostList(main, older.bookmarks, document, state.currentUser,
      bookmarksEmptyText());
    button.remove();
    if (!older.nextBefore || older.bookmarks.length !== 20) return;
    const next = element("button", "button button-secondary", t("feed.loadOlderSaved"));
    next.type = "button";
    next.dataset.action = "load-more-bookmarks";
    next.dataset.before = String(older.nextBefore);
    main.append(next);
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
