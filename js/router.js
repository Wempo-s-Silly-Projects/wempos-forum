export function routeForPath(pathname, search = "") {
  if (pathname === "/setup") return { name: "setup" };
  if (pathname === "/admin/reports") return { name: "admin" };
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

export function startRouter(onRoute) {
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
