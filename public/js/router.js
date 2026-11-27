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

import { BOARD_BY_SLUG } from "./boards.js";

export const isPlainLeftClick = (event) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey &&
  !event.shiftKey && !event.altKey;

// Feed views (wave 33): `?view=new` on the home and category feeds (the
// Unanswered view was removed Nov 21). Anything else (or Suggestions, which has
// its own order) is the default view, and the route object stays exactly
// { name, board? } — so an old `?view=unanswered` link just opens the default.
export const FEED_VIEWS = ["new"];

const withFeedView = (route, search) => {
  const view = new URLSearchParams(search).get("view");
  return FEED_VIEWS.includes(view) && route.board !== "suggestions" ? { ...route, view } : route;
};

// Search filters (wave 5.36): `?since=` and `?sort=` on a search. Only a
// known non-default value rides the route, so a plain `/?q=` route stays
// exactly { name, query } and an unknown value just opens the default.
export const SEARCH_SINCE = Object.freeze(["any", "week", "month", "year"]);
export const SEARCH_SORTS = Object.freeze(["relevant", "new"]);

export const searchFilters = (params) => {
  const since = params.get("since");
  const sort = params.get("sort");
  return {
    ...(SEARCH_SINCE.includes(since) && since !== SEARCH_SINCE[0] ? { since } : {}),
    ...(SEARCH_SORTS.includes(sort) && sort !== SEARCH_SORTS[0] ? { sort } : {}),
  };
};

// Every route NAME routeForPath can return (tests pin the coverage). The
// anonymous web-vitals beacon (public/js/vitals.js, api/vitals.mjs) uses this
// as its allow-list: a page TYPE, never a path, id or slug.
export const ROUTE_NAMES = Object.freeze([
  "setup", "home", "admin", "notifications", "bookmarks", "category", "archive", "mine", "leaderboard",
  "rules", "week", "join", "tags", "tag", "post", "profile", "search", "settings", "full-search",
  "not-found",
]);

// Page routes a module owns: route name → module id (docs/modules.md). While
// the module is off the worker answers the page with 404 and app.js paints
// the not-found view, so the module's code never loads. "search" (the
// classic /?q= page) is core; "full-search" (/search) is the search module.
export const MODULE_ROUTES = Object.freeze({ "full-search": "search" });
export const routeModuleId = (name) => (Object.hasOwn(MODULE_ROUTES, name) ? MODULE_ROUTES[name] : null);

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
  // working as the reports section. v5.92: merged desk tabs read ?view= (a
  // short slug; anything else is dropped and the tab opens its default view).
  const adminSection = pathname.match(/^\/admin(?:\/([\w-]+))?$/);
  if (adminSection) {
    const view = new URLSearchParams(search).get("view");
    return {
      name: "admin",
      section: adminSection[1] || "dashboard",
      ...(view && /^[a-z-]{1,20}$/.test(view) ? { view } : {}),
    };
  }
  if (pathname === "/notifications") return { name: "notifications" };
  // Saved posts by board (wave 36): /bookmarks?board=<slug>; an unknown
  // slug degrades to the whole list rather than a 404.
  if (pathname === "/bookmarks") {
    // v5.39.0: /bookmarks?folder=<id> opens one bookmark folder; a malformed
    // id degrades to the whole list.
    const folder = new URLSearchParams(search).get("folder");
    if (folder && /^[1-9][0-9]{0,14}$/.test(folder)) return { name: "bookmarks", folder: Number(folder) };
    const board = new URLSearchParams(search).get("board");
    return board && Object.hasOwn(BOARD_BY_SLUG, board) ? { name: "bookmarks", board } : { name: "bookmarks" };
  }
  // Categories (v3.1, Discourse-style): /c/<slug> is the canonical category
  // route; /suggestions stays as a live alias (the header lightbulb and the
  // mobile bar's Suggest item both point at it). Unknown slugs 404 like any
  // other unknown path.
  if (pathname === "/suggestions") return { name: "category", board: "suggestions" };
  if (pathname === "/archive") return { name: "archive" };
  if (pathname === "/mine") return { name: "mine" };
  if (pathname === "/leaderboard") return { name: "leaderboard" };
  if (pathname === "/rules") return { name: "rules" };
  // This week (v5.35): the busiest threads, newest Showcase builds and the
  // staff pick of the last 7 days.
  if (pathname === "/week") return { name: "week" };
  // The search module (docs/modules.md): /search?q=<words>&sort=new is the
  // full-text page; an empty q shows the box. Only the non-default sort
  // rides the route.
  if (pathname === "/search") {
    const params = new URLSearchParams(search);
    const query = params.get("q")?.trim() ?? "";
    return { name: "full-search", query, ...(params.get("sort") === "new" ? { sort: "new" } : {}) };
  }
  // Invite links (v5.34): /join?ref=<username>; a malformed ref is "" (the
  // page still shows, it just credits no one). Same shape as invite.js.
  if (pathname === "/join") {
    const ref = new URLSearchParams(search).get("ref") ?? "";
    return { name: "join", ref: /^[A-Za-z0-9_]{3,24}$/.test(ref) ? ref : "" };
  }
  const category = pathname.match(/^\/c\/([a-z0-9-]+)$/);
  if (category) {
    // Own keys only (v5.4): /c/constructor must not match Object.prototype.
    return Object.hasOwn(BOARD_BY_SLUG, category[1])
      ? withFeedView({ name: "category", board: category[1] }, search)
      : { name: "not-found" };
  }
  // The tag index: every tag on the forum, linking to its /tag/<slug> page.
  if (pathname === "/tags") return { name: "tags" };
  // Thread tags (v5.44): /tag/<slug>; the slug shape is the server's
  // ([a-z0-9-]{2,24}), anything else is a 404 like any unknown path.
  const tag = pathname.match(/^\/tag\/([a-z0-9-]{2,24})$/);
  if (tag) return { name: "tag", slug: tag[1] };
  const post = pathname.match(/^\/posts\/(\d+)$/);
  if (post) return { name: "post", id: Number(post[1]) };
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
    const params = new URLSearchParams(search);
    const query = params.get("q")?.trim() ?? "";
    if (query) return { name: "search", query, ...searchFilters(params) };
    // Account settings hub (v5.56): /?settings is the home page's settings
    // view (the page that always hosted them), so no new top-level path.
    return params.has("settings") ? { name: "settings" } : withFeedView({ name: "home" }, search);
  }
  return { name: "not-found" };
}

export const startRouter = (onRoute) => {
  const dispatch = () => onRoute(routeForPath(location.pathname, location.search));
  window.addEventListener("popstate", dispatch);
  dispatch();
  return {
    // replace (wave 5.6 F1): swap the current entry instead of adding one, so
    // a page that no longer exists (a just-deleted thread) leaves history and
    // Back never asks the server for it again.
    navigate(path, { replace = false } = {}) {
      if (replace) history.replaceState({}, "", path);
      else history.pushState({}, "", path);
      dispatch();
    },
  };
}
