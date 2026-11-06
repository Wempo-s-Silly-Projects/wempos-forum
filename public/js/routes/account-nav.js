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
  accountActions.append(createNotificationBell(unreadNotifications, document));
  if (user.role === "owner" || user.role === "admin") {
    const reports = iconButton(document, "shield", {
      tagName: "a",
      className: "button button-secondary icon-button",
      dataset: { href: "/admin" },
    });
    accountActions.append(reports);
  }
  const logout = iconButton(document, "logout", {
    className: "button button-quiet icon-button",
    dataset: { action: "logout" },
  });
  accountActions.append(logout);
  markMobileBarItem(user);
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
  const isSelfProfile = Boolean(user) && path === "/users/" + encodeURIComponent(user.username);
  const matches = [
    ["/", path === "/"],
    ["/mine", path === "/mine"],
    ["/suggestions", path === "/suggestions" || path === "/c/suggestions"],
    ["/notifications", path === "/notifications"],
  ];
  for (const [href, active] of matches) {
    const item = document.querySelector(`.mobile-bar-item[href="${CSS.escape(href)}"]`);
    if (item) {
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
  }
  const profileItem = document.querySelector("#mobile-profile, #mobile-signin");
  if (profileItem) {
    if (isSelfProfile) profileItem.setAttribute("aria-current", "page");
    else profileItem.removeAttribute("aria-current");
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
