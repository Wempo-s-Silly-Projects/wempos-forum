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


// v4.0 plan 4 Task 9: the header chrome — renderAccountNavigation (mobile
// bar identity, the site-section icon links, chat toggle, profile/saved/
// bell/shield, sign-in toggle) plus the logout action its quiet
// button dispatches. Bodies moved verbatim out of app.js.
import { clearAllShare } from "../share.js";
import { clearAllInvite } from "../invite.js";
import { api, setCsrfToken } from "../api.js";
import { accountActions, element } from "../dom.js";
import { iconButton } from "../icons.js";
import { createLanguagePicker, t } from "../i18n.js";
import { clearAllDrafts } from "../drafts.js";
import { clearAllCatchUp } from "../catch-up.js";
import { clearAllNewcomer } from "../newcomer.js";
import { clearAllPins } from "../chat-pins.js";
import { clearAllMutes } from "../chat-mutes.js";
import { clearAllRecents } from "../gallery-picks.js";
import { clearAllRecentSearches } from "../recent-searches.js";
import { clearAllQuietHours } from "../quiet-hours.js";
import { createNotificationBell } from "../notifications.js";
// The §4b door-swap: every auth link (header Sign in, mobile guest rung)
// targets Wempo Accounts with an origin-only return; logout hands the browser
// to the Accounts sign-out land so the Accounts session clears too.
import {
  wempoAccountsSignInUrl,
  wempoAccountsSignOutUrl,
} from "../sso.js";

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
    : wempoAccountsSignInUrl(location.origin);

  mobileItem.setAttribute(
    "aria-label",
    user ? t("common.profile") : t("common.signIn"),
  );

  mobileItem.title = user ? t("common.profile") : t("common.signIn");

  if (span) {
    span.textContent = user ? t("common.profile") : t("common.signIn");
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
    createSectionLink("lightbulb", "/suggestions", t("nav.suggestions")),
  );

  // Accountability archive (v2.4.1): public to guests and members alike.
  accountActions.append(
    createSectionLink("archive", "/archive", t("nav.archive")),
  );

  accountActions.append(
    createSectionLink("trophy", "/leaderboard", t("nav.leaderboard")),
  );

  accountActions.append(
    createSectionLink("scroll", "/rules", t("nav.rules")),
  );


  if (!currentUser) {
    const signIn = element(
      "a",
      "button button-secondary",
      t("common.signIn"),
    );

    signIn.href = wempoAccountsSignInUrl(location.origin);
    signIn.setAttribute("data-app-link", "");

    accountActions.append(signIn);
    accountActions.append(createLanguagePicker(document));

    markMobileBarItem(null);
    return;
  }

  const profile = createSectionLink(
    "person",
    "/users/" + encodeURIComponent(currentUser.username),
    t("nav.profileOf", { name: currentUser.username }),
  );

  accountActions.append(profile);

  // Bookmarks (C4): the private saved list — members only.
  accountActions.append(
    createSectionLink("bookmarks", "/bookmarks", t("nav.savedPosts")),
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
      t("nav.moderationDesk"),
    );

    accountActions.append(reports);
  }

  const logout = iconButton(document, "logout", {
    className: "button button-quiet icon-button",
    dataset: { action: "logout" },
    ariaLabel: t("common.signOut"),
  });

  accountActions.append(logout);
  accountActions.append(createLanguagePicker(document));

  markMobileBarItem(currentUser);
}

// The bottom app bar's active destination (v4.0 responsive rebuild): the bar
// owns phone navigation, so the current route's item reads aria-current="page"
// and responsive.css paints it with the green accent bar. Runs on every route
// render (after history.pushState, so location.pathname is already the new
// route); items without a match (guests, other pages) keep no current state.
// The Profile/Sign-in rung is looked up BY ID, not by href: its href is
// session-dependent ("/users/<name>" signed in, the Wempo Accounts handoff
// as a guest) and was rewritten earlier in renderAccountNavigation, so a
// href match can never fire for the signed-in profile — the id is the stable
// handle.
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

// Shared-browser privacy: unsent drafts, read marks, chat pins, gallery
// recents, newcomer-card dismissals, quiet hours (wave 5.25) and recent
// searches (wave 5.36) leave with the member. Device preferences (theme, text size, locale, DM effects) stay.
function wipeAccountLocalData() {
  clearAllShare();
  clearAllInvite();
  clearAllDrafts();
  clearAllCatchUp();
  clearAllNewcomer();
  clearAllPins();
  clearAllMutes();
  clearAllRecents();
  clearAllQuietHours();
  clearAllRecentSearches();
}

export const ACTIONS = {
  // The §4b sign-out handoff: the forum's own
  // session clears first (logout POST + CSRF reset), THEN the browser rides
  // to the Accounts sign-out land (?signout=1, no return parameter — with
  // one, the Accounts arrival auto-issues a fresh ticket and bounces the
  // member straight back signed in).
  logout: async () => {
    // Wave 24: the local wipe rides a finally, so a network error or 5xx on
    // the POST still cleans a shared browser; the error then propagates to
    // handleClick's status line and the browser stays put (no fake success).
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      wipeAccountLocalData();
    }

    setCsrfToken("");
    window.location.assign(wempoAccountsSignOutUrl());
  },
};

export { renderAccountNavigation };
