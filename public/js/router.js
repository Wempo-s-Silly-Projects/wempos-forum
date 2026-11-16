import { BOARD_BY_SLUG } from "./boards.js";

export const isPlainLeftClick = (event) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey &&
  !event.shiftKey && !event.altKey;

export const routeForPath = (pathname, search = "") => {
  if (pathname === "/setup") return { name: "setup" };
  // The moderation desk (v4.2): a section-routed panel — /admin is the
  // overview, /admin/<slug> a dedicated page. Unknown slugs still route (the
  // desk falls back to the overview) so old links like /admin/reports keep
  // working as the reports section.
  const adminSection = pathname.match(/^\/admin(?:\/([\w-]+))?$/);
  if (adminSection) return { name: "admin", section: adminSection[1] || "dashboard" };
  if (pathname === "/notifications") return { name: "notifications" };
  if (pathname === "/bookmarks") return { name: "bookmarks" };
  if (pathname === "/chat") return { name: "chat" };
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
