// Reports, report resolution, bans, promote/demote (admin-only), and avatar
// moderation routes (moderation desk).
import { UNBAN_ACTIVE_UPDATE_SQL } from "../constants.mjs";
import {
  assertNotBanned,
  canViewPost,
  HttpError,
  json,
  nowSeconds,
  postById,
  rateLimit,
  readJson,
  requireAdmin,
  requireMutationApplied,
  requireModerator,
  requireUser,
  requiredText,
} from "./shared.mjs";

async function handleReportCreateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const reportMatch = path.match(/^\/api\/posts\/([0-9]+)\/reports$/);
  if (reportMatch && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "report", String(session.user.id));
    const postId = Number(reportMatch[1]);
    if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
    const post = await postById(env, postId, session.user.id);
    if (!(await canViewPost(env, post, session.user))) throw new HttpError(404, "Post not found.");
    if (Number(post.author_id) === session.user.id) throw new HttpError(400, "You cannot report your own post.");
    const body = await readJson(request);
    const reason = requiredText(body.reason, "report reason", 500);
    try {
      const result = await db.prepare(
        "INSERT INTO reports (post_id, reporter_id, reason, status, created_at) " +
          "SELECT ?, ?, ?, 'open', ? WHERE NOT EXISTS (" +
          "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
          "AND (expires_at IS NULL OR expires_at > ?))",
      ).bind(postId, session.user.id, reason, nowSeconds(), session.user.id, nowSeconds()).run();
      requireMutationApplied(result);
    } catch (error) {
      const duplicate = await db.prepare(
        "SELECT id FROM reports WHERE post_id = ? AND reporter_id = ? AND status = 'open' LIMIT 1",
      ).bind(postId, session.user.id).first();
      if (duplicate) throw new HttpError(409, "You already have an open report for this post.");
      throw error;
    }
    return json({ ok: true }, 201);
  }
  return null;
}

async function handleReportQueueRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/reports" && method === "GET") {
    await requireModerator(request, env, false);
    const result = await db.prepare(
      "SELECT r.id, r.reason, r.created_at, reporter.username AS reporter_username, " +
        "p.id AS post_id, p.body AS post_body, p.visibility AS post_visibility, author.id AS author_id, author.username AS author_username " +
        "FROM reports r JOIN users reporter ON reporter.id = r.reporter_id " +
        "JOIN posts p ON p.id = r.post_id JOIN users author ON author.id = p.author_id " +
        "WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT 100",
    ).all();
    return json({
      reports: (result.results || []).map((row) => ({
        id: Number(row.id),
        reason: row.reason,
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
        reporter: { username: row.reporter_username },
        post: {
          id: Number(row.post_id),
          // Moderator-only desk (v3.0.1): the queue is behind requireModerator,
          // and the nuke rule leaves mods as the only viewers of hidden
          // content — so the body shows here instead of a withheld marker.
          body: row.post_body,
          hidden: row.post_visibility !== "public",
          author: { id: Number(row.author_id), username: row.author_username },
        },
      })),
    });
  }
  return null;
}

async function hidePostForOpenReport(db, reportId, moderatorId, now) {
  const results = await db.batch([
    db.prepare(
      "UPDATE posts SET visibility = 'hidden' WHERE id = (" +
        "SELECT post_id FROM reports WHERE id = ? AND status = 'open')",
    ).bind(reportId),
    db.prepare(
      "UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ? " +
        "WHERE id = ? AND status = 'open'",
    ).bind(now, moderatorId, reportId),
  ]);
  if (Number(results[1]?.meta?.changes) !== 1) {
    throw new HttpError(409, "This report was already resolved by another moderator.");
  }
}

async function dismissOpenReport(db, reportId, moderatorId, now) {
  const result = await db.prepare(
    "UPDATE reports SET status = 'dismissed', resolved_at = ?, resolved_by = ? " +
      "WHERE id = ? AND status = 'open'",
  ).bind(now, moderatorId, reportId).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409, "This report was already resolved by another moderator.");
  }
}

async function handleReportResolveRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/reports\/([0-9]+)\/resolve$/);
  if (!match || method !== "POST") return null;

  const session = await requireModerator(request, env);
  const reportId = Number(match[1]);
  if (!Number.isSafeInteger(reportId) || reportId < 1) {
    throw new HttpError(404, "Report not found.");
  }
  const body = await readJson(request);
  if (body.action !== "dismiss" && body.action !== "hide_post") {
    throw new HttpError(400, "Choose dismiss or hide post.");
  }
  const db = env.FORUM_DB;
  const report = await db.prepare(
    "SELECT id, post_id FROM reports WHERE id = ? AND status = 'open' LIMIT 1",
  ).bind(reportId).first();
  if (!report) throw new HttpError(404, "Open report not found.");

  const now = nowSeconds();
  if (body.action === "hide_post") {
    await hidePostForOpenReport(db, reportId, session.user.id, now);
  } else {
    await dismissOpenReport(db, reportId, session.user.id, now);
  }
  return json({ ok: true });
}

async function handleBanListRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/bans" && method === "GET") {
    await requireModerator(request, env, false);
    const result = await db.prepare(
      "SELECT b.id, b.user_id, b.reason, b.expires_at, u.username " +
        "FROM bans b JOIN users u ON u.id = b.user_id " +
        "WHERE b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?) " +
        "ORDER BY b.created_at DESC LIMIT 200",
    ).bind(nowSeconds()).all();
    return json({
      bans: (result.results || []).map((row) => ({
        id: Number(row.id),
        user: { id: Number(row.user_id), username: row.username },
        reason: row.reason,
        expiresAt: row.expires_at ? new Date(Number(row.expires_at) * 1000).toISOString() : null,
      })),
    });
  }
  return null;
}

async function createUserBan(db, targetId, moderatorId, request) {
  const body = await readJson(request);
  const reason = requiredText(body.reason, "ban reason", 500);
  const now = nowSeconds();
  const results = await db.batch([
    db.prepare(
      "UPDATE bans SET revoked_at = ?, revoked_by = ?, revocation_reason = 'Expired automatically' " +
        "WHERE user_id = ? AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?",
    ).bind(now, moderatorId, targetId, now),
    db.prepare(
      "INSERT INTO bans (user_id, reason, created_at, created_by) " +
        "SELECT ?, ?, ?, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(targetId, reason, now, moderatorId, targetId, now),
    db.prepare(
      "DELETE FROM sessions WHERE user_id = ? AND EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(targetId, targetId, now),
  ]);
  if (Number(results[1]?.meta?.changes) !== 1) {
    throw new HttpError(409, "This member is already banned.");
  }
  return json({ ok: true }, 201);
}

async function revokeUserBan(db, targetId, moderatorId, request) {
  const body = await readJson(request);
  const reason = requiredText(body.reason, "unban reason", 500);
  const active = await db.prepare(
    "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1",
  ).bind(targetId, nowSeconds()).first();
  if (!active) throw new HttpError(404, "No active ban was found for this member.");
  const now = nowSeconds();
  const result = await db.prepare(UNBAN_ACTIVE_UPDATE_SQL)
    .bind(now, moderatorId, reason, Number(active.id), targetId, now).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409, "This ban was already revoked by another moderator.");
  }
  return json({ ok: true });
}

async function handleBanMutationRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/users\/([0-9]+)\/bans$/);
  if (!match || (method !== "POST" && method !== "DELETE")) return null;

  const session = await requireModerator(request, env);
  const targetId = Number(match[1]);
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(404, "Member not found.");
  const db = env.FORUM_DB;
  const target = await db.prepare(
    "SELECT id, role FROM users WHERE id = ? LIMIT 1",
  ).bind(targetId).first();
  if (!target) throw new HttpError(404, "Member not found.");
  if (target.role === "admin" || targetId === session.user.id) {
    throw new HttpError(403, "Administrator accounts cannot be banned here.");
  }
  if (method === "POST") return createUserBan(db, targetId, session.user.id, request);
  return revokeUserBan(db, targetId, session.user.id, request);
}

// Promotion is strictly an administrator operation. Role transitions carry a
// role guard in the UPDATE itself (changes-checked), and administrators are
// refused up front — including self-demotion — so 'admin' is unreachable from
// here. Sessions are not invalidated: readSession reads the role at request
// time, so demotion applies on the target's next request.
const ROLE_CHANGE_ADMIN_403 = "Administrator accounts cannot be modified here.";
const ROLE_UNCHANGED_409 = "That member already has this role.";

async function handleRoleChangeRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/users\/([0-9]+)\/(promote|demote)$/);
  if (!match || method !== "POST") return null;

  const session = await requireAdmin(request, env);
  const targetId = Number(match[1]);
  if (!Number.isSafeInteger(targetId) || targetId < 1) {
    throw new HttpError(404, "Member not found.");
  }
  // Body is validated (reason optional, not stored) but otherwise ignored.
  const body = await readJson(request);
  if (body.reason !== undefined &&
      (typeof body.reason !== "string" || body.reason.length > 500)) {
    throw new HttpError(400, "Enter a valid reason.");
  }
  const db = env.FORUM_DB;
  const target = await db.prepare(
    "SELECT id, role FROM users WHERE id = ? LIMIT 1",
  ).bind(targetId).first();
  if (!target) throw new HttpError(404, "Member not found.");
  if (target.role === "admin") throw new HttpError(403, ROLE_CHANGE_ADMIN_403);

  if (match[2] === "promote") {
    if (target.role !== "member") throw new HttpError(409, ROLE_UNCHANGED_409);
  } else if (target.role !== "moderator") {
    throw new HttpError(409, ROLE_UNCHANGED_409);
  }

  const nextRole = match[2] === "promote" ? "moderator" : "member";
  const result = await db.prepare(
    "UPDATE users SET role = ? WHERE id = ? AND role = ?",
  ).bind(nextRole, targetId, target.role).run();
  if (Number(result.meta?.changes) !== 1) {
    // The role changed between the read and the write; report the stale-role
    // conflict rather than pretending the promotion happened.
    throw new HttpError(409, ROLE_UNCHANGED_409);
  }
  return json({ ok: true, role: nextRole });
}

// Pending avatar moderation queue: oldest uploads first, capped at 100.
async function handleAvatarQueueRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/avatars" && method === "GET") {
    await requireModerator(request, env, false);
    const result = await db.prepare(
      "SELECT id, username, pending_avatar_updated_at, pending_avatar_version " +
        "FROM users WHERE avatar_status = 'pending' " +
        "ORDER BY pending_avatar_updated_at ASC LIMIT 100",
    ).bind().all();
    return json({
      avatars: (result.results || []).map((row) => ({
        userId: Number(row.id),
        username: row.username,
        avatarUrl: "/api/avatars/" + row.id + "?v=" + row.pending_avatar_version,
        uploadedAt: new Date(Number(row.pending_avatar_updated_at) * 1000).toISOString(),
      })),
    });
  }
  return null;
}

async function resolveAvatarPending(db, userId, approve) {
  if (approve) {
    // Copy the pending set into the approved set and clear pending in one
    // statement — SQLite evaluates every RHS against the pre-update row, so
    // the mirror-set CHECKs hold. The avatar_status guard makes the update
    // idempotency-safe: 0 changes means nothing was awaiting review.
    const result = await db.prepare(
      "UPDATE users SET " +
        "avatar_mime = pending_avatar_mime, avatar_data = pending_avatar_data, " +
        "avatar_updated_at = pending_avatar_updated_at, avatar_version = pending_avatar_version, " +
        "pending_avatar_mime = NULL, pending_avatar_data = NULL, " +
        "pending_avatar_updated_at = NULL, pending_avatar_version = NULL, " +
        "avatar_status = 'approved' " +
        "WHERE id = ? AND avatar_status = 'pending'",
    ).bind(userId).run();
    if (Number(result.meta?.changes) !== 1) {
      throw new HttpError(409, "That avatar is not awaiting review.");
    }
    return;
  }
  // Reject: clear the pending set. An already-approved avatar reappears for
  // public serving; a first-upload has nothing left, so status returns to
  // the never-uploaded NULL. One statement with a CASE (documented choice
  // over a two-statement batch) keeps the guard and the transition atomic.
  const result = await db.prepare(
    "UPDATE users SET " +
      "pending_avatar_mime = NULL, pending_avatar_data = NULL, " +
      "pending_avatar_updated_at = NULL, pending_avatar_version = NULL, " +
      "avatar_status = CASE WHEN avatar_mime IS NOT NULL THEN 'approved' ELSE NULL END " +
      "WHERE id = ? AND avatar_status = 'pending'",
  ).bind(userId).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409, "That avatar is not awaiting review.");
  }
}

async function handleAvatarModerationRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/avatars\/([0-9]+)\/(approve|reject)$/);
  if (!match || method !== "POST") return null;

  const session = await requireModerator(request, env);
  await assertNotBanned(env, session.user.id);
  const userId = Number(match[1]);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new HttpError(404, "Member not found.");
  }
  const db = env.FORUM_DB;
  const target = await db.prepare(
    "SELECT id FROM users WHERE id = ? LIMIT 1",
  ).bind(userId).first();
  if (!target) throw new HttpError(404, "Member not found.");

  await resolveAvatarPending(db, userId, match[2] === "approve");
  return json({ ok: true });
}

// Thread pinning (C5): POST /api/admin/threads/:id/pin|unpin — moderators or
// admin, the desk idiom (requireModerator mutating + changes-checked UPDATE
// with a SQL guard). Root-only like boards/subscriptions; the write-time WHERE
// clauses are also the idempotency-conflict detector, turning a double pin or
// an unpin of an unpinned thread into a 409 instead of a silent no-op.
const THREAD_PIN_ROUTE = /^\/api\/admin\/threads\/([0-9]+)\/(pin|unpin)$/;

async function handleThreadPinRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(THREAD_PIN_ROUTE);
  if (!match || method !== "POST") return null;

  const session = await requireModerator(request, env);
  await assertNotBanned(env, session.user.id);
  const threadId = Number(match[1]);
  if (!Number.isSafeInteger(threadId) || threadId < 1) {
    throw new HttpError(404, "Thread not found.");
  }
  const thread = await db.prepare(
    "SELECT id, parent_id, pinned_at FROM posts WHERE id = ? LIMIT 1",
  ).bind(threadId).first();
  if (!thread) throw new HttpError(404, "Thread not found.");
  // Root-only: a reply has no pin of its own.
  if (thread.parent_id !== null && thread.parent_id !== undefined) {
    throw new HttpError(400, "Only thread roots can be pinned.");
  }
  const now = nowSeconds();
  if (match[2] === "pin") {
    // The pinned_at guard turns an already-pinned thread (or a thread deleted
    // between the read and the write) into a 0-change update. Fix round 1: the
    // old `thread ? 409 : 404` was dead (the existence 404 already ran), so the
    // ambiguous 0-change re-reads the row: gone → 404, still there → 409.
    const result = await db.prepare(
      "UPDATE posts SET pinned_at = ? WHERE id = ? AND parent_id IS NULL AND pinned_at IS NULL",
    ).bind(now, threadId).run();
    if (Number(result.meta?.changes) !== 1) {
      if (!(await db.prepare("SELECT id FROM posts WHERE id = ? LIMIT 1").bind(threadId).first())) {
        throw new HttpError(404, "Thread not found.");
      }
      throw new HttpError(409, "This thread is already pinned.");
    }
    return json({ ok: true, pinned: true });
  }
  const result = await db.prepare(
    "UPDATE posts SET pinned_at = NULL WHERE id = ? AND parent_id IS NULL AND pinned_at IS NOT NULL",
  ).bind(threadId).run();
  if (Number(result.meta?.changes) !== 1) {
    // Same 0-change ambiguity as the pin above.
    if (!(await db.prepare("SELECT id FROM posts WHERE id = ? LIMIT 1").bind(threadId).first())) {
      throw new HttpError(404, "Thread not found.");
    }
    throw new HttpError(409, "This thread is not pinned.");
  }
  return json({ ok: true, pinned: false });
}

// Hidden posts (v3.0.1, the nuke): the moderator-only page. Lists every post
// normal surfaces never carry — a hidden row or ANY row by an actively
// banned author — bodies included, since mods ARE the only in-app door now.
async function handleHiddenPostsRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path !== "/api/admin/hidden" || method !== "GET") return null;
  await requireModerator(request, env, false);
  const result = await db.prepare(
    "SELECT p.id, p.body, p.visibility, p.board, p.created_at, p.parent_id, " +
      "author.id AS author_id, author.username AS author_username, " +
      "(SELECT b.reason FROM bans b WHERE b.user_id = p.author_id AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1) AS ban_reason, " +
      "(SELECT b.expires_at FROM bans b WHERE b.user_id = p.author_id AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER)) LIMIT 1) AS ban_expires_at, " +
      // Root link: a reply links to its thread (level-2 replies walk to the
      // level-1 parent's parent); roots link to themselves.
      "(SELECT CASE WHEN parent.parent_id IS NOT NULL THEN parent.parent_id ELSE parent.id END " +
      "FROM posts parent WHERE parent.id = p.parent_id) AS thread_root_id " +
      "FROM posts p JOIN users author ON author.id = p.author_id " +
      "WHERE p.visibility <> 'public' " +
      "OR EXISTS (SELECT 1 FROM bans b WHERE b.user_id = p.author_id AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > CAST(strftime('%s','now') AS INTEGER))) " +
      "ORDER BY p.created_at DESC LIMIT 100",
  ).all();
  return json({
    hidden: (result.results || []).map((row) => ({
      id: Number(row.id),
      body: row.body,
      visibility: row.visibility,
      board: row.board || "general",
      createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
      threadId: row.parent_id !== null && row.parent_id !== undefined
        ? Number(row.thread_root_id ?? row.parent_id)
        : Number(row.id),
      author: { id: Number(row.author_id), username: row.author_username },
      banReason: row.ban_reason || null,
      banExpiresAt: row.ban_expires_at === null || row.ban_expires_at === undefined
        ? null
        : new Date(Number(row.ban_expires_at) * 1000).toISOString(),
    })),
  });
}

async function handleModerationRoutes(request, env, url, path, method) {
  const handlers = [
    handleReportCreateRoute,
    handleReportQueueRoute,
    handleReportResolveRoute,
    handleBanListRoute,
    handleBanMutationRoute,
    handleRoleChangeRoute,
    handleAvatarQueueRoute,
    handleAvatarModerationRoute,
    handleHiddenPostsRoute,
    handleThreadPinRoute,
  ];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }
  return null;
}

export { handleModerationRoutes, createUserBan };