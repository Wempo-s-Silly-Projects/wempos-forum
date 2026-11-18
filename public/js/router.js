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

import { BOARD_BY_SLUG } from "./boards.js";

export const isPlainLeftClick = (event) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey &&
  !event.shiftKey && !event.altKey;

export const routeForPath = (pathname, search = "") => {
  if (pathname === "/setup") return { name: "setup" };
  // The §4b door-swap: the password login/register pages are gone — any stale
  // /login or /register path degrades to the home route (a bare "#/login"
  // hash matches "/" with the fragment ignored, so it already lands here):
  // a signed-out open shows the home door panel, a signed-in one the app
  // shell.
  if (pathname === "/login" || pathname === "/register") return { name: "home" };
  // The moderation desk (v4.2): a section-routed panel — /admin is the
  // overview, /admin/<slug> a dedicated page. Unknown slugs still route (the
  // desk falls back to the overview) so old links like /admin/reports keep
  // working as the reports section.
  const adminSection = pathname.match(/^\/admin(?:\/([\w-]+))?$/);
  if (adminSection) return { name: "admin", section: adminSection[1] || "dashboard" };
  if (pathname === "/notifications") return { name: "notifications" };
  if (pathname === "/bookmarks") return { name: "bookmarks" };
  // Categories (v3.1, Discourse-style): /c/<slug> is the canonical category
  // route; /suggestions stays as a live alias (the header lightbulb and the
  // mobile bar's Suggest item both point at it). Unknown slugs 404 like any
  // other unknown path.
  if (pathname === "/suggestions") return { name: "category", board: "suggestions" };
  if (pathname === "/archive") return { name: "archive" };
  if (pathname === "/mine") return { name: "mine" };
  if (pathname === "/leaderboard") return { name: "leaderboard" };
  if (pathname === "/rules") return { name: "rules" };
  const category = pathname.match(/^\/c\/([a-z0-9-]+)$/);
  if (category) {
    return BOARD_BY_SLUG[category[1]]
      ? { name: "category", board: category[1] }
      : { name: "not-found" };
  }
  const post = pathname.match(/^\/posts\/(\d+)$/);
  if (post) return { name: "post", id: Number(post[1]) };
  // The report task page (5.0 rethink, wave 3): the first dialog retirement —
  // a post's report form at its own addressable URL.
  const report = pathname.match(/^\/posts\/(\d+)\/report$/);
  if (report) return { name: "post-report", id: Number(report[1]) };
  const user = pathname.match(/^\/users\/([^/]+)$/);
  if (user) {
    try {
      return { name: "profile", username: decodeURIComponent(user[1]) };
    } catch (error) {
      if (error instanceof URIError) return { name: "not-found" };
      throw error;
    }
  }
  if (pathname === "/") {
    const query = new URLSearchParams(search).get("q")?.trim() ?? "";
    return query ? { name: "search", query } : { name: "home" };
  }
  return { name: "not-found" };
}

export const startRouter = (onRoute) => {
  const dispatch = () => onRoute(routeForPath(location.pathname, location.search));
  window.addEventListener("popstate", dispatch);
  dispatch();
  return {
    navigate(path) {
      history.pushState({}, "", path);
      dispatch();
    },
  };
}
