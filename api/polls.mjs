// Polls (C3): creation on a thread root (the ROOT's author only), the one
// changeable vote per member per poll, and the detail payload's poll shape —
// question, options with counts (ALWAYS visible), total, and the viewer's own
// option. Polls are display-only: nothing here ever touches feed sorting.
import {
  assertNotBanned,
  canViewPost,
  HttpError,
  json,
  nowSeconds,
  postById,
  rateLimit,
  readJson,
  requireUser,
  requiredText,
} from "./shared.mjs";
import { applyWordFilter } from "./filter.mjs";

const MAX_POLL_QUESTION_CHARS = 200;
const MAX_POLL_OPTION_CHARS = 80;
const MAX_POLL_OPTIONS = 4;
const MIN_POLL_OPTIONS = 2;

// The detail payload's reads. One query per need, all keyed by the ROOT id:
// the poll row (existence + close state), one options-with-counts page, and
// the viewer's own vote (only when a member is asking).
const POLL_BY_POST_SQL = "SELECT id, question, closed_at FROM polls WHERE post_id = ? LIMIT 1";
const POLL_OPTION_COUNTS_SQL =
  "SELECT o.id, o.label, o.position, " +
    "(SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS vote_count " +
  "FROM polls p JOIN poll_options o ON o.poll_id = p.id " +
  "WHERE p.post_id = ? ORDER BY o.position ASC";
const VIEWER_OPTION_SQL =
  "SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?";

// Tests pin the poll-read SELECT text (the question column is load-bearing:
// the payload renders it verbatim — see tests/polls.test.mjs's honest-mapping
// fixture, which mocks ONLY the projected columns).
export {
  POLL_BY_POST_SQL,
  POLL_OPTION_COUNTS_SQL,
  VIEWER_OPTION_SQL,
};

// The payload shape (null when the thread has no poll): results are always
// visible, guests included; viewerOption is null for guests and non-voters.
// A REPLY never carries a poll — polls ride the root only.
export async function pollPayload(db, postId, viewerId) {
  const poll = await db.prepare(POLL_BY_POST_SQL).bind(postId).first();
  if (!poll) return null;
  const options = await db.prepare(POLL_OPTION_COUNTS_SQL).bind(postId).all();
  const rows = (options.results || []).map((row) => ({
    id: Number(row.id),
    label: row.label,
    count: Number(row.vote_count || 0),
  }));
  let viewerOption = null;
  if (viewerId !== null && viewerId !== undefined) {
    const own = await db.prepare(VIEWER_OPTION_SQL).bind(Number(poll.id), viewerId).first();
    if (own) viewerOption = Number(own.option_id);
  }
  return {
    question: poll.question,
    options: rows,
    totalVotes: rows.reduce((sum, option) => sum + option.count, 0),
    viewerOption,
  };
}

async function handlePollCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(/^\/api\/posts\/([0-9]+)\/poll$/);
  if (match && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write", String(session.user.id));
    await rateLimit(request, env, "post-write", String(session.user.id));
    const postId = Number(match[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
    // Root-only: a poll lives on the thread root, like boards and pins.
    if (post.parent_id !== null && post.parent_id !== undefined) {
      throw new HttpError(400, "Only thread roots can carry a poll.");
    }
    if (Number(post.author_id) !== session.user.id) {
      throw new HttpError(403, "Only the author can add a poll to this thread.");
    }
    const existing = await db.prepare(POLL_BY_POST_SQL).bind(postId).first();
    if (existing) throw new HttpError(409, "This thread already has a poll.");
    const body = await readJson(request);
    if (!Array.isArray(body.options)) {
      throw new HttpError(400, "Enter the poll options as a list.");
    }
    if (body.options.length < MIN_POLL_OPTIONS || body.options.length > MAX_POLL_OPTIONS) {
      throw new HttpError(400, "Add 2 to " + MAX_POLL_OPTIONS + " poll options.");
    }
    const question = applyWordFilter(
      requiredText(body.question, "question", MAX_POLL_QUESTION_CHARS),
      env.FILTERED_WORDS,
    );
    const labels = [];
    const seen = new Set();
    for (const raw of body.options) {
      const label = applyWordFilter(
        requiredText(raw, "poll option", MAX_POLL_OPTION_CHARS),
        env.FILTERED_WORDS,
      );
      const key = label.toLowerCase();
      if (seen.has(key)) {
        throw new HttpError(400, "That would duplicate a poll option.");
      }
      seen.add(key);
      labels.push(label);
    }
    // One atomic batch: the poll row, then each option resolving its poll id
    // by subquery (D1 batches run sequentially, but option ids need the poll
    // id NOW — the subselect keeps the whole creation in one round trip).
    await db.batch([
      db.prepare(
        "INSERT INTO polls (post_id, question, created_at) VALUES (?, ?, ?)",
      ).bind(postId, question, nowSeconds()),
      ...labels.map((label, index) => db.prepare(
        "INSERT INTO poll_options (poll_id, label, position) " +
          "SELECT (SELECT id FROM polls WHERE post_id = ?), ?, ?",
      ).bind(postId, label, index + 1)),
    ]);
    return json({ ok: true }, 201);
  }
  return null;
}

async function handlePollVoteRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(/^\/api\/posts\/([0-9]+)\/poll$/);
  if (match && method === "PUT") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write", String(session.user.id));
    const postId = Number(match[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
    const poll = await db.prepare(POLL_BY_POST_SQL).bind(postId).first();
    if (!poll) throw new HttpError(404, "That thread has no poll.");
    if (poll.closed_at !== null && poll.closed_at !== undefined) {
      throw new HttpError(409, "This poll is closed.");
    }
    const body = await readJson(request);
    const optionId = Number(body.optionId);
    if (!Number.isSafeInteger(optionId) || optionId < 1) {
      throw new HttpError(400, "Choose one of the poll options.");
    }
    // The chosen option must belong to THIS poll — a poll_options id from any
    // other poll is refused (400) instead of silently cross-counting votes.
    const option = await db.prepare(
      "SELECT id FROM poll_options WHERE id = ? AND poll_id = ? LIMIT 1",
    ).bind(optionId, Number(poll.id)).first();
    if (!option) throw new HttpError(400, "Choose one of the poll options.");
    // CHANGEABLE vote: the upsert moves the member's vote until the poll closes.
    await db.prepare(
      "INSERT INTO poll_votes (poll_id, user_id, option_id, voted_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id, voted_at = excluded.voted_at",
    ).bind(Number(poll.id), session.user.id, optionId, nowSeconds()).run();
    return json({ ok: true });
  }
  return null;
}

export async function handlePollRoutes(request, env, url, path, method) {
  const created = await handlePollCreateRoute(request, env, url, path, method);
  if (created) return created;
  const voted = await handlePollVoteRoute(request, env, url, path, method);
  if (voted) return voted;
  return null;
}