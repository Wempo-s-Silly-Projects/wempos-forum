// v4.0 plan 2, Task 3: the read side of the posts surface — feed queries,
// detail reads, reply pagination, and the row decorators every reader stacks.
// Moved verbatim from api/posts.mjs (see the plan's move list); the write
// routes and the composer stay in posts.mjs.
//
// Module seam (the only one with replies.mjs, Task 4): replies.mjs consumes
// { withReplyMetadata, attachSubReplyCounts, listReplies, banFilterSql }
// — listReplies lives HERE (not replies.mjs as the plan first sketched: its
// body is pure read decoration — POST_SELECT/banFilter/publicPost/
// attachmentRowsForView — and hosting it in the reply-write module would
// need a second, reversed seam; resolved at implementation, recorded in the
// plan-2 ledger). This keeps the posts-feed → replies edge one-directional.
import { attachmentRowsForView } from "./attachments.mjs";
import { bookmarkFlagForViewer, withBookmarkFlags } from "./bookmarks.mjs";
import { subscriberFlagForViewer, withSubscriptionFlags } from "./subscriptions.mjs";
import { pollPayload } from "./polls.mjs";
import {
  SUGGESTION_SCORE_SQL,
  SUGGESTIONS_BOARD,
  boardField,
} from "./boards.mjs";
import {
  encodeActivityCursor,
  encodeScoreCursor,
  parseActivityCursor,
  parseScoreCursor,
} from "./core/cursors.mjs";
import { readSession } from "./core/auth.mjs";
import { HttpError, json } from "./core/http.mjs";
import { POST_SELECT, postById, publicPost, VIEW_INCREMENT_SQL } from "./core/shapers.mjs";
import { canViewPost } from "./core/visibility.mjs";

export { POST_SELECT };

// Attachments metadata rides one batched lookup per page: every serialized
// post gains an `attachments` array (possibly empty, never null/absent) whose
// viewer filtering (author/mod-only pending visibility) lives in
// attachmentRowsForView. This helper never widens a page's visibility SQL —
// it decorates rows only after the cursor/visibility SELECTs come back.
export async function withAttachments(db, viewer, posts) {
  if (!posts.length) return posts;
  const map = await attachmentRowsForView(db, posts.map((post) => post.id), viewer);
  return posts.map((post) => ({ ...post, attachments: map.get(post.id) || [] }));
}

// Feed thread presentation (v2.3): every serialized root post gains
// `replyCount` (ALL comments in the thread — level-1 replies plus sub-replies)
// and `latestReplies` (up to 3 most recent level-1 replies). Reply data rides
// TWO batched read-only queries per page, exactly like the attachments
// metadata: the feed's cursor/visibility SELECTs never change, and these
// helpers decorate rows only after they return.
export const REPLY_SNIPPET_MAX = 80;

export function replySnippet(body) {
  const text = typeof body === "string" ? body : "";
  return text.length > REPLY_SNIPPET_MAX ? text.slice(0, REPLY_SNIPPET_MAX) + "…" : text;
}

// One query for every root on the page. Level-1 replies join their root
// directly (r.parent_id = root); sub-replies join through their level-1 parent
// (l1.parent_id = root). Viewer visibility mirrors listReplies +
// attachSubReplyCounts' member clause ((public AND not banned), or the
// viewer's own reply), and
// the level-2 rows additionally require a viewable level-1 parent — the
// remaining canViewPost ancestor (the root) is guaranteed public by the feed's
// own WHERE. Admin viewers (showAll) drop the member clauses, like everywhere
// else counts run. Irrelevant rows from threads off this page group under ids
// the map lookup simply never reads.
export function replyCountsSql(ids, showAll) {
  const placeholders = ids.map(() => "?").join(", ");
  return "SELECT COALESCE(l1.parent_id, r.parent_id) AS thread_root, COUNT(*) AS reply_count " +
    "FROM posts r JOIN posts l1 ON l1.id = r.parent_id " +
    "WHERE (l1.parent_id IS NULL OR l1.parent_id IN (" + placeholders + ")) " +
    (showAll
      ? "GROUP BY thread_root"
      : "AND ((r.visibility = 'public' AND " + banFilterSql("r") + ") OR r.author_id = ?) " +
        "AND (l1.parent_id IS NULL OR (l1.visibility = 'public' AND " + banFilterSql("l1") + ") OR l1.author_id = ?) " +
        "GROUP BY thread_root");
}

// Per root, at most the 3 most recent level-1 replies, ranked in SQL. Each row
// also carries its sub-reply count with the same visibility semantics the
// replies page exposes. Bind order follows SQL text order for members:
// sub-count viewer id, then the root ids, then the level-1 viewer id.
export function latestRepliesSql(ids, showAll) {
  const placeholders = ids.map(() => "?").join(", ");
  const subCountSelect = "(SELECT COUNT(*) FROM posts c WHERE c.parent_id = r.id" +
    (showAll
      ? ") AS sub_reply_count"
      : " AND ((c.visibility = 'public' AND " + banFilterSql("c") + ") OR c.author_id = ?)) AS sub_reply_count");
  const memberClause = showAll
    ? ""
    : " AND ((r.visibility = 'public' AND " + banFilterSql("r") + ") OR r.author_id = ?)";
  return "SELECT * FROM (" +
    "SELECT r.id, r.parent_id AS thread_root, r.body, r.created_at, r.author_id, " +
    "u.username AS author_username, u.avatar_mime AS author_avatar_mime, " +
    "u.avatar_version AS author_avatar_version, " + subCountSelect + ", " +
    "ROW_NUMBER() OVER (PARTITION BY r.parent_id ORDER BY r.created_at DESC, r.id DESC) AS rn " +
    "FROM posts r JOIN users u ON u.id = r.author_id " +
    "WHERE r.parent_id IN (" + placeholders + ")" + memberClause +
    ") WHERE rn <= 3 ORDER BY thread_root ASC, rn ASC";
}

export async function withReplyMetadata(db, viewer, posts) {
  if (!posts.length) return posts;
  const ids = [...new Set(posts.map((post) => Number(post.id)))];
  // Nuke rule (v3.0.1): reply metadata never counts hidden/banned content —
  // not even for admins. The member clause's `OR author_id = ?` bypass slots
  // bind -1 (never a real author id), so the clause reduces to "public and
  // unbanned only".
  const showAll = false;
  const viewerId = viewer ? Number(viewer.id) : null;
  const countsStatement = db.prepare(replyCountsSql(ids, showAll))
    .bind(...(showAll ? ids : [...ids, -1, -1]));
  const latestStatement = db.prepare(latestRepliesSql(ids, showAll))
    .bind(...(showAll ? ids : [-1, ...ids, -1]));
  const [countResult, latestResult] = await Promise.all([countsStatement.all(), latestStatement.all()]);
  const replyCounts = new Map();
  for (const row of countResult.results || []) {
    replyCounts.set(Number(row.thread_root), Number(row.reply_count || 0));
  }
  const latestByRoot = new Map();
  for (const row of latestResult.results || []) {
    const threadRoot = Number(row.thread_root);
    const rows = latestByRoot.get(threadRoot) || [];
    rows.push({
      id: Number(row.id),
      authorUsername: row.author_username,
      // Same avatar-URL convention as publicPost's author fields.
      avatarUrl: row.author_avatar_mime
        ? "/api/avatars/" + row.author_id + "?v=" + row.author_avatar_version
        : null,
      snippet: replySnippet(row.body),
      createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
      subReplyCount: Number(row.sub_reply_count || 0),
    });
    latestByRoot.set(threadRoot, rows);
  }
  return posts.map((post) => ({
    ...post,
    replyCount: replyCounts.get(Number(post.id)) || 0,
    latestReplies: latestByRoot.get(Number(post.id)) || [],
  }));
}

// Active-ban read filter (v2.4.1): an ACTIVE ban — never revoked, and either
// permanent or not yet expired — hides the author's content at read time. "Now"
// is computed in SQL (bind-free, CAST(strftime('%s','now') AS INTEGER)), so no
// read path's bind order changes and a lapse or revocation restores content
// without any write. Callers exempt the author via their existing `OR
// <alias>.author_id = ?` arms; visibility semantics mirror hidden posts.
export function banFilterSql(alias) {
  const prefix = alias ? alias + "." : "";
  return "NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = " + prefix + "author_id " +
    "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
    "CAST(strftime('%s','now') AS INTEGER)))";
}

export async function listRootPosts(env, viewer, options = {}) {
  const viewerId = viewer ? viewer.id : null;
  let sql = POST_SELECT + "WHERE p.parent_id IS NULL AND p.visibility = 'public' AND " +
    banFilterSql("p") + " ";
  const values = [viewerId || -1];
  if (options.byActivity) {
    // Feed order: most recently bumped conversation first, id as the tiebreaker.
    // Pagination walks the composite key (last_activity_at, id) so a shared
    // timestamp cannot skip or duplicate rows.
    const cursor = options.before;
    if (cursor && cursor.rank === undefined) {
      // Legacy 2-part cursor from an already-open tab.
      sql += "AND (p.last_activity_at < ? OR (p.last_activity_at = ? AND p.id < ?)) ";
      values.push(cursor.seconds, cursor.seconds, cursor.id);
    }
    // The cursor's pinned rank mirrors the leading ORDER BY key.
    if (cursor && cursor.rank === 0) {
      sql += "AND ((p.pinned_at IS NOT NULL AND (p.last_activity_at < ? OR (p.last_activity_at = ? AND p.id < ?))) OR p.pinned_at IS NULL) ";
      values.push(cursor.seconds, cursor.seconds, cursor.id);
    } else if (cursor && cursor.rank === 1) {
      sql += "AND p.pinned_at IS NULL AND (p.last_activity_at < ? OR (p.last_activity_at = ? AND p.id < ?)) ";
      values.push(cursor.seconds, cursor.seconds, cursor.id);
    }
    // Categories (v3.1): a board param scopes the activity feed to that
    // category's roots (cursor format unchanged — every category walks the
    // same composite (pinned, last_activity_at, id) keyset). No board param
    // is the Recent activity homepage: every category mixed.
    if (options.board) {
      sql += "AND p.board = ? ";
      values.push(options.board);
    }
    const pageSize = options.limit || 20;
    sql += "ORDER BY (p.pinned_at IS NULL) ASC, p.last_activity_at DESC, p.id DESC LIMIT " + (pageSize + 1);
    const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
    const rows = result.results || [];
    const hasMore = rows.length > pageSize;
    const shown = rows.slice(0, pageSize);
    const last = shown.length ? shown[shown.length - 1] : null;
    return {
      // Root queries only (parent_id IS NULL): every shown row is a level-0 root.
      posts: await withSubscriptionFlags(env.FORUM_DB, viewer, await withBookmarkFlags(env.FORUM_DB, viewer, await withReplyMetadata(env.FORUM_DB, viewer,
        await withAttachments(env.FORUM_DB, viewer, shown.map((row) => publicPost(row, 0)))))),
      nextBefore: hasMore && last
        ? encodeActivityCursor(last)
        : null,
    };
  }
  if (options.board === SUGGESTIONS_BOARD) {
    // Suggestions feed (v2.4.1): most-upvoted first. The sort key is the net
    // reaction score; the id is the tiebreak, and the pagination cursor walks
    // the composite (score, id) keyset in the established activity-feed style
    // (both keys DESC, `score_id` cursor), so a shared score can neither skip
    // nor repeat a row. Score instability while paginating is accepted on
    // owner instruction. Zero-reaction threads stay visible: they all tie at
    // score 0 and order newest-first, exactly like the general feed's tiebreak.
    const cursor = options.before;
    if (cursor) {
      sql += "AND (" + SUGGESTION_SCORE_SQL + " < ? OR (" + SUGGESTION_SCORE_SQL +
        " = ? AND p.id < ?)) ";
      values.push(cursor.score, cursor.score, cursor.id);
    }
    sql += "AND p.board = 'suggestions' ORDER BY " + SUGGESTION_SCORE_SQL +
      " DESC, p.id DESC LIMIT 21";
    const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
    const rows = result.results || [];
    const hasMore = rows.length > 20;
    const shown = rows.slice(0, 20);
    const last = shown.length ? shown[shown.length - 1] : null;
    return {
      // The suggestions feed rides the same decorator path as the activity
      // feed (root queries only, publicPost level 0), so replyCount,
      // latestReplies, attachments, and publicLevel annotate every card
      // unchanged — the board filter never touches the decoration SQL.
      posts: await withSubscriptionFlags(env.FORUM_DB, viewer, await withBookmarkFlags(env.FORUM_DB, viewer, await withReplyMetadata(env.FORUM_DB, viewer,
        await withAttachments(env.FORUM_DB, viewer, shown.map((row) => publicPost(row, 0)))))),
      // The cursor's score half comes from the row's own like/dislike counts —
      // the identical tally the ORDER BY expression computes, so the emitted
      // cursor always sorts exactly where the row was shown.
      nextBefore: hasMore && last
        ? encodeScoreCursor(last)
        : null,
    };
  }
  if (options.before !== null && options.before !== undefined) {
    sql += "AND p.id < ? ";
    values.push(options.before);
  }
  if (options.authorId) {
    sql += "AND p.author_id = ? ";
    values.push(options.authorId);
  }
  if (options.searchTerm) {
    sql += "AND instr(lower(p.body), ?) > 0 ";
    values.push(options.searchTerm);
  }
  sql += "ORDER BY p.id DESC LIMIT 21";
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  const rows = result.results || [];
  const hasMore = rows.length > 20;
  const shown = rows.slice(0, 20).map((row) => publicPost(row, 0));
  const posts = await withSubscriptionFlags(env.FORUM_DB, viewer, await withBookmarkFlags(env.FORUM_DB, viewer, await withReplyMetadata(env.FORUM_DB, viewer,
    await withAttachments(env.FORUM_DB, viewer, shown))));
  return { posts, nextBefore: hasMore && shown.length ? shown[shown.length - 1].id : null };
}

export async function listReplies(env, postId, viewer, showAll = false, before = null,
  childPublicLevel, extraAttachmentIds = null) {
  const viewerId = viewer ? viewer.id : null;
  const visibilityFilter = showAll
    ? ""
    : "AND ((p.visibility = 'public' AND " + banFilterSql("p") + ") OR p.author_id = ?) ";
  const cursorFilter = before === null ? "" : "AND p.id < ? ";
  const sql = POST_SELECT + "WHERE p.parent_id = ? " + cursorFilter +
    visibilityFilter + "ORDER BY p.id DESC LIMIT 101";
  const values = [viewerId || -1, postId];
  if (before !== null) values.push(before);
  // Nuke rule (v3.0.1): the author bypass binds -1 (never a real author id),
  // so the member clause reduces to "public and unbanned" for every viewer.
  if (!showAll) values.push(-1);
  const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
  const rows = result.results || [];
  const hasMore = rows.length > 100;
  const shown = rows.slice(0, 100);
  const nextBefore = hasMore && shown.length ? Number(shown[shown.length - 1].id) : null;
  // Children of a known-depth target are target depth + 1 (root children are
  // level-1 replies, level-1 children are level-2 replies). When the caller
  // does not pass a level the field is omitted, keeping clients conservative.
  const replies = shown.map((row) => publicPost(row, childPublicLevel)).reverse();
  // ONE attachments lookup covers the whole reply page; callers may fold extra
  // ids in (the detail read folds its parent post in), so a detail response
  // pays exactly one attachments query for the post and all of its replies.
  const attachmentIdSet = new Set(replies.map((reply) => reply.id));
  if (extraAttachmentIds !== null && extraAttachmentIds !== undefined) {
    for (const id of extraAttachmentIds) attachmentIdSet.add(Number(id));
  }
  const attachments = await attachmentRowsForView(
    env.FORUM_DB,
    [...attachmentIdSet],
    viewer,
  );
  return {
    replies: replies.map((reply) => ({ ...reply, attachments: attachments.get(reply.id) || [] })),
    nextBefore,
    attachments,
  };
}

export async function handlePostFeedRoute(request, env, url, path, method) {
  if (path === "/api/posts" && method === "GET") {
    const session = await readSession(request, env);
    // Board param (categories v3.1): absent = the Recent activity homepage
    // (every category mixed, 10 at a time); a whitelisted slug scopes the
    // feed to that category. Unknown values hit boardField's whitelist 400
    // before any database work; suggestions keeps its score-sorted branch.
    const boardRaw = url.searchParams.get("board");
    const board = boardRaw !== null && boardRaw !== "" ? boardField(boardRaw) : null;
    const isSuggestions = board === SUGGESTIONS_BOARD;
    const beforeRaw = url.searchParams.get("before");
    // My posts (v2.5): decided BEFORE cursor parsing — the authorId branch
    // paginates a bare id (profile-route convention), not a composite cursor.
    const mineRaw = url.searchParams.get("mine");
    if (mineRaw !== null && !/^[01]$/.test(mineRaw)) {
      throw new HttpError(400, "The mine param must be 0 or 1.");
    }
    const mineOnly = mineRaw === "1";
    if (mineOnly && !(session && session.user)) {
      throw new HttpError(401, "Sign in to see your posts.");
    }
    let before = null;
    if (mineOnly) {
      if (beforeRaw !== null) {
        if (!/^[0-9]{1,15}$/.test(beforeRaw)) throw new HttpError(400, "That page cursor is invalid.");
        before = Number(beforeRaw);
      }
    } else if (beforeRaw !== null) {
      if (isSuggestions) {
        before = parseScoreCursor(beforeRaw);
        if (!before) throw new HttpError(400, "That page cursor is invalid.");
      } else {
        before = parseActivityCursor(beforeRaw);
        if (!before) throw new HttpError(400, "That page cursor is invalid.");
      }
    }
    // My posts (v2.5): `mine=1` filters the feed to the SESSION's own roots —
    // identity comes from the session only, never a spoofable param. Guests
    // asking for a private view are refused before any database work.
    const feed = await listRootPosts(
      env, session && session.user ? session.user : null,
      mineOnly
        ? { before, authorId: Number(session.user.id) }
        : (board
          ? { before, board, byActivity: true }
          : { before, byActivity: true }),
    );
    return json(feed);
  }
  return null;
}

// Per-reply sub-reply counts go out as ONE D1 batch (one subrequest) — a
// per-reply query loop can exceed the Workers subrequest cap on busy roots.
// Viewer visibility mirrors listReplies: admins see every child, everyone else
// counts only public or their own. Results map back by statement order.
export async function attachSubReplyCounts(env, replies, { showAll, viewerId }) {
  if (!replies.length) return replies;
  const countSql = "SELECT COUNT(*) AS sub_reply_count FROM posts WHERE parent_id = ?" +
    (showAll ? "" : " AND ((visibility = 'public' AND " + banFilterSql("") + ") OR author_id = ?)");
  const countResults = await env.FORUM_DB.batch(
    replies.map((reply) => env.FORUM_DB.prepare(countSql)
      .bind(...(showAll ? [reply.id] : [reply.id, -1]))),
  );
  return replies.map((reply, index) => {
    const countRow = countResults[index] && countResults[index].results
      ? countResults[index].results[0]
      : null;
    return {
      ...reply,
      subReplyCount: countRow ? Number(countRow.sub_reply_count || 0) : 0,
    };
  });
}

export async function handlePostDetailRoute(request, env, url, path, method) {
  const postMatch = path.match(/^\/api\/posts\/([0-9]+)$/);
  if (postMatch && method === "GET") {
    const postId = Number(postMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const viewerId = viewer ? viewer.id : null;
    const showAll = Boolean(viewer && viewer.role === "owner");
    const row = await postById(env, postId, viewerId);
    if (!(await canViewPost(env, row, viewer))) throw new HttpError(404, "Post not found.");
    // View counter (v2.4.3, raw impressions): every non-author detail read is
    // one view. RETURNING keeps the payload's count fresh; a failed/0-change
    // increment (post deleted mid-request) just keeps the stale read value.
    const isOwnView = viewer && viewer.id === Number(row.author_id);
    if (!isOwnView) {
      try {
        const counted = await env.FORUM_DB.prepare(VIEW_INCREMENT_SQL).bind(postId).first();
        const fresh = counted && counted.view_count !== undefined ? Number(counted.view_count) : null;
        if (fresh !== null) row.view_count = fresh;
      } catch {
        // Counting is best-effort; a failed increment never fails the read.
      }
    }
    // Depth annotation: this post is a root when parent_id is null, else a
    // level-1 reply; its direct replies are one level deeper.
    const detailDepth = row.parent_id ? 1 : 0;
    const post = publicPost(row, detailDepth);
    // The detail post's id folds into the replies page's single attachments
    // lookup, so the whole detail read pays one attachments query.
    const replyPage = await listReplies(env, postId, viewer, showAll, null,
      detailDepth + 1, [Number(row.id)]);
    // Same batched count pattern as the replies page (attachSubReplyCounts).
    post.replies = await attachSubReplyCounts(env, replyPage.replies, {
      showAll,
      viewerId,
    });
    post.repliesNextBefore = replyPage.nextBefore;
    post.attachments = replyPage.attachments.get(Number(row.id)) || [];
    // Thread subscriptions (C1): the detail carries the viewer's subscribed
    // state (root-only dimension — replies read false without a query, like
    // boards read 'general' on pre-migration rows).
    post.subscribed = await subscriberFlagForViewer(env.FORUM_DB, viewerId, row);
    // Bookmarks (C4): the detail carries the viewer's saved state too (guests
    // read no such query — the field is simply absent for them).
    if (viewerId !== null) {
      post.viewerBookmarked = await bookmarkFlagForViewer(env.FORUM_DB, viewerId, postId);
    }
    // Polls (C3): the poll rides the ROOT's detail read (replies carry none).
    // Results are always visible; the viewer's own option rides for members.
    if (!row.parent_id) {
      const poll = await pollPayload(env.FORUM_DB, postId, viewerId);
      if (poll) post.poll = poll;
    }
    return json(post);
  }
  return null;
}
