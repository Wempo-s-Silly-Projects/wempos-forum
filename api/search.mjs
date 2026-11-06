// v4.0 plan 2, Task 6: the search route — member search, post-text search
// (through the feed module's listRootPosts), and deep reply-text search.
// Moved verbatim from api/posts.mjs.
import { SEARCH_USERS_SQL } from "../constants.mjs";
import { banFilterSql, listRootPosts } from "./posts-feed.mjs";
import { readSession } from "./core/auth.mjs";
import { HttpError, json } from "./core/http.mjs";
import { publicPost, publicUser, userByUsernameKey } from "./core/shapers.mjs";
import { viewerBlockFilterSql } from "./core/blocks.mjs";
import { canViewPost } from "./core/visibility.mjs";

export async function handleSearchRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/search" && method === "GET") {
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (!query || query.length > 100) {
      if (!query) return json({ users: [], posts: [] });
      throw new HttpError(400, "Search must be 1–100 characters long.");
    }
    // Search upgrades (v2.5): `by=<username>` filters to a member's roots;
    // `in=replies` deep-searches reply text. The classic shape (users+posts)
    // stays byte-identical when both are absent.
    const byRaw = url.searchParams.get("by");
    const inRaw = (url.searchParams.get("in") || "").trim().toLowerCase();
    if (inRaw && inRaw !== "replies") {
      throw new HttpError(400, "The in param must be 'replies'.");
    }
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    let authorId = null;
    if (byRaw !== null) {
      const author = await userByUsernameKey(env, byRaw.trim().toLowerCase());
      // An unknown name answers an EMPTY result — search treats it as no
      // matches, never an error (it also feeds the People panel).
      authorId = author ? Number(author.id) : -1;
    }
    // Blocks (v4.4): block-paired members don't surface in each other's
    // member results — the profile read would be refused anyway. The clause
    // rides BEFORE SEARCH_USERS_SQL's ORDER BY/LIMIT suffix.
    const userBlockFilter = viewerBlockFilterSql(viewer, "id");
    const usersSql = userBlockFilter
      ? SEARCH_USERS_SQL.replace(" ORDER BY username_key", " " + userBlockFilter.trim() + " ORDER BY username_key")
      : SEARCH_USERS_SQL;
    const users = await db.prepare(usersSql)
      .bind(...(userBlockFilter ? [query, query, viewer.id, viewer.id] : [query, query])).all();
    const posts = await listRootPosts(env, viewer,
      authorId !== null ? { searchTerm: query, authorId } : { searchTerm: query });
    const payload = {
      users: (users.results || []).map(publicUser),
      posts: posts.posts,
    };
    if (inRaw === "replies") {
      payload.replies = await searchReplies(env, viewer, query, authorId);
    }
    return json(payload);
  }
  return null;
}

// Deep reply search (v2.5): flat matching-reply rows, each gated through
// canViewPost in JS after the fetch (one gate per candidate — ≤21 small
// queries — reusing the EXACT hide/ban/ancestor semantics every other read
// uses; nothing can leak through search's chain checks).
export async function searchReplies(env, viewer, query, authorId) {
  const viewerId = viewer ? viewer.id : null;
  const sql =
    "SELECT r.id, r.author_id, r.parent_id, r.body, r.visibility, r.created_at, r.board, r.view_count, r.pinned_at, r.edited_at, " +
    "(SELECT COUNT(*) FROM reactions rx WHERE rx.post_id = r.id AND rx.value = 'like') AS like_count, " +
    "(SELECT COUNT(*) FROM reactions rx WHERE rx.post_id = r.id AND rx.value = 'dislike') AS dislike_count, " +
    "(SELECT rx.value FROM reactions rx WHERE rx.post_id = r.id AND rx.user_id = ?) AS viewer_reaction, " +
    "(SELECT parent.body FROM posts parent WHERE parent.id = r.parent_id) AS parent_body, " +
    "r.last_activity_at, " +
    "u.username AS author_username, u.avatar_mime AS author_avatar_mime, " +
    "u.avatar_version AS author_avatar_version " +
    "FROM posts r JOIN users u ON u.id = r.author_id " +
    "WHERE r.parent_id IS NOT NULL AND instr(lower(r.body), ?) > 0 " +
    (authorId !== null ? "AND r.author_id = ? " : "") +
    "AND ((r.visibility = 'public' AND " + banFilterSql("r") + ") OR r.author_id = ?) " +
    "ORDER BY r.id DESC LIMIT 21";
  const values = [];
  values.push(viewerId || -1); // viewer_reaction's subselect first
  values.push(query);
  if (authorId !== null) values.push(authorId);
  // Nuke rule: the bypass never matches (public + unbanned only).
  values.push(-1);
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  const rows = [];
  for (const row of (result.results || [])) {
    if (!(await canViewPost(env, row, viewer))) continue;
    rows.push({ ...publicPost(row, 1), threadId: await threadRootId(env, row) });
  }
  return rows;
}

// A searched reply's link target: the THREAD root (its parent, or the
// parent's parent for a level-2 reply) — the detail page the member can open.
export async function threadRootId(env, row) {
  const firstParent = await env.FORUM_DB.prepare(
    "SELECT id, parent_id FROM posts WHERE id = ? LIMIT 1",
  ).bind(Number(row.parent_id)).first();
  if (!firstParent || firstParent.parent_id === null || firstParent.parent_id === undefined) {
    return Number(row.parent_id);
  }
  return Number(firstParent.parent_id);
}
