// Profile wall (v4.0, owner's ask): one flat wall per member profile. Anyone
// signed in can post; the profile OWNER may pin/unpin wall posts and can do
// NOTHING else to them (no edit, no delete, no replies — the owner's explicit
// scope). Guests read. The rules mirror the chat stream: 280-char bodies run
// through the word filter at intake, text auto-mod scores them in the
// background (a trip deletes the row; the action is appealable), and rows by
// actively banned authors vanish at read time — read-time only, so an unban
// restores the wall without any write.
import { assertNotBanned, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { publicRole } from "./core/roles.mjs";
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";

const WALL_MAX_CHARS = 280;
const WALL_PAGE_LIMIT = 50;

// Read-time active-ban filter for wall rows: the same predicate as chat's,
// keyed on the AUTHOR (not the wall owner — a banned wall owner's wall stays
// readable; their outgoing wall posts vanish).
const WALL_BAN_FILTER_SQL =
  "NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = w.author_id " +
  "AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > " +
  "CAST(strftime('%s','now') AS INTEGER)))";

const WALL_SELECT =
  "SELECT w.id, w.body, w.pinned_at, w.created_at, w.owner_id, w.author_id, " +
  "u.username AS author_username, u.role AS author_role " +
  "FROM wall_posts w JOIN users u ON u.id = w.author_id ";

function publicWallPost(row) {
  return {
    id: Number(row.id),
    body: row.body,
    pinnedAt: row.pinned_at ? new Date(Number(row.pinned_at) * 1000).toISOString() : null,
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    author: {
      id: Number(row.author_id),
      username: row.author_username,
      role: row.author_role ? publicRole(row.author_role) : null,
    },
  };
}

// GET /api/users/:id/wall — public. Pinned posts first (newest pin wins),
// then unpinned newest-first.
async function handleWallReadRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/users\/([0-9]{1,15})\/wall$/);
  if (!match || method !== "GET") return null;
  const ownerId = Number(match[1]);
  const rows = (await env.FORUM_DB.prepare(
    WALL_SELECT + "WHERE w.owner_id = ? AND " + WALL_BAN_FILTER_SQL +
    " ORDER BY (w.pinned_at IS NOT NULL) DESC, w.pinned_at DESC, w.id DESC " +
    "LIMIT " + WALL_PAGE_LIMIT,
  ).bind(ownerId).all()).results || [];
  return json({ wall: rows.map(publicWallPost) });
}

// POST /api/users/:id/wall — signed-in members only (the wall owner included;
// writing on your own wall is fine). Word filter, 280-char cap, then a
// background text auto-mod score that never blocks the response.
async function handleWallCreateRoute(request, env, url, path, method, ctx) {
  const match = path.match(/^\/api\/users\/([0-9]{1,15})\/wall$/);
  if (!match || method !== "POST") return null;
  const ownerId = Number(match[1]);
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const owner = await env.FORUM_DB.prepare(
    "SELECT id FROM users WHERE id = ? LIMIT 1",
  ).bind(ownerId).first();
  if (!owner) throw new HttpError(404, "That member does not exist.");
  const body = await readJson(request);
  const message = applyWordFilter(
    String(body.body ?? "").trim().slice(0, WALL_MAX_CHARS),
    filterWords(env),
  );
  if (!message) throw new HttpError(400, "Write something first.");
  const result = await env.FORUM_DB.prepare(
    "INSERT INTO wall_posts (owner_id, author_id, body, created_at) VALUES (?, ?, ?, ?)",
  ).bind(ownerId, session.user.id, message, nowSeconds()).run();
  const wallPostId = Number(result.meta?.last_row_id);
  const row = await env.FORUM_DB.prepare(
    WALL_SELECT + "WHERE w.id = ? LIMIT 1",
  ).bind(wallPostId).first();
  return json({ wallPost: publicWallPost(row) }, 201);
}

// POST/DELETE /api/wall/:id/pin — the wall OWNER's only power over the posts
// on their wall. Pinning one post never unpins the others (pinned sort first
// by pin time); DELETE restores it to the normal newest-first flow.
async function handleWallPinRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/wall\/([0-9]{1,15})\/pin$/);
  if (!match) return null;
  if (method !== "POST" && method !== "DELETE") return null;
  const session = await requireUser(request, env);
  const wallPostId = Number(match[1]);
  const row = await env.FORUM_DB.prepare(
    "SELECT id, owner_id FROM wall_posts WHERE id = ? LIMIT 1",
  ).bind(wallPostId).first();
  if (!row) throw new HttpError(404, "That wall post does not exist.");
  if (Number(row.owner_id) !== Number(session.user.id)) {
    throw new HttpError(403, "Only the profile owner can pin wall posts.");
  }
  if (method === "POST") {
    await env.FORUM_DB.prepare(
      "UPDATE wall_posts SET pinned_at = ? WHERE id = ?",
    ).bind(nowSeconds(), wallPostId).run();
    return json({ pinned: true });
  }
  await env.FORUM_DB.prepare(
    "UPDATE wall_posts SET pinned_at = NULL WHERE id = ?",
  ).bind(wallPostId).run();
  return json({ pinned: false });
}

export async function handleWallRoutes(request, env, url, path, method, ctx) {
  const handlers = [handleWallReadRoute, handleWallCreateRoute, handleWallPinRoute];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}

export { WALL_MAX_CHARS, WALL_PAGE_LIMIT };
