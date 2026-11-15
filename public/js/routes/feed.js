
// v4.0 plan 4 Task 3: the feed concern — home/search/mine/category/bookmarks
// routes, the feed tabs, and the feed's pagination. Bodies moved from app.js;
// renderRoute calls inside moved bodies re-read boot state through state.
// The composer family lives in composer.js.

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
import { renderBlockedSettings } from "./blocks.js";
import { createComposer } from "./composer.js";
import { appendPostList } from "../render.js";
import {
  BOARDS,
  BOARD_BY_SLUG,
  composerBoardChoices,
} from "../boards.js";
import {
  homepageInterests,
  homepageIntro,
} from "../home-intro.js";

// Suggestions board: /suggestions reuses the feed UI, with its own composer
// board value and empty-state wording.
const SUGGESTIONS_BOARD = "suggestions";
const SUGGESTIONS_EMPTY_TEXT = "No suggestions yet — be the first!";
const BOOKMARKS_EMPTY_TEXT =
  "Nothing saved yet. Use the Save button on a post.";

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value),
  );
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}

function validCursor(value) {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validateFeedResponse(data) {
  if (!isRecord(data) || !Array.isArray(data.posts)) {
    throw new Error("The feed returned an invalid response.");
  }

  if (
    data.nextBefore != null &&
    !validCursor(data.nextBefore)
  ) {
    throw new Error("The feed returned an invalid pagination cursor.");
  }

  return data;
}

function validateBookmarksResponse(data) {
  if (!isRecord(data) || !Array.isArray(data.bookmarks)) {
    throw new Error("The saved posts returned an invalid response.");
  }

  if (
    data.nextBefore != null &&
    !validCursor(data.nextBefore)
  ) {
    throw new Error("The saved posts returned an invalid pagination cursor.");
  }

  return data;
}

function validateSearchResponse(data) {
  if (
    !isRecord(data) ||
    !Array.isArray(data.users) ||
    !Array.isArray(data.posts) ||
    (data.replies !== undefined && !Array.isArray(data.replies))
  ) {
    throw new Error("Search returned an invalid response.");
  }

  return data;
}

function renderIntroduction() {
  const intro = element("section", "personal-intro");

  addHeading(
    intro,
    "Wempo's Forum: Have fun and meet new people!",
    1,
  );

  addText(
    document,
    intro,
    "p",
    homepageIntro,
    "personal-intro-copy",
  );

  const interests = element("ul", "personal-tags");

  for (const interest of homepageInterests) {
    interests.append(element("li", "", interest));
  }

  intro.append(interests);

  const doodle = element("span", "intro-doodle", ":3");
  doodle.setAttribute("aria-hidden", "true");

  intro.append(doodle);
  main.append(intro);
}

function renderHomeContent(session, data, route) {
  if (session.user && route.name === "home") {
    // My posts and category tabs appear above the home composer.
    main.append(renderFeedTabs("all"));

    main.append(
      createComposer(
        "post-create",
        "What's on your mind?",
        "Post message",
        null,
        null,
        null,
        composerBoardChoices(session.user),
      ),
    );
  }

  addHeading(
    main,
    route.name === "search" ? "Search results" : "Recent activity",
    2,
  );

  if (route.name === "search") {
    addText(
      document,
      main,
      "p",
      `Results for “${route.query}”`,
      "muted",
    );

    renderSearchResults(main, data.search);
    return;
  }

  appendPostList(
    main,
    data.feed.posts,
    document,
    session.user,
  );

  if (!data.feed.nextBefore) return;

  const older = element(
    "button",
    "button button-secondary",
    "Load older posts",
  );

  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);

  main.append(older);
}

function renderAccountSettings(session) {
  const account = document.createElement("details");
  account.className = "panel";

  // Appearance: square-corners preference, stored locally like the theme.
  const corners = document.createElement("label");
  corners.className = "corner-pref";

  const cornersBox = document.createElement("input");
  cornersBox.type = "checkbox";

  try {
    cornersBox.checked =
      window.localStorage.getItem("forum-corners") === "square";
  } catch {}

  cornersBox.dataset.actionPref = "corners";

  corners.append(
    cornersBox,
    document.createTextNode(" Square corners"),
  );

  cornersBox.addEventListener("change", () => {
    const square = cornersBox.checked;

    try {
      window.localStorage.setItem(
        "forum-corners",
        square ? "square" : "round",
      );
    } catch {}

    document.documentElement.dataset.corners =
      square ? "square" : "round";
  });

  account.append(corners);

  const passwordPanel = createPanel(
    "Change your password",
    "There is no email-based recovery; choose a password you can keep safe.",
  );

  passwordPanel.append(
    createForm(
      document,
      "password",
      [
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
        }),
      ],
      "Update password",
    ),
  );

  account.append(passwordPanel);

  // Two-factor sign-in settings.
  renderTotpSettings(account, session);

  // Blocked-members list and Unblock controls.
  renderBlockedSettings(account, session);

  const deletePanel = createPanel(
    "Delete your account",
    "This permanently deletes your account and everything it owns: your posts — and every thread you started, including other people's replies inside those threads — plus your replies — and any sub-replies hanging off your replies in other members' threads go too — reactions, reports, notifications, and profile. There is no undo. Are you really sure?",
  );

  const deleteButton = element(
    "button",
    "button button-danger",
    "Delete account",
  );

  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-account";

  deletePanel.append(deleteButton);
  account.append(deletePanel);

  main.append(account);
}

function renderHome(session, setupRequired, setupConfigured, data, route) {
  renderIntroduction();

  renderHomeAccess(
    session,
    setupRequired,
    setupConfigured,
  );

  renderHomeContent(session, data, route);

  if (session.user) {
    renderAccountSettings(session);
  }
}

function renderSearchResults(container, results) {
  if (
    !isRecord(results) ||
    !Array.isArray(results.users) ||
    !Array.isArray(results.posts) ||
    (results.replies !== undefined && !Array.isArray(results.replies))
  ) {
    addText(
      document,
      container,
      "p",
      "Search results could not be loaded.",
      "empty-state",
    );
    return;
  }

  // Deep reply results: a Replies section beneath Posts.
  if (Array.isArray(results.replies)) {
    addHeading(container, "Replies", 2);

    if (!results.replies.length) {
      addText(
        document,
        container,
        "p",
        "There are no replies that match!",
        "empty-state",
      );
    } else {
      const replyList = element("div", "reply-search-results");

      for (const reply of results.replies) {
        if (!isRecord(reply)) continue;

        const miniCard = element("article", "reply-search-card");

        // This is descriptive text, not a link: the actual navigation is
        // provided by the Open thread link below.
        miniCard.append(
          element(
            "span",
            "reply-search-thread",
            "In a conversation",
          ),
        );

        const bodyBlock = element("p", "reply-search-body");
        bodyBlock.textContent =
          typeof reply.body === "string" ? reply.body : "";

        miniCard.append(bodyBlock);

        if (validId(reply.threadId)) {
          const link = element(
            "a",
            "button button-quiet",
            "Open thread",
          );

          link.href = `/posts/${Number(reply.threadId)}`;
          link.setAttribute("data-app-link", "");

          miniCard.append(link);
        }

        replyList.append(miniCard);
      }

      container.append(replyList);
    }
  }

  const people = createPanel("People");

  if (results.users.length) {
    const list = element("ul", "result-list");

    for (const user of results.users) {
      if (
        !isRecord(user) ||
        typeof user.username !== "string" ||
        !user.username.trim()
      ) {
        continue;
      }

      const item = element("li");

      const link = element("a", "", user.username);
      link.href =
        `/users/${encodeURIComponent(user.username)}`;

      link.setAttribute("data-app-link", "");

      item.append(link);

      if (typeof user.bio === "string" && user.bio) {
        addText(document, item, "p", user.bio, "muted");
      }

      list.append(item);
    }

    people.append(list);

    if (!list.children.length) {
      addText(
        document,
        people,
        "p",
        "There are no users that match!",
        "empty-state",
      );
    }
  } else {
    addText(
      document,
      people,
      "p",
      "There are no users that match!",
      "empty-state",
    );
  }

  container.append(people);

  addHeading(container, "Posts", 2);

  appendPostList(
    container,
    results.posts,
    document,
    state.currentUser,
  );
}

async function renderHomeRoute(route, context, version) {
  const data = route.name === "search"
    ? {
        search: validateSearchResponse(
          await api(
            `/api/search?q=${encodeURIComponent(route.query)}&in=replies`,
          ),
        ),
      }
    : {
        feed: validateFeedResponse(
          await api("/api/posts"),
        ),
      };

  if (version !== state.renderVersion) return;

  renderHome(
    context.session,
    context.setupRequired,
    context.setupConfigured,
    data,
    route,
  );
}

// Shared category and personal-feed tabs.
function renderFeedTabs(active) {
  const tabs = element("div", "feed-tabs");

  const spec = [
    ["/", "Recent activity", active === "all"],
    ["/mine", "My posts", active === "mine"],
    ...BOARDS.map((board) => [
      "/c/" + board.slug,
      board.label,
      active === board.slug,
    ]),
  ];

  for (const [href, label, isActive] of spec) {
    const tab = element("a", "feed-tab", label);

    tab.href = href;
    tab.setAttribute("data-app-link", "");
    tab.setAttribute(
      "aria-selected",
      isActive ? "true" : "false",
    );

    tabs.append(tab);
  }

  return tabs;
}

async function renderMineRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, "My posts", 2);

    addText(
      document,
      main,
      "p",
      "Sign in to see your posts.",
      "muted",
    );

    const signIn = element(
      "a",
      "button button-secondary",
      "Sign in",
    );

    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");

    main.append(signIn);
    return;
  }

  const data = validateFeedResponse(
    await api("/api/posts?mine=1"),
  );

  if (version !== state.renderVersion) return;

  main.append(renderFeedTabs("mine"));

  main.append(
    createComposer(
      "post-create",
      "What's on your mind?",
      "Post message",
    ),
  );

  addHeading(main, "My posts", 2);

  appendPostList(
    main,
    data.posts,
    document,
    context.session.user,
  );

  if (!data.nextBefore || data.posts.length !== 20) return;

  const older = element(
    "button",
    "button button-secondary",
    "Load older posts",
  );

  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.nextBefore);
  older.dataset.mine = "1";

  main.append(older);
}

// Category routes: /c/<slug>, including the suggestions board.
async function renderCategoryRoute(route, context, version) {
  const board = BOARD_BY_SLUG[route.board];

  if (!board) {
    addHeading(main, "Category not found", 2);

    addText(
      document,
      main,
      "p",
      "That category does not exist.",
      "empty-state",
    );

    return;
  }

  const data = validateFeedResponse(
    await api(
      "/api/posts?board=" + encodeURIComponent(board.slug),
    ),
  );

  if (version !== state.renderVersion) return;

  main.append(renderFeedTabs(board.slug));

  const user = context.session.user;

  const isStaff = Boolean(
    user &&
    (user.role === "owner" || user.role === "admin"),
  );

  if (user && (!board.staffOnly || isStaff)) {
    main.append(
      createComposer(
        "post-create",
        board.staffOnly
          ? "Post a site update"
          : `Start a thread in ${board.label}`,
        board.staffOnly ? "Post update" : "Post message",
        null,
        null,
        board.slug,
      ),
    );
  }

  addHeading(main, board.label, 2);

  addText(
    document,
    main,
    "p",
    board.blurb,
    "muted",
  );

  appendPostList(
    main,
    data.posts,
    document,
    user,
    board.slug === SUGGESTIONS_BOARD
      ? SUGGESTIONS_EMPTY_TEXT
      : `Nothing in ${board.label} yet — start the conversation!`,
  );

  if (!data.nextBefore) return;

  const older = element(
    "button",
    "button button-secondary",
    "Load older posts",
  );

  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.nextBefore);
  older.dataset.board = board.slug;

  main.append(older);
}

// Bookmarks: the private Saved page.
async function renderBookmarksRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, "Saved posts", 2);

    addText(
      document,
      main,
      "p",
      "Sign in to see your saved posts.",
      "muted",
    );

    const signIn = element(
      "a",
      "button button-secondary",
      "Sign in",
    );

    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");

    main.append(signIn);
    return;
  }

  const data = validateBookmarksResponse(
    await api("/api/me/bookmarks"),
  );

  if (version !== state.renderVersion) return;

  addHeading(main, "Saved posts", 2);

  addText(
    document,
    main,
    "p",
    "Your saved list is private to you.",
    "muted",
  );

  appendPostList(
    main,
    data.bookmarks,
    document,
    context.session.user,
    BOOKMARKS_EMPTY_TEXT,
  );

  if (!data.nextBefore || data.bookmarks.length !== 20) return;

  const older = element(
    "button",
    "button button-secondary",
    "Load older saved posts",
  );

  older.type = "button";
  older.dataset.action = "load-more-bookmarks";
  older.dataset.before = String(data.nextBefore);

  main.append(older);
}

// Pagination helpers. The button is disabled while its request is pending;
// render-version and connectivity checks prevent stale results being added
// to a different route.
async function loadMorePosts(button) {
  if (button.disabled) return;

  const before = button.dataset.before;

  if (!validCursor(before)) {
    setMessage("That pagination cursor is invalid.", true);
    return;
  }

  const board = button.dataset.board;
  const mine = button.dataset.mine;

  button.disabled = true;

  const version = state.renderVersion;

  try {
    const params = new URLSearchParams();
    params.set("before", before);

    if (board) {
      params.set("board", board);
    }

    if (mine) {
      params.set("mine", mine);
    }

    const older = validateFeedResponse(
      await api("/api/posts?" + params.toString()),
    );

    if (
      version !== state.renderVersion ||
      !button.isConnected
    ) {
      return;
    }

    appendPostList(
      main,
      older.posts,
      document,
      state.currentUser,
      board === SUGGESTIONS_BOARD
        ? SUGGESTIONS_EMPTY_TEXT
        : undefined,
    );

    button.remove();

    if (older.posts.length !== 20 || !older.nextBefore) {
      return;
    }

    const next = element(
      "button",
      "button button-secondary",
      board === SUGGESTIONS_BOARD
        ? "Load older suggestions"
        : "Load older posts",
    );

    next.type = "button";
    next.dataset.action = "load-more";
    next.dataset.before = String(older.nextBefore);

    if (board) {
      next.dataset.board = board;
    }

    if (mine) {
      next.dataset.mine = mine;
    }

    main.append(next);
  } catch (error) {
    if (
      version === state.renderVersion &&
      button.isConnected
    ) {
      button.disabled = false;
    }

    throw error;
  }
}

async function loadMoreBookmarks(button) {
  if (button.disabled) return;

  const before = button.dataset.before;

  if (!validCursor(before)) {
    setMessage("That pagination cursor is invalid.", true);
    return;
  }

  button.disabled = true;

  const version = state.renderVersion;

  try {
    const older = validateBookmarksResponse(
      await api(
        "/api/me/bookmarks?before=" + encodeURIComponent(before),
      ),
    );

    if (
      version !== state.renderVersion ||
      !button.isConnected
    ) {
      return;
    }

    appendPostList(
      main,
      older.bookmarks,
      document,
      state.currentUser,
      BOOKMARKS_EMPTY_TEXT,
    );

    button.remove();

    if (!older.nextBefore || older.bookmarks.length !== 20) {
      return;
    }

    const next = element(
      "button",
      "button button-secondary",
      "Load older saved posts",
    );

    next.type = "button";
    next.dataset.action = "load-more-bookmarks";
    next.dataset.before = String(older.nextBefore);

    main.append(next);
  } catch (error) {
    if (
      version === state.renderVersion &&
      button.isConnected
    ) {
      button.disabled = false;
    }

    throw error;
  }
}

// Card actions shared by every feed surface.
async function submitReaction(button) {
  if (!validId(button.dataset.postId)) {
    throw new Error("Invalid post ID.");
  }

  if (button.dataset.state === "active") {
    await api(
      `/api/posts/${Number(button.dataset.postId)}/reaction`,
      { method: "DELETE" },
    );
  } else {
    await api(
      `/api/posts/${Number(button.dataset.postId)}/reaction`,
      {
        method: "PUT",
        body: { value: button.dataset.value },
      },
    );
  }

  await state.renderRoute(state.activeRoute);
}

export const ACTIONS = {
  "load-more": (button) => loadMorePosts(button),

  reaction: (button) => submitReaction(button),

  "toggle-bookmark": async (button) => {
    if (!validId(button.dataset.postId)) {
      throw new Error("Invalid post ID.");
    }

    const bookmarked =
      String(button.getAttribute("aria-pressed")) === "true";

    await api(
      `/api/posts/${Number(button.dataset.postId)}/bookmark`,
      {
        method: bookmarked ? "DELETE" : "PUT",
      },
    );

    await state.renderRoute(state.activeRoute);

    setMessage(
      bookmarked
        ? "Removed from your saved posts."
        : "Saved.",
    );
  },

  "toggle-subscribe": async (button) => {
    if (!validId(button.dataset.postId)) {
      throw new Error("Invalid post ID.");
    }

    const subscribed = button.dataset.subscribed === "1";

    await api(
      `/api/posts/${Number(button.dataset.postId)}/subscribe`,
      {
        method: subscribed ? "DELETE" : "POST",
      },
    );

    await state.renderRoute(state.activeRoute);

    setMessage(
      subscribed
        ? "You unsubscribed from this thread."
        : "You will get notifications for replies here.",
    );
  },

  "suggestion-status": async (button) => {
    if (!validId(button.dataset.postId)) {
      throw new Error("Invalid post ID.");
    }

    const status = button.dataset.status;

    if (!["open", "resolved", "declined"].includes(status)) {
      throw new Error("Invalid suggestion status.");
    }

    await api(
      `/api/posts/${Number(button.dataset.postId)}/suggestion-status`,
      {
        method: "POST",
        body: { status },
      },
    );

    await state.renderRoute(state.activeRoute);

    setMessage(
      status === "open"
        ? "Suggestion reopened."
        : "Suggestion marked " + status + ".",
    );
  },

  "load-more-bookmarks": (button) =>
    loadMoreBookmarks(button),
};

// Renderer functions are registered in renderRoute's table by name.
export {
  renderHomeRoute,
  renderMineRoute,
  renderCategoryRoute,
  renderBookmarksRoute,
};
