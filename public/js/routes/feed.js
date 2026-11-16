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
import { appendPostList } from "../render.js";
import { BOARDS, BOARD_BY_SLUG, composerBoardChoices } from "../boards.js";
import { homepageInterests, homepageIntro } from "../home-intro.js";

// Suggestions board (v2.4.1): the /suggestions route reuses the feed UI, so
// its composer tags root posts with board=suggestions (form dataset flag read
// by submitNewPost) and its empty state speaks the board's copy.
const SUGGESTIONS_BOARD = "suggestions";
const SUGGESTIONS_EMPTY_TEXT = "No suggestions yet — be the first!";

function renderIntroduction() {
  const intro = element("section", "personal-intro");
  addHeading(intro, "Wempo's Forum: Have fun and meet new people!", 1);
  addText(document, intro, "p", homepageIntro, "personal-intro-copy");
  const interests = element("ul", "personal-tags");
  for (const interest of homepageInterests) interests.append(element("li", "", interest));
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
    main.append(createComposer("post-create", "What's on your mind?", "Post message",
      null, null, null, composerBoardChoices(session.user)));
  }
  // Recent activity (v3.1): the homepage mixes every category, 10 posts at a
  // time (the server's no-board feed page size).
  addHeading(main, route.name === "search" ? "Search results" : "Recent activity", 2);
  if (route.name === "search") {
    addText(document, main, "p", `Results for “${route.query}”`, "muted");
    renderSearchResults(main, data.search);
    return;
  }
  appendPostList(main, data.feed.posts, document, session.user);
  if (!data.feed.nextBefore) return;
  const older = element("button", "button button-secondary", "Load older posts");
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
  corners.append(cornersBox, document.createTextNode(" Square corners"));
  cornersBox.addEventListener("change", () => {
    const square = cornersBox.checked;
    try { window.localStorage.setItem("forum-corners", square ? "square" : "round"); } catch {}
    document.documentElement.dataset.corners = square ? "square" : "round";
  });

  const passwordPanel = createPanel("Change your password", "There is no email-based recovery; choose a password you can keep safe.");
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
  const deletePanel = createPanel("Delete your account",
    "This permanently deletes your account and everything it owns: your posts — and every thread you started, including other people's replies inside those threads — plus your replies — and any sub-replies hanging off your replies in other members' threads go too — reactions, reports, notifications, and profile. There is no undo. Are you really sure?");
  const deleteButton = element("button", "button button-danger", "Delete account");
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
function renderSearchResults(container, results) {
  // Deep reply results (v2.5): a Replies section under the Posts one.
  if (Array.isArray(results.replies)) {
    addHeading(container, "Replies", 2);
    if (!results.replies.length) {
      addText(document, container, "p", "It's pretty empty here....", "There is no replies that match!", "empty-state");
    } else {
      const replyList = element("div", "reply-search-results");
      for (const reply of results.replies) {
        const miniCard = element("article", "reply-search-card");
        miniCard.append(element("a", "reply-search-thread",
          "in a conversation by " + (reply.parent ? "…" : "someone")));
        const bodyBlock = element("p", "reply-search-body");
        bodyBlock.textContent = reply.body;
        const link = element("a", "button button-quiet", "Open thread");
        link.href = "/posts/" + reply.threadId;
        link.setAttribute("data-app-link", "");
        miniCard.append(bodyBlock, link);
        replyList.append(miniCard);
      }
      container.append(replyList);
    }
  }
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
    addText(document, people, "p", "It's pretty empty here", "There are no users that match!", "empty-state");
  }
  container.append(people);
  addHeading(container, "Posts", 2);
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
    ["/", "Recent activity", active === "all"],
    ["/mine", "My posts", active === "mine"],
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
    addHeading(main, "My posts", 2);
    addText(document, main, "p", "Sign in to see your posts.", "muted");
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");
    main.append(signIn);
    return;
  }
  const data = { feed: await api("/api/posts?mine=1") };
  if (version !== state.renderVersion) return;
  main.append(renderFeedTabs("mine"));
  main.append(createComposer("post-create", "What's on your mind?", "Post message"));
  addHeading(main, "My posts", 2);
  appendPostList(main, data.feed.posts, document, context.session.user);
  if (!data.feed.nextBefore || data.feed.posts.length !== 20) return;
  const older = element("button", "button button-secondary", "Load older posts");
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
      board.staffOnly ? "Post a site update" : `Start a thread in ${board.label}`,
      board.staffOnly ? "Post update" : "Post message",
      null, null, board.slug,
    ));
  }
  addHeading(main, board.label, 2);
  addText(document, main, "p", board.blurb, "muted");
  appendPostList(main, data.feed.posts, document, user,
    board.slug === SUGGESTIONS_BOARD
      ? SUGGESTIONS_EMPTY_TEXT
      : `Nothing in ${board.label} yet — start the conversation!`);
  if (!data.feed.nextBefore) return;
  const older = element("button", "button button-secondary", "Load older posts");
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  older.dataset.board = board.slug;
  main.append(older);
}

// Bookmarks (C4): the private "Saved" page — the member's own saved list.
// Guests get a sign-in prompt (the API 401s the private list regardless).
const BOOKMARKS_EMPTY_TEXT = "Nothing saved yet. Use the Save button on a post.";
async function renderBookmarksRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, "Saved posts", 2);
    addText(document, main, "p", "Sign in to see your saved posts.", "muted");
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");
    main.append(signIn);
    return;
  }
  const data = await api("/api/me/bookmarks");
  if (version !== state.renderVersion) return;
  addHeading(main, "Saved posts", 2);
  // Privacy note: this list belongs to the signed-in account.
  addText(document, main, "p", "Your saved list is private to you.", "muted");
  appendPostList(main, data.bookmarks, document, context.session.user,
    BOOKMARKS_EMPTY_TEXT);
  // Pagination (fix round 1): the composite (bookmarked_at, id) cursor.
  if (!data.nextBefore || data.bookmarks.length !== 20) return;
  const older = element("button", "button button-secondary", "Load older saved posts");
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
    board === SUGGESTIONS_BOARD ? SUGGESTIONS_EMPTY_TEXT : undefined);
  button.remove();
  if (older.posts.length !== 20 || !older.nextBefore) return;
  const next = element("button", "button button-secondary",
    board === SUGGESTIONS_BOARD ? "Load older suggestions" : "Load older posts");
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
    setMessage(bookmarked ? "Removed from your saved posts." : "Saved.");
  },
  "toggle-subscribe": async (button) => {
    const subscribed = button.dataset.subscribed === "1";
    await api("/api/posts/" + button.dataset.postId + "/subscribe", {
      method: subscribed ? "DELETE" : "POST",
    });
    await state.renderRoute(state.activeRoute);
    setMessage(subscribed ? "You unsubscribed from this thread." : "You will get notifications for replies here.");
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
      ? "Suggestion reopened."
      : "Suggestion marked " + button.dataset.status + ".");
  },
  "load-more-bookmarks": async (button) => {
    const older = await api("/api/me/bookmarks?before=" + button.dataset.before);
    appendPostList(main, older.bookmarks, document, state.currentUser,
      BOOKMARKS_EMPTY_TEXT);
    button.remove();
    if (!older.nextBefore || older.bookmarks.length !== 20) return;
    const next = element("button", "button button-secondary", "Load older saved posts");
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
