// Post feed, post detail, replies, reactions, and search routes.
import { REPLY_BUMP_SQL, SEARCH_USERS_SQL, STAGED_REPLY_BUMP_SQL, THREAD_REPLY_INSERT_SQL, THREAD_REPLY_INSERT_STAGED_SQL } from "../constants.mjs";
import {
  attachmentRowsForView,
  insertAttachments,
  MAX_ATTACHMENT_FILES,
  readComposedBody,
} from "./attachments.mjs";
import { applyWordFilter } from "./filter.mjs";
import { notificationBatchStatements } from "./notifications.mjs";
import { mentionFanOutStatements } from "./mentions.mjs";
import { pollPayload } from "./polls.mjs";
import { bookmarkFlagForViewer, withBookmarkFlags } from "./bookmarks.mjs";
import { runFanOutChunks, subscriberFlagForViewer, subscriptionReplyFanOut } from "./subscriptions.mjs";
import {
  archivePostRowsStatement,
  assertNotBanned,
  canViewPost,
  HttpError,
  json,
  nowSeconds,
  POST_SELECT,
  postById,
  publicPost,
  publicUser,
  rateLimit,
  readJson,
  readSession,
  requireMutationApplied,
  requireTurnstile,
  requireUser,
  requiredText,
  sha256Hex,
  userByUsernameKey,
  VIEW_INCREMENT_SQL,
} from "./shared.mjs";

export { POST_SELECT };

// Attachments metadata rides one batched lookup per page: every serialized
// post gains an `attachments` array (possibly empty, never null/absent) whose
// viewer filtering (author/moderator-only pending visibility) lives in
// attachmentRowsForView. This helper never widens a page's visibility SQL —
// it decorates rows only after the cursor/visibility SELECTs come back.
async function withAttachments(db, viewer, posts) {
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
const REPLY_SNIPPET_MAX = 80;

// Composer body cap (owner-set, post-spam response): root post AND reply
// bodies accept at most 1,000 characters. Kept module-local because
// constants.mjs holds platform-only constants; the frontend mirrors the number
// in public/js/composer-limits.js (COMPOSER_MAX_CHARS feeds both the textarea
// maxLength and the live counter).
const MAX_COMPOSER_BODY_CHARS = 1000;

// Boards (v2.4.1): a root-only dimension. Root posts carry the board their
// composer chose; replies inherit their thread root's board at creation (the
// create route resolves the root anyway for the bump), and every pre-migration
// row is 'general' (migration 0006's DEFAULT backfill). The whitelist lives
// here — SQLite cannot gain a CHECK via ALTER TABLE ADD COLUMN — and the feeds
// read it before any SQL runs.
const BOARD_VALUES = ["general", "suggestions"];
const SUGGESTIONS_BOARD = "suggestions";
const GENERAL_BOARD_DEFAULT = "general";

// Net reaction score for the Suggestions feed: likes minus dislikes, computed
// from the reactions rows themselves (reactions.value CHECK-constrains to
// 'like'/'dislike'; one row per post+user, so the score is the net of both
// directions — dislikes count against). A zero-score thread is a real page
// row: COALESCE keeps every thread visible even with no reactions at all.
const SUGGESTION_SCORE_SQL =
  "(SELECT COALESCE(SUM(CASE r.value WHEN 'like' THEN 1 ELSE -1 END), 0) " +
  "FROM reactions r WHERE r.post_id = p.id)";

// Single whitelist gate for the create routes' board field: absent/empty →
// 'general', whitelisted strings pass, everything else is a 400 before any
// body validation or database work.
function boardField(value) {
  if (value === undefined || value === null || value === "") return GENERAL_BOARD_DEFAULT;
  if (BOARD_VALUES.includes(value)) return value;
  throw new HttpError(400, "That board is not available.");
}

function replySnippet(body) {
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
function replyCountsSql(ids, showAll) {
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
function latestRepliesSql(ids, showAll) {
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

async function withReplyMetadata(db, viewer, posts) {
  if (!posts.length) return posts;
  const ids = [...new Set(posts.map((post) => Number(post.id)))];
  const showAll = Boolean(viewer && viewer.role === "admin");
  const viewerId = viewer ? Number(viewer.id) : null;
  const countsStatement = db.prepare(replyCountsSql(ids, showAll))
    .bind(...(showAll ? ids : [...ids, viewerId || -1, viewerId || -1]));
  const latestStatement = db.prepare(latestRepliesSql(ids, showAll))
    .bind(...(showAll ? ids : [viewerId || -1, ...ids, viewerId || -1]));
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
function banFilterSql(alias) {
  const prefix = alias ? alias + "." : "";
  return "NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = " + prefix + "author_id " +
    "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
    "CAST(strftime('%s','now') AS INTEGER)))";
}

async function listRootPosts(env, viewer, options = {}) {
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
    sql += "ORDER BY (p.pinned_at IS NULL) ASC, p.last_activity_at DESC, p.id DESC LIMIT 21";
    const result = await env.FORUM_DB.prepare(sql).bind(...values).all();
    const rows = result.results || [];
    const hasMore = rows.length > 20;
    const shown = rows.slice(0, 20);
    const last = shown.length ? shown[shown.length - 1] : null;
    return {
      // Root queries only (parent_id IS NULL): every shown row is a level-0 root.
      posts: await withBookmarkFlags(env.FORUM_DB, viewer, await withReplyMetadata(env.FORUM_DB, viewer,
        await withAttachments(env.FORUM_DB, viewer, shown.map((row) => publicPost(row, 0))))),
      nextBefore: hasMore && last
        ? (last.pinned_at === null || last.pinned_at === undefined ? "1_" : "0_") +
          Number(last.last_activity_at) + "_" + Number(last.id)
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
      posts: await withBookmarkFlags(env.FORUM_DB, viewer, await withReplyMetadata(env.FORUM_DB, viewer,
        await withAttachments(env.FORUM_DB, viewer, shown.map((row) => publicPost(row, 0))))),
      // The cursor's score half comes from the row's own like/dislike counts —
      // the identical tally the ORDER BY expression computes, so the emitted
      // cursor always sorts exactly where the row was shown.
      nextBefore: hasMore && last
        ? (Number(last.like_count) - Number(last.dislike_count)) + "_" + Number(last.id)
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
  const posts = await withBookmarkFlags(env.FORUM_DB, viewer, await withReplyMetadata(env.FORUM_DB, viewer,
    await withAttachments(env.FORUM_DB, viewer, shown)));
  return { posts, nextBefore: hasMore && shown.length ? shown[shown.length - 1].id : null };
}

async function listReplies(env, postId, viewer, showAll = false, before = null,
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
  if (!showAll) values.push(viewerId || -1);
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

async function handlePostFeedRoute(request, env, url, path, method) {
  if (path === "/api/posts" && method === "GET") {
    const session = await readSession(request, env);
    // Board param (v2.4.1): absent or 'general' keeps the general feed's SQL,
    // binds, and cursor format byte-identical; 'suggestions' selects the
    // suggestions board. Unknown values hit boardField's whitelist 400 before
    // any database work.
    const boardRaw = url.searchParams.get("board");
    const isSuggestions = boardRaw !== null && boardField(boardRaw) === SUGGESTIONS_BOARD;
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
        // Score cursors carry a signed integer half: a thread disliked below
        // zero sorts at a negative score, so its cursor can be "-3_12".
        const cursorMatch = /^(-?[0-9]{1,10})_([0-9]{1,10})$/.exec(beforeRaw);
        if (!cursorMatch) throw new HttpError(400, "That page cursor is invalid.");
        before = { score: Number(cursorMatch[1]), id: Number(cursorMatch[2]) };
      } else {
        const rankedCursor = /^([01])_([0-9]{1,10})_([0-9]{1,10})$/.exec(beforeRaw);
        const cursorMatch = /^([0-9]{1,10})_([0-9]{1,10})$/.exec(beforeRaw);
        if (rankedCursor) {
          before = { rank: Number(rankedCursor[1]), seconds: Number(rankedCursor[2]), id: Number(rankedCursor[3]) };
        } else if (cursorMatch) {
          before = { seconds: Number(cursorMatch[1]), id: Number(cursorMatch[2]) };
        } else {
          throw new HttpError(400, "That page cursor is invalid.");
        }
      }
    }
    // My posts (v2.5): `mine=1` filters the feed to the SESSION's own roots —
    // identity comes from the session only, never a spoofable param. Guests
    // asking for a private view are refused before any database work.
    const feed = await listRootPosts(
      env, session && session.user ? session.user : null,
      mineOnly
        ? { before, authorId: Number(session.user.id) }
        : (isSuggestions ? { before, board: SUGGESTIONS_BOARD } : { before, byActivity: true }),
    );
    return json(feed);
  }
  return null;
}

// Per-reply sub-reply counts go out as ONE D1 batch (one subrequest) — a
// per-reply query loop can exceed the Workers subrequest cap on busy roots.
// Viewer visibility mirrors listReplies: admins see every child, everyone else
// counts only public or their own. Results map back by statement order.
async function attachSubReplyCounts(env, replies, { showAll, viewerId }) {
  if (!replies.length) return replies;
  const countSql = "SELECT COUNT(*) AS sub_reply_count FROM posts WHERE parent_id = ?" +
    (showAll ? "" : " AND ((visibility = 'public' AND " + banFilterSql("") + ") OR author_id = ?)");
  const countResults = await env.FORUM_DB.batch(
    replies.map((reply) => env.FORUM_DB.prepare(countSql)
      .bind(...(showAll ? [reply.id] : [reply.id, viewerId || -1]))),
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

async function handleRepliesReadRoute(request, env, url, path, method) {
  const repliesReadMatch = path.match(/^\/api\/posts\/([0-9]+)\/replies$/);
  if (repliesReadMatch && method === "GET") {
    const postId = Number(repliesReadMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const parent = await postById(env, postId, viewer ? viewer.id : null);
    if (!(await canViewPost(env, parent, viewer))) {
      throw new HttpError(404, "Post not found.");
    }
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      if (!/^[1-9][0-9]{0,14}$/.test(beforeRaw)) throw new HttpError(400, "That reply cursor is invalid.");
      before = Number(beforeRaw);
    }
    // Each returned child is one level below the target: target is a root when
    // its parent_id is null (children are level-1), else a level-1 reply
    // (children are level-2).
    const targetDepth = parent.parent_id ? 1 : 0;
    const showAll = Boolean(viewer && viewer.role === "admin");
    const page = await listReplies(env, postId,
      viewer, showAll, before, targetDepth + 1);
    // Level-1 rows can be replied to, so they need expand-counts; level-2 rows
    // never do (replying to them is server-forbidden), so no batch runs.
    const replies = targetDepth === 0
      ? await attachSubReplyCounts(env, page.replies, {
        showAll,
        viewerId: viewer ? viewer.id : null,
      })
      : page.replies;
    return json({ replies, nextBefore: page.nextBefore });
  }
  return null;
}

async function handlePostDetailRoute(request, env, url, path, method) {
  const postMatch = path.match(/^\/api\/posts\/([0-9]+)$/);
  if (postMatch && method === "GET") {
    const postId = Number(postMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const viewerId = viewer ? viewer.id : null;
    const showAll = Boolean(viewer && viewer.role === "admin");
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

function getPostIdempotencyKey(request) {
  const key = request.headers.get("Idempotency-Key");
  if (key === null || key === "") return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new HttpError(400, "Invalid Idempotency-Key header.");
  }
  return key;
}

const STAGED_IDEMPOTENCY_TTL_SECONDS = 30 * 60;

async function existingIdempotentPost(db, authorId, key) {
  if (!key) return null;
  const live = await db.prepare(
    "SELECT id, visibility, created_at, staged_at, idempotency_key, idempotency_fingerprint, " +
    "parent_id, body, board FROM posts WHERE author_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(authorId, key).first();
  if (live) return { ...live, archived: false };
  const archived = await db.prepare(
    "SELECT original_post_id AS id, 'archived' AS visibility, deleted_at AS created_at, " +
    "idempotency_key, idempotency_fingerprint FROM post_archive " +
    "WHERE author_id = ? AND idempotency_key = ? ORDER BY id DESC LIMIT 1",
  ).bind(authorId, key).first();
  return archived ? { ...archived, archived: true } : null;
}

async function storedPostFingerprint(db, existing, fingerprint) {
  if (existing.idempotency_fingerprint || !fingerprint || existing.archived) {
    return existing.idempotency_fingerprint || null;
  }
  // Legacy rows predate persisted fingerprints. The current body is mutable:
  // the earliest post_edits snapshot is the original body (the edit route
  // snapshots the replaced version atomically with its first update).
  const originalEdit = await db.prepare(
    "SELECT body FROM post_edits WHERE post_id = ? ORDER BY id ASC LIMIT 1",
  ).bind(Number(existing.id)).first();
  const storedAttachments = await db.prepare(
    "SELECT hash, mime FROM attachments WHERE post_id = ? ORDER BY hash, mime",
  ).bind(Number(existing.id)).all();
  return postCreationFingerprint({
    kind: existing.parent_id === null || existing.parent_id === undefined ? "post" : "reply",
    targetId: existing.parent_id === null || existing.parent_id === undefined ? null : Number(existing.parent_id),
    message: String(originalEdit ? originalEdit.body : existing.body ?? ""),
    board: existing.board ?? null,
    attachments: storedAttachments.results || [],
  });
}

function assertIdempotencyFingerprint(existingFingerprint, fingerprint) {
  if (existingFingerprint && fingerprint && existingFingerprint !== fingerprint) {
    throw new HttpError(409, "Idempotency-Key was already used for a different submission. Submit again to create the changed content.");
  }
}

async function replayIdempotentPost(db, authorId, key, fingerprint) {
  if (!key) return null;
  let existing = await existingIdempotentPost(db, authorId, key);
  if (!existing) return null;
  let storedFingerprint = await storedPostFingerprint(db, existing, fingerprint);
  assertIdempotencyFingerprint(storedFingerprint, fingerprint);
  if (existing.archived) {
    throw new HttpError(410, "This creation request already completed, but that post has since been deleted.");
  }

  // Only explicit staged submissions are eligible for expiry. Moderator-hidden
  // posts have staged_at=NULL and must never be deleted by retry cleanup.
  if (existing.visibility === "hidden" && existing.staged_at !== null &&
      existing.staged_at !== undefined &&
      Number(existing.staged_at) <= nowSeconds() - STAGED_IDEMPOTENCY_TTL_SECONDS) {
    await db.prepare(
      "DELETE FROM posts WHERE id = ? AND author_id = ? AND idempotency_key = ? " +
      "AND visibility = 'hidden' AND staged_at IS NOT NULL AND staged_at <= ?",
    ).bind(Number(existing.id), authorId, key, nowSeconds() - STAGED_IDEMPOTENCY_TTL_SECONDS).run();
    existing = await existingIdempotentPost(db, authorId, key);
    if (!existing) return null;
    storedFingerprint = await storedPostFingerprint(db, existing, fingerprint);
    assertIdempotencyFingerprint(storedFingerprint, fingerprint);
    if (existing.archived) {
      throw new HttpError(410, "This creation request already completed, but that post has since been deleted.");
    }
  }

  if (existing.visibility !== "public") {
    throw new HttpError(409, "Your post is still being processed. Retry shortly.");
  }
  return json({ id: Number(existing.id) }, 200);
}
async function postCreationFingerprint({
  kind, targetId = null, message, board = null, files = [], gifEntries = [], attachments = null,
}) {
  // Direct uploads and library GIFs have the same visible effect. A sorted
  // multiset of (hash, MIME) pairs lets older rows be verified even though
  // source_kind did not exist when those rows were written.
  const media = (attachments || [
    ...files.map((file) => ({ hash: file.hash, mime: file.mime })),
    ...gifEntries.map((gif) => ({ hash: gif.hash, mime: gif.mime })),
  ]).map((item) => ({ hash: String(item.hash || ""), mime: String(item.mime || "") }))
    .sort((a, b) => (a.hash + ":" + a.mime).localeCompare(b.hash + ":" + b.mime));
  return sha256Hex(JSON.stringify({
    kind,
    targetId,
    message,
    board: kind === "post" ? board : null,
    attachments: media,
  }));
}

// Attachment rows reference a post id, so they are written after the post INSERT.
// Keep attachment-bearing posts hidden during that interval. If storage fails,
// the D1 attachment batch is atomic and deleting the hidden post removes any
// dependent rows; the client receives an error without a live duplicate on retry.
async function persistStagedPostAttachments(db, postId, authorId, files, gifEntries, options = {}) {
  const { bumpTargetId = null } = options;
  try {
    await insertAttachments(db, postId, authorId, files, gifEntries);
    const publish = db.prepare(
      "UPDATE posts SET visibility = 'public', staged_at = NULL WHERE id = ? AND author_id = ? AND visibility = 'hidden' " +
      "AND staged_at IS NOT NULL " +
      "AND (parent_id IS NULL OR EXISTS (" +
      "SELECT 1 FROM posts target WHERE target.id = posts.parent_id AND target.visibility = 'public' AND (" +
      "target.parent_id IS NULL OR EXISTS (SELECT 1 FROM posts root WHERE root.id = target.parent_id " +
      "AND root.parent_id IS NULL AND root.visibility = 'public')))) " +
      "AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.post_id = posts.id AND a.status = 'approved' " +
      "AND EXISTS (SELECT 1 FROM revoked_attachment_hashes r WHERE r.hash = a.hash))",
    ).bind(postId, authorId);
    if (bumpTargetId !== null) {
      // Publish and bump together so the root activity clock does not advance
      // for a reply whose attachments failed to commit.
      const results = await db.batch([
        publish,
        db.prepare(STAGED_REPLY_BUMP_SQL).bind(nowSeconds(), bumpTargetId, postId),
      ]);
      if (Number(results[0]?.meta?.changes) !== 1) {
        throw new HttpError(409, "The conversation changed while your reply was being published. Please try again.");
      }
    } else {
      const result = await publish.run();
      if (Number(result?.meta?.changes) !== 1) {
        throw new HttpError(409, "Your post could not be published. Please try again.");
      }
    }
  } catch (error) {
    try {
      const cleanup = await db.prepare(
        "DELETE FROM posts WHERE id = ? AND author_id = ? AND visibility = 'hidden' AND staged_at IS NOT NULL",
      ).bind(postId, authorId).run();
      if (Number(cleanup?.meta?.changes) !== 1) {
        console.error("Could not remove a staged post after attachment failure:", {
          postId, attachmentError: error, cleanupResult: cleanup,
        });
      }
    } catch (cleanupError) {
      console.error("Could not remove a staged post after attachment failure:", {
        postId, attachmentError: error, cleanupError,
      });
    }
    throw error;
  }
}

async function handleReplyCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const replyMatch = path.match(/^\/api\/posts\/([0-9]+)\/replies$/);
  if (replyMatch && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    const idempotencyKey = getPostIdempotencyKey(request);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const targetId = Number(replyMatch[1]);
    if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(404, "Post not found.");
    const isMultipart = (request.headers.get("Content-Type") || "").toLowerCase()
      .startsWith("multipart/form-data");
    // Charge multipart composer requests before parsing, hashing, sniffing, or duplicate lookup.
    if (isMultipart) await rateLimit(request, env, "image-upload", String(session.user.id));
    const { fields, files, gifIds, gifEntries } = await readComposedBody(request, env);
    if (!isMultipart && (files.length > 0 || gifIds.length > 0)) {
      await rateLimit(request, env, "image-upload", String(session.user.id));
    }
    if (files.length + gifIds.length > MAX_ATTACHMENT_FILES) {
      throw new HttpError(400, "Attach up to " + MAX_ATTACHMENT_FILES + " images and GIFs.");
    }
    const message = applyWordFilter(requiredText(fields.body, "reply", MAX_COMPOSER_BODY_CHARS), env.FILTERED_WORDS);
    const idempotencyFingerprint = idempotencyKey
      ? await postCreationFingerprint({ kind: "reply", targetId, message, files, gifEntries })
      : null;
    const replay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
    if (replay) return replay;
    const target = await postById(env, targetId, session.user.id);
    if (!target || target.visibility !== "public") {
      throw new HttpError(400, "Replies must be attached to a public conversation, not another reply.");
    }
    // The bump lands on the conversation root: the target itself, or the
    // target's parent (a public root) when replying to a level-1 reply.
    let bumpTargetId = Number(target.id);
    // Boards (v2.4.1): replies carry their thread ROOT's board, resolved from
    // the same rows the bump logic already fetched (the target when it is a
    // root, else its parent). The || normalization keeps rows from pre-board
    // projections at 'general'.
    let threadBoard = target.board || GENERAL_BOARD_DEFAULT;
    if (target.parent_id !== null && target.parent_id !== undefined) {
      const parent = await postById(env, Number(target.parent_id), session.user.id);
      if (!parent || parent.visibility !== "public") {
        throw new HttpError(400, "Replies must be attached to a public conversation, not another reply.");
      }
      if (parent.parent_id !== null && parent.parent_id !== undefined) {
        throw new HttpError(400, "Replies only go one level deep.");
      }
      bumpTargetId = Number(parent.id);
      threadBoard = parent.board || GENERAL_BOARD_DEFAULT;
    }
    // Banning auto-hides posts (v2.4.1): a reply into a banned author's thread
    // would create content nobody can see while the ban holds (hidden-post
    // parity — hidden roots already refuse replies via the visibility check
    // above). The viewer's exemptions mirror canViewPost: their own threads
    // and admins still pass. The depth refusal above stays authoritative; this
    // check runs after it so its own message is not shadowed.
    if (!(await canViewPost(env, target, session.user))) {
      throw new HttpError(400, "Replies are closed while this conversation's author is banned.");
    }
    await requireTurnstile(request, env, fields, "reply");
    const now = nowSeconds();
    const recipientId = target.author_id === null || target.author_id === undefined
      ? null
      : Number(target.author_id);
    const hasAttachments = files.length > 0 || gifEntries.length > 0;
    const insertSql = hasAttachments ? THREAD_REPLY_INSERT_STAGED_SQL : THREAD_REPLY_INSERT_SQL;
    const insertValues = hasAttachments
      ? [session.user.id, targetId, message, "hidden", now, now, threadBoard, idempotencyKey, idempotencyFingerprint, hasAttachments ? now : null, targetId, session.user.id, now, idempotencyKey, session.user.id, idempotencyKey]
      : [session.user.id, targetId, message, now, now, threadBoard, idempotencyKey, idempotencyFingerprint, null, targetId, session.user.id, now, idempotencyKey, session.user.id, idempotencyKey];
    const insertStatements = [db.prepare(insertSql).bind(...insertValues)];
    if (!hasAttachments) insertStatements.push(db.prepare(REPLY_BUMP_SQL).bind(now, bumpTargetId));
    let results;
    try {
      results = await db.batch(insertStatements);
    } catch (error) {
      const replay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
      if (replay) return replay;
      throw error;
    }
    if (Number(results[0]?.meta?.changes) !== 1) {
      // The atomic archive guard can reject a retry whose original post was
      // deleted after the earlier lookup. Re-read the archive to return 410.
      const archivedReplay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
      if (archivedReplay) return archivedReplay;
      throw new HttpError(409, "The conversation is no longer public or your account cannot post.");
    }
    const replyId = Number(results[0].meta.last_row_id);
    // Attachment-bearing replies stay hidden until the entire attachment batch
    // succeeds. The row id is always the new reply, not its bump target.
    if (hasAttachments) {
      await persistStagedPostAttachments(db, replyId, session.user.id, files, gifEntries, {
        bumpTargetId,
      });
    } else {
      await insertAttachments(db, replyId, session.user.id, files, gifEntries);
    }
    try {
      // Best-effort fan-out in a second batch: the reply id only exists after
      // the insert above, and a failed notification must never fail the reply.
      // Thread subscriptions (C1) ride the same batch: every subscriber of the
      // ROOT is notified except the reply author and the reply's ordinary
      // target (both excluded in subscriptionReplyFanOut; the INSERT's own
      // NOT EXISTS guard dedupes both halves regardless).
      const statements = notificationBatchStatements(
        db, recipientId, session.user.id, targetId, replyId, now,
      );
      // Mentions (C2): @username tokens in the FILTERED body notify their
      // members unless that member is the ordinary target already notified
      // above (deduped; the INSERT's NOT EXISTS guard is the second net).
      statements.push(...await mentionFanOutStatements(db, message, {
        actorId: session.user.id,
        actorUsername: session.user.username,
        targetPostId: targetId,
        replyId,
        now,
        excludeIds: [recipientId],
      }));
      statements.push(...await subscriptionReplyFanOut(db, {
        rootPostId: bumpTargetId,
        replyAuthorId: session.user.id,
        replyTargetId: recipientId,
        targetPostId: targetId,
        replyId,
        now,
      }));
      // Chunked best-effort (fix round 1): ≤50-statement batches, one chunk
      // failing never killing the later chunks' notifications.
      await runFanOutChunks(db, statements);
    } catch {
      // Ignore: notifications are a convenience, not a reply precondition.
    }
    return json({ id: replyId }, 201);
  }
  return null;
}

async function handlePostCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/posts" && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    const idempotencyKey = getPostIdempotencyKey(request);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const isMultipart = (request.headers.get("Content-Type") || "").toLowerCase()
      .startsWith("multipart/form-data");
    // Charge multipart composer requests before parsing, hashing, sniffing, or duplicate lookup.
    if (isMultipart) await rateLimit(request, env, "image-upload", String(session.user.id));
    const { fields, files, gifIds, gifEntries } = await readComposedBody(request, env);
    if (!isMultipart && (files.length > 0 || gifIds.length > 0)) {
      await rateLimit(request, env, "image-upload", String(session.user.id));
    }
    if (files.length + gifIds.length > MAX_ATTACHMENT_FILES) {
      throw new HttpError(400, "Attach up to " + MAX_ATTACHMENT_FILES + " images and GIFs.");
    }
    const message = applyWordFilter(requiredText(fields.body, "post", MAX_COMPOSER_BODY_CHARS), env.FILTERED_WORDS);
    // The board rides the same fields object in both wire formats (JSON field
    // or multipart text part); absent/empty defaults to 'general', unknown
    // values 400 before any insert.
    const board = boardField(fields.board);
    const idempotencyFingerprint = idempotencyKey
      ? await postCreationFingerprint({ kind: "post", message, board, files, gifEntries })
      : null;
    const replay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
    if (replay) return replay;
    await requireTurnstile(request, env, fields, "post");
    const now = nowSeconds();
    // A fresh root starts its activity clock at creation time. When it carries
    // attachments it stays hidden until their batch is durable, so a failed
    // upload cannot leave a live post that the user unknowingly duplicates.
    const hasAttachments = files.length > 0 || gifEntries.length > 0;
    // Both values are fixed server-owned SQL literals; keeping visibility out of
    // the bind list preserves the established root-post bind order.
    const visibilitySql = hasAttachments ? "'hidden'" : "'public'";
    let result;
    try {
      result = await db.prepare(
        "INSERT INTO posts (author_id, parent_id, body, visibility, created_at, last_activity_at, board, idempotency_key, idempotency_fingerprint, staged_at) " +
          "SELECT ?, NULL, ?, " + visibilitySql + ", ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
          "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
          "AND (expires_at IS NULL OR expires_at > ?)) " +
          "AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM post_archive archived " +
          "WHERE archived.author_id = ? AND archived.idempotency_key = ?))",
      ).bind(session.user.id, message, now, now, board, idempotencyKey, idempotencyFingerprint, hasAttachments ? now : null, session.user.id, now, idempotencyKey, session.user.id, idempotencyKey).run();
    } catch (error) {
      const replay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
      if (replay) return replay;
      throw error;
    }
    if (Number(result?.meta?.changes) !== 1) {
      // A concurrent delete may archive the same author/key after the replay
      // lookup. The INSERT guard prevents resurrection; surface the archived
      // request as gone rather than a generic mutation failure.
      const archivedReplay = await replayIdempotentPost(db, session.user.id, idempotencyKey, idempotencyFingerprint);
      if (archivedReplay) return archivedReplay;
      requireMutationApplied(result);
    }
    const postId = Number(result.meta.last_row_id);
    if (hasAttachments) {
      await persistStagedPostAttachments(db, postId, session.user.id, files, gifEntries);
    } else {
      await insertAttachments(db, postId, session.user.id, files, gifEntries);
    }
    try {
      // Mentions (C2): @username tokens in the FILTERED body notify their
      // members, best-effort — a failed mention never fails the post. There
      // is no reply id yet, and the fresh root's own id is the target.
      const mentionStatements = await mentionFanOutStatements(db, message, {
        actorId: session.user.id,
        actorUsername: session.user.username,
        targetPostId: postId,
        replyId: postId,
        now,
        excludeIds: [],
      });
      if (mentionStatements.length > 0) await db.batch(mentionStatements);
    } catch {
      // Ignore: mentions are a convenience, not a post precondition.
    }
    return json({ id: postId }, 201);
  }
  return null;
}

// Author post edits (v2.4): PATCH /api/posts/:id covers BOTH roots and replies
// (both are rows in posts). Access is author-only by session identity — no role
// path (a moderator gets no edit power here), and the author may edit even a
// hidden own post. Content gates mirror create exactly: requiredText semantics
// with MAX_COMPOSER_BODY_CHARS and the word filter REAPPLIED, storing the
// masked body. last_activity_at is deliberately absent from the UPDATE — an
// edit must never bump the feed; edited_at (migration 0005) marks the edit
// instead. Turnstile is deliberately NOT required (owner-approved default):
// the editor is already session-verified (same-origin + CSRF + session via
// requireUser) and the content path reuses create's filter/limit gates, so a
// token would add friction without any new trust decision. Edits are text-only
// in v1: attachments stay exactly as originally posted.
async function handlePostEditRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const editMatch = path.match(/^\/api\/posts\/([0-9]+)$/);
  if (editMatch && method === "PATCH") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const postId = Number(editMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!post) throw new HttpError(404, "Post not found.");
    if (Number(post.author_id) !== session.user.id) {
      throw new HttpError(403, "Only the author can edit this post.");
    }
    const body = await readJson(request);
    const message = applyWordFilter(
      requiredText(body.body, "post", MAX_COMPOSER_BODY_CHARS),
      env.FILTERED_WORDS,
    );
    const editedAt = nowSeconds();
    // Edit history (v2.4.1): the version being REPLACED is snapshotted into
    // post_edits inside the same atomic batch as the UPDATE, stamped with the
    // time it became current (COALESCE(edited_at, created_at) — a first edit
    // therefore snapshots the original at its creation). Past versions only:
    // the current body always lives on the posts row itself.
    const replacedBody = String(post.body ?? "");
    const becameCurrentAt = Number(post.edited_at || post.created_at);
    // The author_id clause re-checks ownership at write time (TOCTOU guard) and
    // doubles as the no-race 404: a row deleted between the read and the write
    // changes nothing (the batch rolls back, history included).
    const results = await db.batch([
      db.prepare(
        "INSERT INTO post_edits (post_id, editor_id, body, edited_at) VALUES (?, ?, ?, ?)",
      ).bind(postId, session.user.id, replacedBody, becameCurrentAt),
      db.prepare(
        "UPDATE posts SET body = ?, edited_at = ? WHERE id = ? AND author_id = ?",
      ).bind(message, editedAt, postId, session.user.id),
    ]);
    if (Number(results[1]?.meta?.changes) !== 1) throw new HttpError(404, "Post not found.");
    return json({ id: postId, editedAt: new Date(editedAt * 1000).toISOString() });
  }
  return null;
}

// Public edit history: anyone who can view the post can view every past
// version — the anti-abuse property trouserpants called for (edits can't
// quietly rewrite context). Guests included; visibility of a hidden post
// still applies via canViewPost. Past versions only, newest first.
async function handlePostEditHistoryRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const historyMatch = path.match(/^\/api\/posts\/([0-9]+)\/edits$/);
  if (historyMatch && method === "GET") {
    const postId = Number(historyMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const session = await readSession(request, env);
    const viewer = session && session.user ? session.user : null;
    const row = await postById(env, postId, viewer && viewer.id ? viewer.id : null);
    if (!row || !(await canViewPost(env, row, viewer))) throw new HttpError(404, "Post not found.");
    const result = await db.prepare(
      "SELECT body, edited_at FROM post_edits WHERE post_id = ? ORDER BY edited_at DESC, id DESC",
    ).bind(postId).all();
    return json({
      edits: (result.results || []).map((edit) => ({
        body: edit.body,
        editedAt: new Date(Number(edit.edited_at) * 1000).toISOString(),
      })),
    });
  }
  return null;
}

// Author post deletion (v2.4.1 feature, shipped without a version bump): DELETE /api/posts/:id. Access is author-only
// by session identity — no role path (a moderator gets no delete power here),
// exactly the same gates as the edit route (requireUser + assertNotBanned +
// the write and post-write rate limit scopes). The TOCTOU guard mirrors the
// edit route: the author_id clause runs at write time, so a non-author racing
// the ownership read cannot delete, and an already-gone post reports 404.
//
// FK analysis (migrations 0001/0002/0003/0004, D1 keeps enforcement ON, all
// actions fire immediately, no post-deletion statements may be orphaned):
//   posts.parent_id    → posts(id) ON DELETE CASCADE — replies cascade
//   reactions.post_id  → posts(id) ON DELETE CASCADE
//   reports.post_id    → posts(id) ON DELETE CASCADE
//   notifications.target_post_id / reply_id → posts(id) ON DELETE CASCADE
//   attachments.post_id → posts(id) ON DELETE CASCADE; attachment_chunks →
//     attachments(id) ON DELETE CASCADE (chunk bytes die with the attachment)
// So deleting a ROOT post takes the whole thread (including other users'
// replies and every child row above) with ONE guarded DELETE — no explicit
// child cleanup is needed or performed. Deleting a REPLY must preserve the
// conversation: its sub-replies are REPARENTED to the thread root first (one
// UPDATE, in the same atomic batch as the delete), so nobody else's content
// is lost; the reply's own reactions/reports/notifications/attachments
// cascade away with the reply row. The reparent is also why the batch order
// is fixed: parent_id must leave the deleted id before the CASCADE runs, or
// SQLite would cascade the sub-replies away instead.
export const POST_DELETE_SQL =
  "DELETE FROM posts WHERE id = ? AND author_id = ?";
export const REPLY_REPARENT_SQL = "UPDATE posts SET parent_id = ? WHERE parent_id = ?";

// Statement builder shared with the real-SQLite FK tests (tests/deletions.test.mjs
// runs these exact SQL strings against migrations 0001–0006 to pin the cascade
// and reparent semantics). parentId null means the target is a thread root.
export function postDeletionStatements(db, authorId, postId, parentId, { archiveReason, deletedAt, deletedByUserId = authorId, deletedByName = null } = {}) {
  // Accountability archive (v2.4.1): the doomed rows are copied into
  // post_archive FIRST, in the same atomic batch. A root delete archives the
  // whole thread — including other members' replies, which cascade away with
  // it. A reply delete archives just that row (its sub-replies are reparented,
  // so their content stays live). Omit {archiveReason, deletedAt} to delete
  // without archiving (legacy callers / tests).
  const archiveStatements = [];
  if (archiveReason) {
    const isRoot = parentId === null || parentId === undefined;
    archiveStatements.push(archivePostRowsStatement(
      db,
      isRoot
        ? "p.id = ? OR p.parent_id = ? OR p.parent_id IN (SELECT id FROM posts WHERE parent_id = ?)"
        : "p.id = ?",
      isRoot ? [postId, postId, postId] : [postId],
      archiveReason,
      deletedAt,
      deletedByUserId,
      deletedByName,
    ));
  }
  const deletePost = db.prepare(POST_DELETE_SQL).bind(postId, authorId);
  if (parentId === null || parentId === undefined) {
    return [...archiveStatements, deletePost];
  }
  return [...archiveStatements, db.prepare(REPLY_REPARENT_SQL).bind(parentId, postId), deletePost];
}

async function handlePostDeleteRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const deleteMatch = path.match(/^\/api\/posts\/([0-9]+)$/);
  if (deleteMatch && method === "DELETE") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "post-write", String(session.user.id));
    const postId = Number(deleteMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!post) throw new HttpError(404, "Post not found.");
    if (Number(post.author_id) !== session.user.id) {
      throw new HttpError(403, "Only the author can delete this post.");
    }
    const parentId = post.parent_id === null || post.parent_id === undefined
      ? null
      : Number(post.parent_id);
    const results = await db.batch(postDeletionStatements(
      db, session.user.id, postId, parentId,
      { archiveReason: "post-delete", deletedAt: nowSeconds(), deletedByUserId: session.user.id, deletedByName: session.user.username },
    ));
    // The author-guarded DELETE must be the statement that changed exactly one
    // row; a 0-change delete means the post vanished between the read and the
    // write (or ownership shifted) — report 404, never a false success. A
    // 0-change reparent only means the reply had no sub-replies.
    if (Number(results[results.length - 1]?.meta?.changes) !== 1) {
      throw new HttpError(404, "Post not found.");
    }
    return json({ deleted: true });
  }
  return null;
}

async function handleReactionRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const reactionMatch = path.match(/^\/api\/posts\/([0-9]+)\/reaction$/);
  if (reactionMatch && method === "PUT") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "reaction", String(session.user.id));
    const postId = Number(reactionMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
    const body = await readJson(request);
    if (body.value !== "like" && body.value !== "dislike") {
      throw new HttpError(400, "Choose like or dislike.");
    }
    const result = await db.prepare(
      "INSERT INTO reactions (post_id, user_id, value, created_at) " +
        "SELECT ?, ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?)) " +
        "ON CONFLICT(post_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at",
    ).bind(postId, session.user.id, body.value, nowSeconds(), session.user.id, nowSeconds()).run();
    requireMutationApplied(result);
    return json({ ok: true });
  }
  return null;
}

// Reaction removal mirror of the PUT toggle. Registered after handleReactionRoute
// so PUT keeps its behavior; anything else hitting this path is a 405 method gate.
// Idempotent by design: 0 changed rows is still { ok: true } — a missing reaction
// is exactly the state the caller wanted. The request body is never read.
async function handleReactionDeleteRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const reactionMatch = path.match(/^\/api\/posts\/([0-9]+)\/reaction$/);
  if (reactionMatch) {
    if (method !== "DELETE") throw new HttpError(405, "That method is not supported.");
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "reaction", String(session.user.id));
    const postId = Number(reactionMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
    await db.prepare("DELETE FROM reactions WHERE post_id = ? AND user_id = ?")
      .bind(postId, session.user.id).run();
    return json({ ok: true });
  }
  return null;
}

async function handleSearchRoute(request, env, url, path, method) {
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
    const users = await db.prepare(SEARCH_USERS_SQL).bind(query, query).all();
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
async function searchReplies(env, viewer, query, authorId) {
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
  values.push(viewerId || -1);
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
async function threadRootId(env, row) {
  const firstParent = await env.FORUM_DB.prepare(
    "SELECT id, parent_id FROM posts WHERE id = ? LIMIT 1",
  ).bind(Number(row.parent_id)).first();
  if (!firstParent || firstParent.parent_id === null || firstParent.parent_id === undefined) {
    return Number(row.parent_id);
  }
  return Number(firstParent.parent_id);
}

async function handlePostRoutes(request, env, url, path, method) {
  const handlers = [handlePostFeedRoute, handleRepliesReadRoute, handlePostDetailRoute, handleReplyCreateRoute, handlePostCreateRoute, handlePostEditRoute, handlePostEditHistoryRoute, handlePostDeleteRoute, handleReactionRoute, handleReactionDeleteRoute, handleSearchRoute];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }
  return null;
}

export { banFilterSql, handlePostRoutes, listRootPosts, listReplies };
