// v4.0 plan 3, Task 4: the "who reviews" module — every queue. Post reports
// (create / queue / resolve), profile reports (create + admin desk — moved
// here from profiles.mjs so both report families sit together, per the
// spec's seam), and the two review-desk post actions ruled into this module
// (thread pin/unpin and the hidden-posts desk page — see the plan's
// rulings). All bodies moved verbatim from their sources.
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { assertNotBanned, requireStaff, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requireMutationApplied, requiredText } from "./core/http.mjs";
import { postById } from "./core/shapers.mjs";
import { canViewPost } from "./core/visibility.mjs";

async function handleReportCreateRoute(request, env, url, path, method, ctx) {
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
    const reason = applyWordFilter(requiredText(body.reason, "report reason", 500), filterWords(env));
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
    await requireStaff(request, env, false);
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
          // mod-only desk (v3.0.1): the queue is behind requireStaff,
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

async function hidePostForOpenReport(db, reportId, modId, now) {
  const results = await db.batch([
    db.prepare(
      "UPDATE posts SET visibility = 'hidden' WHERE id = (" +
        "SELECT post_id FROM reports WHERE id = ? AND status = 'open')",
    ).bind(reportId),
    db.prepare(
      "UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ? " +
        "WHERE id = ? AND status = 'open'",
    ).bind(now, modId, reportId),
  ]);
  if (Number(results[1]?.meta?.changes) !== 1) {
    throw new HttpError(409, "This report was already resolved by another mod.");
  }
}

async function dismissOpenReport(db, reportId, modId, now) {
  const result = await db.prepare(
    "UPDATE reports SET status = 'dismissed', resolved_at = ?, resolved_by = ? " +
      "WHERE id = ? AND status = 'open'",
  ).bind(now, modId, reportId).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409, "This report was already resolved by another mod.");
  }
}

async function handleReportResolveRoute(request, env, url, path, method) {
  const match = path.match(/^\/api\/admin\/reports\/([0-9]+)\/resolve$/);
  if (!match || method !== "POST") return null;

  const session = await requireStaff(request, env);
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

// Thread pinning (C5): POST /api/admin/threads/:id/pin|unpin — any staff
// member, the desk idiom (requireStaff mutating + changes-checked UPDATE
// with a SQL guard). Root-only like boards/subscriptions; the write-time WHERE
// clauses are also the idempotency-conflict detector, turning a double pin or
// an unpin of an unpinned thread into a 409 instead of a silent no-op.
const THREAD_PIN_ROUTE = /^\/api\/admin\/threads\/([0-9]+)\/(pin|unpin)$/;

async function handleThreadPinRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(THREAD_PIN_ROUTE);
  if (!match || method !== "POST") return null;

  const session = await requireStaff(request, env);
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
// Hidden posts (v3.0.1, the nuke): the mod-only page. Lists every post
// normal surfaces never carry — a hidden row or ANY row by an actively
// banned author — bodies included, since mods ARE the only in-app door now.
async function handleHiddenPostsRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path !== "/api/admin/hidden" || method !== "GET") return null;
  await requireStaff(request, env, false);
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
// Report-a-profile (v2.5): members report another member's profile surface
// (bio/flair/banner/custom CSS) — the moderation desk handles the queue
// (open first, resolve mirrors the post-reports route).
async function handleProfileReportRoute(request, env, url, path, method, ctx) {
  const db = env.FORUM_DB;
  const reportMatch = path.match(/^\/api\/users\/([0-9]+)\/reports$/);
  if (reportMatch && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "write");
    await rateLimit(request, env, "report", String(session.user.id));
    const profileUserId = Number(reportMatch[1]);
    if (!Number.isSafeInteger(profileUserId) || profileUserId < 1 || profileUserId === Number(session.user.id)) {
      throw new HttpError(400, "You can't report that profile.");
    }
    const target = await db.prepare(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
    ).bind(profileUserId).first();
    if (!target) throw new HttpError(404, "Member not found.");
    const body = await readJson(request);
    const reason = applyWordFilter(requiredText(body.reason, "report", 500), filterWords(env));
    const results = await db.batch([
      db.prepare(
        "INSERT INTO profile_reports (profile_user_id, reporter_id, reason, status, created_at) " +
        "VALUES (?, ?, ?, 'open', ?)",
      ).bind(profileUserId, session.user.id, reason, nowSeconds()),
    ]);
    requireMutationApplied(results[0]);
    return json({ id: Number(results[0].meta.last_row_id) }, 201);
  }
  return null;
}

async function handleProfileReportAdminRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/profile-reports" && method === "GET") {
    await requireStaff(request, env, false);
    const result = await db.prepare(
      "SELECT pr.id, pr.profile_user_id, pr.reason, pr.created_at, u.username AS profileUsername, r2.username AS reporter " +
      "FROM profile_reports pr " +
      "JOIN users u ON u.id = pr.profile_user_id " +
      "JOIN users r2 ON r2.id = pr.reporter_id " +
      "WHERE pr.status = 'open' ORDER BY pr.created_at ASC LIMIT 100",
    ).all();
    return json({
      profileReports: (result.results || []).map((row) => ({
        id: Number(row.id),
        profileUserId: Number(row.profile_user_id),
        profileUsername: row.profileUsername,
        reporter: row.reporter,
        reason: row.reason,
        createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
      })),
    });
  }
  const resolveMatch = path.match(/^\/api\/admin\/profile-reports\/([0-9]+)\/resolve$/);
  if (resolveMatch && method === "POST") {
    const session = await requireStaff(request, env);
    await assertNotBanned(env, session.user.id);
    const resolved = await db.batch([
      db.prepare(
        "UPDATE profile_reports SET status = 'resolved', resolved_at = ? " +
        "WHERE id = ? AND status = 'open'",
      ).bind(nowSeconds(), Number(resolveMatch[1])),
    ]);
    if (Number(resolved[0]?.meta?.changes) !== 1) throw new HttpError(404, "Not found.");
    return json({ resolved: true, id: Number(resolveMatch[1]) });
  }
  return null;
}

export {
  dismissOpenReport,
  handleHiddenPostsRoute,
  handleProfileReportAdminRoute,
  handleProfileReportRoute,
  handleReportCreateRoute,
  handleReportQueueRoute,
  handleReportResolveRoute,
  handleThreadPinRoute,
  hidePostForOpenReport,
};
