// Weekly leaderboard (v2.5): the top ten contributors over the trailing
// seven days — threads started (×2), replies written, and reactions RECEIVED
// on their content; the score is transparent addition. Currently-banned
// members are excluded (their content is hidden; the leaderboard mirrors).
import { json, nowSeconds, readSession } from "./shared.mjs";

const LEADERBOARD_SIZE = 10;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export async function handleLeaderboardRoutes(request, env, url, path, method) {
  if (path !== "/api/leaderboard" || method !== "GET") return null;
  const session = await readSession(request, env);
  const weekStart = nowSeconds() - WEEK_SECONDS;
  const result = await env.FORUM_DB.prepare(
    "SELECT u.id, u.username, " +
    "(SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NULL AND created_at >= ?) AS threads, " +
    "(SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NOT NULL AND created_at >= ?) AS replies, " +
    "(SELECT COUNT(*) FROM reactions rr JOIN posts p ON p.id = rr.post_id " +
    "WHERE p.author_id = u.id AND rr.created_at >= ?) AS reactions_received " +
    "FROM users u WHERE u.role IN ('member', 'moderator', 'admin') " +
    "AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) " +
    "AND ((SELECT COUNT(*) FROM posts WHERE author_id = u.id AND created_at >= ?) > 0 OR " +
    "(SELECT COUNT(*) FROM reactions rr JOIN posts p ON p.id = rr.post_id " +
    "WHERE p.author_id = u.id AND rr.created_at >= ?) > 0) " +
    "ORDER BY (2 * (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NULL AND created_at >= ?) " +
    "+ (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NOT NULL AND created_at >= ?) " +
    "+ (SELECT COUNT(*) FROM reactions rr JOIN posts p ON p.id = rr.post_id WHERE p.author_id = u.id AND rr.created_at >= ?)) DESC, " +
    "u.username_key ASC LIMIT " + LEADERBOARD_SIZE,
  ).bind(weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart).all();
  return json({
    week: {
      leaderboard: (result.results || []).map((row) => ({
        userId: Number(row.id),
        username: row.username,
        threads: Number(row.threads),
        replies: Number(row.replies),
        reactionsReceived: Number(row.reactions_received),
        score: 2 * Number(row.threads) + Number(row.replies) + Number(row.reactions_received),
      })),
    },
  });
}
