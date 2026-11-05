// All-time leaderboard (v2.5 weekly → permanent, owner's call): the top ten
// contributors ever — threads started (×2), replies written, and reactions
// RECEIVED on their content; the score is transparent addition. Currently
// banned members are excluded (their content is hidden; the leaderboard
// mirrors). Zero-activity members never appear.
import { readSession } from "./core/auth.mjs";
import { json } from "./core/http.mjs";

const LEADERBOARD_SIZE = 10;

export async function handleLeaderboardRoutes(request, env, url, path, method) {
  if (path !== "/api/leaderboard" || method !== "GET") return null;
  const session = await readSession(request, env);
  const result = await env.FORUM_DB.prepare(
    "SELECT u.id, u.username, " +
    "(SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NULL) AS threads, " +
    "(SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NOT NULL) AS replies, " +
    "(SELECT COUNT(*) FROM reactions rr JOIN posts p ON p.id = rr.post_id " +
    "WHERE p.author_id = u.id) AS reactions_received " +
    "FROM users u WHERE u.role IN ('member', 'moderator', 'admin') " +
    "AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id AND b.revoked_at IS NULL " +
    "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) " +
    "AND ((SELECT COUNT(*) FROM posts WHERE author_id = u.id) > 0 OR " +
    "(SELECT COUNT(*) FROM reactions rr JOIN posts p ON p.id = rr.post_id " +
    "WHERE p.author_id = u.id) > 0) " +
    "ORDER BY (2 * (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NULL) " +
    "+ (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND parent_id IS NOT NULL) " +
    "+ (SELECT COUNT(*) FROM reactions rr JOIN posts p ON p.id = rr.post_id WHERE p.author_id = u.id)) DESC, " +
    "u.username_key ASC LIMIT " + LEADERBOARD_SIZE,
  ).all();
  return json({
    allTime: {
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
