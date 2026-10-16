// Thread subscriptions (C1): member follow/unfollow of a ROOT thread, plus the
// reply fan-out that notifies every subscriber when a reply lands on the root.
// Routes mirror the reaction routes' gates (requireUser + assertNotBanned +
// rate limit, then post visibility); the fan-out mirrors the ordinary reply
// notification batch (api/notifications.mjs): one dedupe-guarded INSERT and
// one cap-pruning DELETE per recipient, batched, best-effort at the call site.
import {
  assertNotBanned,
  canViewPost,
  HttpError,
  json,
  nowSeconds,
  postById,
  rateLimit,
  requireUser,
} from "./shared.mjs";
import { fanOutStatements } from "./notifications.mjs";

// Subscribers of one thread root. Resolved with ONE query per reply — never a
// per-subscriber loop (Workers subrequest caps) — capped at the newest... oldest
// 100 subscriptions (first-come, so early subscribers keep their notifications
// when a thread's follower count explodes). The cap is enforced BOTH in the
// SELECT (LIMIT 100) and again in JS (subscriptionFanOutStatements), so the
// contract holds even when a caller hands over a wider list.
export const SUBSCRIBERS_SELECT_SQL =
  "SELECT user_id FROM thread_subscriptions WHERE post_id = ? ORDER BY created_at ASC LIMIT 100";

// Fan-out cap per reply (mirror of the SELECT's LIMIT, in JS so a widened or
// mock-supplied list cannot exceed it) and the per-batch statement chunk —
// 50 statements = 25 recipients per D1 batch. The reply-create route runs the
// combined fan-out through runFanOutChunks: one CHUNK failing is caught and
// the later chunks still run, instead of one all-or-nothing batch silently
// killing every notification for the reply.
export const MAX_SUBSCRIPTION_FANOUT = 100;
export const FANOUT_CHUNK_STATEMENTS = 50;

// The detail payload flag read: one (user, thread) row existing means the
// viewer subscribed. Callers skip it for guests and replies (root-only).
export const SUBSCRIPTION_EXISTS_SQL =
  "SELECT 1 AS subscribed FROM thread_subscriptions WHERE user_id = ? AND post_id = ?";

// Excludes the two members who already have their notifications: the reply
// author (never notified about themselves) and the reply's ordinary target
// (already notified through notificationBatchStatements — the same dedupe the
// mention scan uses). Deduped again per-recipient by the INSERT's own
// NOT EXISTS guard, so a batch retry can never double-notify.
export function subscriptionFanOutStatements(db, subscriberIds, {
  replyAuthorId, replyTargetId, targetPostId, replyId, now,
}) {
  const excluded = new Set(
    [replyAuthorId, replyTargetId]
      .filter((id) => id !== null && id !== undefined)
      .map(Number),
  );
  // Cap AFTER the exclusions: the SELECT already hands back at most
  // MAX_SUBSCRIPTION_FANOUT rows oldest-first, and members removed here
  // (already notified) never displace the nextsubscriber in line.
  const recipients = [...new Set(subscriberIds.map(Number))]
    .filter((id) => !excluded.has(id))
    .slice(0, MAX_SUBSCRIPTION_FANOUT);
  return fanOutStatements(db, recipients, { targetPostId, replyId, now });
}

// Slices a fan-out statements list into ≤FANOUT_CHUNK_STATEMENTS batches and
// runs each best-effort: a failure inside one chunk (any statement in it)
// still lets every later chunk deliver. Returns the number of chunks that
// succeeded — display-only bookkeeping, never thrown to the caller.
export async function runFanOutChunks(db, statements) {
  let delivered = 0;
  for (let index = 0; index < statements.length; index += FANOUT_CHUNK_STATEMENTS) {
    try {
      await db.batch(statements.slice(index, index + FANOUT_CHUNK_STATEMENTS));
      delivered += 1;
    } catch {
      // Notifications are a convenience, not a reply precondition (per chunk).
    }
  }
  return delivered;
}

// Best-effort composition used by the reply-create route: resolves the root's
// subscribers and returns the READY statements ([] when nobody to notify).
export async function subscriptionReplyFanOut(db, context) {
  const result = await db.prepare(SUBSCRIBERS_SELECT_SQL)
    .bind(context.rootPostId).all();
  const subscriberIds = (result.results || []).map((row) => Number(row.user_id));
  if (!subscriberIds.length) return [];
  return subscriptionFanOutStatements(db, subscriberIds, context);
}

// The detail payload's subscribed flag: true only for a member subscribed to
// this thread root. Replies report false without a query (subscriptions are a
// root-only dimension, like boards).
export async function subscriberFlagForViewer(db, viewerId, row) {
  if (!viewerId || (row && row.parent_id !== null && row.parent_id !== undefined)) {
    return false;
  }
  const existing = await db.prepare(SUBSCRIPTION_EXISTS_SQL)
    .bind(viewerId, Number(row.id)).first();
  return Boolean(existing);
}

async function subscriptionGate(request, env, subscriptionMatch, method) {
  const db = env.FORUM_DB;
  if (!subscriptionMatch) return null;
  if (method !== "POST" && method !== "DELETE") {
    throw new HttpError(405, "That method is not supported.");
  }
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write", String(session.user.id));
  const postId = Number(subscriptionMatch[1]);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
  const post = await postById(env, postId, session.user.id);
  if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
  // Root-only dimension (mirrors the board's root-only rule): a reply has no
  // subscription of its own — its thread root does.
  if (post.parent_id !== null && post.parent_id !== undefined) {
    throw new HttpError(400, "Only thread roots can be subscribed to.");
  }
  return { db, session, postId };
}

async function handleSubscriptionRoutes(request, env, url, path, method) {
  const match = path.match(/^\/api\/posts\/([0-9]+)\/subscribe$/);
  if (!match) return null;
  const gate = await subscriptionGate(request, env, match, method);
  if (!gate) return null;
  const { db, session, postId } = gate;
  const now = nowSeconds();
  if (method === "POST") {
    // Idempotent by construction: an existing (user, thread) pair changes 0
    // rows and still answers { ok: true } — the caller wanted exactly this state.
    await db.prepare(
      "INSERT INTO thread_subscriptions (user_id, post_id, created_at) " +
        "SELECT ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM thread_subscriptions WHERE user_id = ? AND post_id = ? LIMIT 1)",
    ).bind(session.user.id, postId, now, session.user.id, postId).run();
    return json({ ok: true, subscribed: true });
  }
  await db.prepare(
    "DELETE FROM thread_subscriptions WHERE user_id = ? AND post_id = ?",
  ).bind(session.user.id, postId).run();
  return json({ ok: true, subscribed: false });
}

export async function handleSubscriptionsRoutes(request, env, url, path, method) {
  return await handleSubscriptionRoutes(request, env, url, path, method);
}