
// v4.0 plan 4 Task 9: the header chrome — renderAccountNavigation (mobile
// bar identity, the site-section icon links, chat toggle, profile/saved/
// bell/shield, sign-in toggle) plus the logout action its quiet
// button dispatches. Bodies moved verbatim out of app.js.
import { api, setCsrfToken } from "../api.js";
import { accountActions, element, setMessage } from "../dom.js";
import { iconButton } from "../icons.js";
import { createNotificationBell } from "../notifications.js";
import { createChatButton } from "../chat.js";
import { state } from "../state.js";

function isValidUser(user) {
  return Boolean(
    user &&
    typeof user === "object" &&
    typeof user.username === "string" &&
    user.username.length > 0 &&
    typeof user.role === "string",
  );
}

function getMobileIdentityItem() {
  return (
    document.querySelector("#mobile-signin") ||
    document.querySelector("#mobile-profile")
  );
}

function updateMobileIdentity(user) {
  const mobileItem = getMobileIdentityItem();

  if (!mobileItem) {
    return;
  }

  const span = mobileItem.querySelector("span:last-of-type");

  mobileItem.id = user ? "mobile-profile" : "mobile-signin";
  mobileItem.href = user
    ? "/users/" + encodeURIComponent(user.username)
    : "/#join";

  mobileItem.setAttribute(
    "aria-label",
    user ? "Profile" : "Sign in",
  );

  mobileItem.title = user ? "Profile" : "Sign in";

  if (span) {
    span.textContent = user ? "Profile" : "Sign in";
  }

  if (user) {
    mobileItem.dataset.appLink = "";
  } else {
    mobileItem.removeAttribute("data-app-link");
  }
}

function createSectionLink(icon, href, label) {
  const link = iconButton(document, icon, {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: label,
    dataset: { href },
  });

  link.setAttribute("data-app-link", "");

  return link;
}

function normaliseUnreadCount(value) {
  const count = Number(value);

  return Number.isSafeInteger(count) && count >= 0
    ? count
    : 0;
}

function renderAccountNavigation(user, unreadNotifications = 0) {
  const currentUser = isValidUser(user) ? user : null;

  accountActions.replaceChildren();

  // The mobile bar's last item mirrors the session: Profile (signed in) --
  // the static markup ships a Sign-in item for guests; the id marks it.
  updateMobileIdentity(currentUser);

  // Suggestions board link (v2.4.1): the header's site-section link, styled
  // exactly like the links around it and visible to guests and signed-in
  // members alike; internal navigation handles it like every other header
  // anchor. The brand stays Home.
  accountActions.append(
    createSectionLink("lightbulb", "/suggestions", "Suggestions"),
  );

  // Accountability archive (v2.4.1): public to guests and members alike.
  accountActions.append(
    createSectionLink("archive", "/archive", "Archive"),
  );

  accountActions.append(
    createSectionLink("trophy", "/leaderboard", "Leaderboard"),
  );

  accountActions.append(
    createSectionLink("scroll", "/rules", "Rules"),
  );

  // Live chat (v3.1): the panel toggle carries the online counter. Guests
  // read the stream and see the count; sending needs a session.
  accountActions.append(createChatButton(document));

  if (!currentUser) {
    const signIn = element(
      "a",
      "button button-secondary",
      "Sign in",
    );

    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");

    accountActions.append(signIn);

    markMobileBarItem(null);
    return;
  }

  const profile = createSectionLink(
    "person",
    "/users/" + encodeURIComponent(currentUser.username),
    "Profile — " + currentUser.username,
  );

  accountActions.append(profile);

  // Bookmarks (C4): the private saved list — members only.
  accountActions.append(
    createSectionLink("bookmarks", "/bookmarks", "Saved posts"),
  );

  accountActions.append(
    createNotificationBell(
      normaliseUnreadCount(unreadNotifications),
      document,
    ),
  );

  if (
    currentUser.role === "owner" ||
    currentUser.role === "admin"
  ) {
    const reports = createSectionLink(
      "shield",
      "/admin",
      "Moderation desk",
    );

    accountActions.append(reports);
  }

  const logout = iconButton(document, "logout", {
    className: "button button-quiet icon-button",
    dataset: { action: "logout" },
    ariaLabel: "Sign out",
  });

  accountActions.append(logout);

  markMobileBarItem(currentUser);
}

// The bottom app bar's active destination (v4.0 responsive rebuild): the bar
// owns phone navigation, so the current route's item reads aria-current="page"
// and responsive.css paints it with the green accent bar. Runs on every route
// render (after history.pushState, so location.pathname is already the new
// route); items without a match (guests, other pages) keep no current state.
// The Profile/Sign-in rung is looked up BY ID, not by href: its href is
// session-dependent ("/users/<name>" signed in, "/#join" as a guest) and was
// rewritten earlier in renderAccountNavigation, so a href match can never
// fire for the signed-in profile — the id is the stable handle.
function markMobileBarItem(user) {
  const path = location.pathname;

  const isSelfProfile =
    Boolean(user) &&
    path === "/users/" + encodeURIComponent(user.username);

  const matches = [
    ["/", path === "/"],
    ["/mine", path === "/mine"],
    [
      "/suggestions",
      path === "/suggestions" || path === "/c/suggestions",
    ],
    ["/notifications", path === "/notifications"],
  ];

  for (const [href, active] of matches) {
    const item = Array.from(
      document.querySelectorAll(".mobile-bar-item"),
    ).find((candidate) => candidate.getAttribute("href") === href);

    if (!item) {
      continue;
    }

    if (active) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  }

  const profileItem = document.querySelector(
    "#mobile-profile, #mobile-signin",
  );

  if (profileItem) {
    if (isSelfProfile) {
      profileItem.setAttribute("aria-current", "page");
    } else {
      profileItem.removeAttribute("aria-current");
    }
  }
}

export const ACTIONS = {
  logout: async () => {
    await api("/api/auth/logout", { method: "POST" });

    setCsrfToken("");
    state.router.navigate("/");
    setMessage("You are signed out.");
  },
};

export { renderAccountNavigation };
