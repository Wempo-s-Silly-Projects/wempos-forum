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

// One navigation list, two renderers (v5.58, ORGANIZE #3; map in
// docs/ia-map.md). The desktop header (routes/account-nav.js) and the phone
// bar draw every destination from NAV_ITEMS, so the two can never drift:
//   header: "brand"   — the logo link (index.html), not drawn by the nav;
//           "direct"  — its own header item;
//           "browse"  — inside the Browse menu;
//           "account" — inside the Account menu (members only).
//   mobile: "bar"     — one of the phone bar's slots;
//           "more"    — inside the bar's More menu (Browse group first, then
//                       the Account group).
// audience: "all" | "guest" | "member" (staff included) | "staff".
// guestOnMobile: the phone bar has always shown My posts and Alerts to guests
// (each page is a sign-in prompt for them); kept so nothing disappears.
// Pure data: nothing here stores, fetches or touches the DOM.
import { SETTINGS_PATH } from "./settings-groups.js";

export const HEADER_ITEM_LIMIT = 7;
export const MOBILE_BAR_LIMIT = 5;

const item = (fields) => Object.freeze({ guestOnMobile: false, ...fields });

export const NAV_ITEMS = Object.freeze([
  item({ id: "home", href: "/", icon: "home", labelKey: "shell.home", mobileLabelKey: "shell.home",
    shortKey: "shell.home", audience: "all", header: "brand", mobile: "bar" }),
  item({ id: "suggestions", href: "/suggestions", icon: "lightbulb", labelKey: "nav.suggestions",
    audience: "all", header: "browse", mobile: "more" }),
  item({ id: "archive", href: "/archive", icon: "archive", labelKey: "nav.archive",
    audience: "all", header: "browse", mobile: "more" }),
  item({ id: "leaderboard", href: "/leaderboard", icon: "trophy", labelKey: "nav.leaderboard",
    audience: "all", header: "browse", mobile: "more" }),
  item({ id: "rules", href: "/rules", icon: "scroll", labelKey: "nav.rules",
    audience: "all", header: "browse", mobile: "more" }),
  item({ id: "week", href: "/week", icon: "calendar", labelKey: "week.title",
    audience: "all", header: "browse", mobile: "more" }),
  item({ id: "tags", href: "/tags", icon: "tag", labelKey: "nav.tags",
    audience: "all", header: "browse", mobile: "more" }),
  item({ id: "saved", href: "/bookmarks", icon: "bookmarks", labelKey: "nav.savedPosts",
    audience: "member", header: "direct", mobile: "more" }),
  item({ id: "mine", href: "/mine", icon: "list", labelKey: "feed.myPosts", mobileLabelKey: "shell.myPosts",
    shortKey: "shell.myPosts", audience: "member", guestOnMobile: true, header: "direct", mobile: "bar" }),
  item({ id: "settings", href: SETTINGS_PATH, icon: "sliders", labelKey: "settings.title",
    audience: "member", header: "direct", mobile: "more" }),
  // The header draws this one as the notification bell (unread dot).
  item({ id: "notifications", href: "/notifications", icon: "bell", labelKey: "bell.label",
    mobileLabelKey: "shell.notifications", shortKey: "shell.alertsShort",
    audience: "member", guestOnMobile: true, header: "direct", mobile: "bar" }),
  // Session-dependent hrefs: the Wempo Accounts handoff / the member's page.
  item({ id: "signin", href: null, icon: "logout", labelKey: "common.signIn", mobileLabelKey: "shell.signIn",
    shortKey: "shell.signIn", audience: "guest", header: "direct", mobile: "bar" }),
  item({ id: "profile", href: null, icon: "person", labelKey: "nav.profileOf", mobileLabelKey: "common.profile",
    shortKey: "common.profile", audience: "member", header: "account", mobile: "bar" }),
  item({ id: "desk", href: "/admin", icon: "shield", labelKey: "nav.moderationDesk",
    audience: "staff", header: "account", mobile: "more" }),
  // The keyboard shortcuts sheet (shortcut-sheet.js), reused as is.
  item({ id: "shortcuts", kind: "sheet", href: null, labelKey: "shortcuts.title",
    audience: "member", header: "account", mobile: "more" }),
  item({ id: "logout", kind: "action", action: "logout", href: null, icon: "logout", labelKey: "common.signOut",
    audience: "member", header: "account", mobile: "more" }),
]);

// "guest" | "member" | "staff"
export const navRoleOf = (user) => {
  if (!user) return "guest";
  return user.role === "owner" || user.role === "admin" ? "staff" : "member";
};

function shownTo(item, role, surface) {
  if (item.audience === "all") return true;
  if (item.audience === "guest") return role === "guest";
  if (item.audience === "staff") return role === "staff";
  return role !== "guest" || (surface === "mobile" && item.guestOnMobile);
}

// The items one role sees on one surface ("header" | "mobile"), in list order.
export const navItemsFor = (role, surface) => NAV_ITEMS.filter((entry) => shownTo(entry, role, surface));
