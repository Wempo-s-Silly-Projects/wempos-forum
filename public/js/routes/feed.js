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
//
// 5.0 wave 2 (the prove-it wave): the module re-expresses its render on the
// vendored Kitskey framework — frontload/dom's el(), the kit's
// heading/text/panel/form family. The kit was extracted from this very app's
// dom.js/forms.js twins, so every node it builds is character-for-character
// the shape the route shipped (same classes, same labeled fields, same
// data-form dispatch). Two rethink surfaces land with the conversion:
//   - empty states become instructions: a zero feed names the action and,
//     where the composer is on the page, carries a one-click CTA that
//     focuses it — guests get the Accounts door as their instruction.
//   - the unread model's first surface: the feed tabs read one client-side
//     board-read model (see the section below), and boards with activity
//     the member hasn't read announce themselves on their tab.
// The composer module (createComposer), render.js's post cards
// (appendPostList), the dom.js boot-shell singletons (main, setMessage) and
// every URL ride verbatim — the diff is the builder, not the surface.
import { el } from "../vendor/frontload/dom.mjs";
import {
  addHeading,
  addText,
  panel,
} from "../vendor/designer/kit.mjs";
import { api } from "../api.js";
import { main, setMessage } from "../dom.js";
import { state } from "../state.js";
import { renderHomeAccess } from "./auth.js";
import { renderTotpSettings } from "./twofa.js";
import { renderBlockedSettings } from "./blocks.js";
import { createComposer } from "./composer.js";
// The §4b door-swap: the guests' sign-in prompts (mine/bookmarks gates) are
// the Accounts handoff — the join panel they used to point at is gone.
import { WEMPO_ACCOUNTS_ORIGIN, wempoAccountsSignInUrl } from "../sso.js";
import { appendPostList } from "../render.js";
import { BOARDS, BOARD_BY_SLUG, composerBoardChoices } from "../boards.js";
import { homepageInterests, homepageIntro } from "../home-intro.js";
// The unified unread model lives in _kit.mjs (wave 7): the feed reads the
// same store the chrome reads.
import {
  boardIsUnread,
  markBoardVisited,
  postActivityAt,
  recordBoardActivity,
} from "./_kit.mjs";

// Suggestions board (v2.4.1): the /suggestions route reuses the feed UI, so
// its composer tags root posts with board=suggestions (form dataset flag read
// by submitNewPost) and its empty state speaks the board's copy.
const SUGGESTIONS_BOARD = "suggestions";
const SUGGESTIONS_EMPTY_TEXT = "No suggestions yet — be the first!";

// --- empty states as instructions -------------------------------------------
// The rethink's first route: a zero feed names the action. Where the composer
// is on the page, the instruction is ONE click away — a CTA that focuses it;
// a guest surface ends in the Accounts door instead. The blocks reuse only
// classes the sheet already carries.
function appendComposeCta(container, composer, label = "Start a thread") {
  const box = composer?.querySelector?.("textarea");
  if (!box) return;
  const cta = el("button", { class: "button button-secondary", type: "button", text: label });
  cta.addEventListener("click", () => box.focus());
  container.append(cta);
}

function appendGuestDoorCta(container, label) {
  container.append(el("a", {
    class: "button button-secondary",
    href: wempoAccountsSignInUrl(location.origin),
    text: label,
  }));
}

function renderIntroduction() {
  const intro = el("section", { class: "personal-intro" });
  addHeading(intro, "Wempo's Forum: Have fun and meet new people!", 1);
  addText(intro, homepageIntro, "personal-intro-copy");
  const interests = el("ul", { class: "personal-tags" });
  for (const interest of homepageInterests) interests.append(el("li", { text: interest }));
  intro.append(interests);
  intro.append(el("span", { class: "intro-doodle", text: ":3", "aria-hidden": "true" }));
  main.append(intro);
}

function renderHomeContent(session, data, route) {
  let composer = null;
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
    composer = createComposer("post-create", "What's on your mind?", "Post message",
      null, null, null, composerBoardChoices(session.user));
    main.append(composer);
  }
  // Recent activity (v3.1): the homepage mixes every category, 10 posts at a
  // time (the server's no-board feed page size).
  addHeading(main, route.name === "search" ? "Search results" : "Recent activity", 2);
  if (route.name === "search") {
    addText(main, `Results for “${route.query}”`, "muted");
    renderSearchResults(main, data.search);
    return;
  }
  appendPostList(main, data.feed.posts, document, session.user,
    session.user
      ? "Nothing in Recent activity yet — be the first."
      // Guests: the door panel the boot renders above IS their instruction.
      : "No posts yet — sign in above to start the first thread.");
  if (!data.feed.posts.length) appendComposeCta(main, composer);
  if (!data.feed.nextBefore) return;
  main.append(loadMoreButton({ label: "Load older posts", before: data.feed.nextBefore }));
}
function renderAccountSettings(session) {
  const account = el("details", { class: "panel" });
  // Appearance: the square-corners pref (v2.5) - a checkbox in the account
  // settings panel; stored client-side like the theme choice.
  const corners = el("label", { class: "corner-pref" });
  const cornersBox = el("input", { type: "checkbox", dataset: { actionPref: "corners" } });
  try { cornersBox.checked = window.localStorage.getItem("forum-corners") === "square"; } catch {}
  corners.append(cornersBox, document.createTextNode(" Square corners"));
  cornersBox.addEventListener("change", () => {
    const square = cornersBox.checked;
    try { window.localStorage.setItem("forum-corners", square ? "square" : "round"); } catch {}
    document.documentElement.dataset.corners = square ? "square" : "round";
  });

  // The password axe (5.0 wave 5, ruling A1): the on-site change-password
  // form LEAVES the forum UI — Wempo Accounts' dashboard owns password
  // writes now, and the forum's PATCH /api/me/password plumbing stays for
  // the dashboard's lane. The instruction takes the form's seat (the rethink:
  // an empty spot names the action).
  const passwordPanel = panel({ title: "Change your password",
    description: "Passwords change on Wempo Accounts now — the dashboard owns the change and its session revocation; the forum keeps no local lane. There is no email-based recovery there either." });
  const accountsLink = el("a", {
    class: "button button-secondary sso-entry-button",
    href: WEMPO_ACCOUNTS_ORIGIN,
    text: "Change it on Wempo Accounts",
  });
  // Cross-origin jump: the SPA's internal navigation must not intercept it.
  accountsLink.setAttribute("data-external-link", "");
  passwordPanel.append(accountsLink);
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
  const deletePanel = panel({ title: "Delete your Wempo Account",
    description: "This permanently deletes your Wempo Account and everything it owns: your posts — and every thread you started, including other people's replies inside those threads — plus your replies — and any sub-replies hanging off your replies in other members' threads go too — reactions, reports, notifications, and profile. There is no undo. Are you really sure?" });
  const deleteButton = el("button", { class: "button button-danger", type: "button",
    dataset: { action: "delete-account" }, text: "Delete Wempo Account" });
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
      addText(container, "No replies match — try fewer words.", "empty-state");
    } else {
      const replyList = el("div", { class: "reply-search-results" });
      for (const reply of results.replies) {
        const miniCard = el("article", { class: "reply-search-card" });
        miniCard.append(el("a", { class: "reply-search-thread",
          text: "in a conversation by " + (reply.parent ? "…" : "someone") }));
        const bodyBlock = el("p", { class: "reply-search-body", text: reply.body });
        const link = el("a", { class: "button button-quiet", text: "Open thread",
          href: "/posts/" + reply.threadId, "data-app-link": "" });
        miniCard.append(bodyBlock, link);
        replyList.append(miniCard);
      }
      container.append(replyList);
    }
  }
  const people = panel({ title: "People" });
  if (results.users.length) {
    const list = el("ul", { class: "result-list" });
    for (const user of results.users) {
      const item = el("li");
      item.append(el("a", { text: user.username,
        href: `/users/${encodeURIComponent(user.username)}` }));
      if (user.bio) addText(item, user.bio, "muted");
      list.append(item);
    }
    people.append(list);
  } else {
    addText(people, "No members match — check the spelling, or try a shorter name.",
      "empty-state");
  }
  container.append(people);
  addHeading(container, "Posts", 2);
  appendPostList(container, results.posts, document, state.currentUser,
    "No posts match — fewer words search wider, or start the thread yourself.");
}
async function renderHomeRoute(route, context, version) {
  const data = route.name === "search"
    ? { search: await api(`/api/search?q=${encodeURIComponent(route.query)}&in=replies`) }
    : { feed: await api("/api/posts") };
  if (version !== state.renderVersion) return;
  // The search payload carries the mixed posts half — evidence either way.
  recordBoardActivity(route.name === "search" ? data.search.posts : data.feed.posts);
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
  const tabs = el("div", { class: "feed-tabs" });
  // Categories (v3.1, tab style): the tab pair above the composer is the
  // category navigation — Recent activity (every category mixed, 10 at a
  // time), My posts, then each category as its own route. `active` is the
  // category slug on category pages ("all" home, "mine" on /mine); a slug
  // match highlights that category's tab.
  const spec = [
    ["/", "Recent activity", active === "all", null],
    ["/mine", "My posts", active === "mine", null],
    ...BOARDS.map((board) =>
      ["/c/" + board.slug, board.label, active === board.slug, board.slug]),
  ];
  for (const [href, label, isActive, slug] of spec) {
    const tab = el("a", { class: "feed-tab", text: label, href });
    tab.setAttribute("data-app-link", "");
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    // The unread announcement (the model's first surface): the tab keeps its
    // name and its selection state; an unread one gains the machine-readable
    // data-unread (wave 7 gives the dot its ink) and an aria-label announce.
    if (!isActive && slug && boardIsUnread(slug)) {
      tab.dataset.unread = "true";
      tab.setAttribute("aria-label", label + " (new posts)");
    }
    tabs.append(tab);
  }
  return tabs;
}
// The load-older button (five call sites): one builder, board/mine-aware
// dataset exactly as before — el's dataset loop drops the absent keys.
function loadMoreButton({ label, before, action = "load-more", board, mine }) {
  return el("button", {
    class: "button button-secondary", type: "button", text: label,
    dataset: { action, before: String(before), board, mine },
  });
}
async function renderMineRoute(context, version) {
  if (!context.session.user) {
    // A hand-typed /mine URL while signed out: a sign-in prompt, not an error.
    addHeading(main, "My posts", 2);
    addText(main, "Sign in to see your posts.", "muted");
    const signIn = el("a", { class: "button button-secondary", text: "Sign in" });
    signIn.href = wempoAccountsSignInUrl(location.origin);
    main.append(signIn);
    return;
  }
  // Own posts are self-authored — they are never unread news, so the model
  // records nothing from /mine.
  const data = { feed: await api("/api/posts?mine=1") };
  if (version !== state.renderVersion) return;
  main.append(renderFeedTabs("mine"));
  const composer = createComposer("post-create", "What's on your mind?", "Post message");
  main.append(composer);
  addHeading(main, "My posts", 2);
  appendPostList(main, data.feed.posts, document, context.session.user,
    "No posts of yours yet — start your first thread with the composer above.");
  if (!data.feed.posts.length) appendComposeCta(main, composer);
  if (!data.feed.nextBefore || data.feed.posts.length !== 20) return;
  main.append(loadMoreButton({ label: "Load older posts", before: data.feed.nextBefore, mine: "1" }));
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
  // Opening the board IS the read: its served rows advance the seen floor
  // and the visit mark clears the tab's announcement for next time.
  recordBoardActivity(data.feed.posts);
  markBoardVisited(board.slug);
  main.append(renderFeedTabs(board.slug));
  const user = context.session.user;
  const isStaff = Boolean(user && (user.role === "owner" || user.role === "admin"));
  const composer = user && (!board.staffOnly || isStaff)
    ? createComposer(
        "post-create",
        board.staffOnly ? "Post a site update" : `Start a thread in ${board.label}`,
        board.staffOnly ? "Post update" : "Post message",
        null, null, board.slug)
    : null;
  if (composer) main.append(composer);
  addHeading(main, board.label, 2);
  addText(main, board.blurb, "muted");
  appendPostList(main, data.feed.posts, document, user,
    board.slug === SUGGESTIONS_BOARD
      ? SUGGESTIONS_EMPTY_TEXT
      : `Nothing in ${board.label} yet — start the conversation!`);
  if (!data.feed.posts.length && composer) {
    appendComposeCta(main, composer, board.staffOnly
      ? "Post the first update"
      : board.slug === SUGGESTIONS_BOARD ? "Post the first suggestion" : "Start a thread");
  } else if (!data.feed.posts.length && !user) {
    // Guests: the door, with the board's own name in the instruction.
    appendGuestDoorCta(main, `Sign in to start the first thread in ${board.label}`);
  }
  if (!data.feed.nextBefore) return;
  main.append(loadMoreButton({ label: "Load older posts", before: data.feed.nextBefore,
    board: board.slug }));
}

// Bookmarks (C4): the private "Saved" page — the member's own saved list.
// Guests get a sign-in prompt (the API 401s the private list regardless).
const BOOKMARKS_EMPTY_TEXT = "Nothing saved yet. Use the Save button on a post.";
async function renderBookmarksRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, "Saved posts", 2);
    addText(main, "Sign in to see your saved posts.", "muted");
    const signIn = el("a", { class: "button button-secondary", text: "Sign in" });
    signIn.href = wempoAccountsSignInUrl(location.origin);
    main.append(signIn);
    return;
  }
  const data = await api("/api/me/bookmarks");
  if (version !== state.renderVersion) return;
  addHeading(main, "Saved posts", 2);
  // Privacy note: this list belongs to the signed-in account.
  addText(main, "Your saved list is private to you.", "muted");
  appendPostList(main, data.bookmarks, document, context.session.user,
    BOOKMARKS_EMPTY_TEXT);
  // Pagination (fix round 1): the composite (bookmarked_at, id) cursor.
  if (!data.nextBefore || data.bookmarks.length !== 20) return;
  main.append(loadMoreButton({ label: "Load older saved posts", before: data.nextBefore,
    action: "load-more-bookmarks" }));
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
  // The walked page is evidence too: max() keeps the floors monotonic, so
  // walking backwards can never unmute a board.
  recordBoardActivity(older.posts);
  appendPostList(main, older.posts, document, state.currentUser,
    board === SUGGESTIONS_BOARD ? SUGGESTIONS_EMPTY_TEXT : undefined);
  button.remove();
  if (older.posts.length !== 20 || !older.nextBefore) return;
  main.append(loadMoreButton({
    label: board === SUGGESTIONS_BOARD ? "Load older suggestions" : "Load older posts",
    before: older.nextBefore,
    board,
    mine,
  }));
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
    main.append(loadMoreButton({ label: "Load older saved posts", before: older.nextBefore,
      action: "load-more-bookmarks" }));
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
