// v4.0 plan 4 Task 9: the header chrome — renderAccountNavigation (mobile
// bar identity, the site-section icon links, chat toggle, profile/saved/
// appeals/bell/shield, sign-in toggle) plus the logout action its quiet
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
  // Appeals (v3.1): the member surface for auto-mod decisions and history.
  const appeals = iconButton(document, "flag", {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: "Appeals",
    dataset: { href: "/appeals" },
  });
  appeals.setAttribute("data-app-link", "");
  accountActions.append(appeals);
  accountActions.append(createNotificationBell(unreadNotifications, document));
  if (user.role === "owner" || user.role === "admin") {
    const reports = iconButton(document, "shield", {
      tagName: "a",
      className: "button button-secondary icon-button",
      dataset: { href: "/admin/reports" },
    });
    accountActions.append(reports);
  }
  const logout = iconButton(document, "logout", {
    className: "button button-quiet icon-button",
    dataset: { action: "logout" },
  });
  accountActions.append(logout);
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
