// v4.0 plan 3 composer: the moderation desk's dispatcher. Split along the
// spec's seam — bans.mjs ("who bans"), reports.mjs ("who reviews": all
// queues + pin/unpin + hidden posts), members-admin.mjs (roles + member
// search), avatars.mjs (the avatar moderation queue's own lifecycle). The
// dispatcher order is untouched; worker.mjs keeps importing createUserBan
// from here.
// v4.0 plan 3, Task 2: the avatar moderation queue moved to api/avatars.mjs
// (the spec puts the queue routes with the avatar lifecycle); its dispatcher
// registrations import back here in the original order.
import { handleAvatarModerationRoute, handleAvatarQueueRoute } from "./avatars.mjs";
// v4.0 plan 3, Task 4: the review desk (all report queues, pin/unpin, the
// hidden-posts page) moved to api/reports.mjs.
import {
  handleHiddenPostsRoute,
  handleReportCreateRoute,
  handleReportQueueRoute,
  handleReportResolveRoute,
  handleThreadPinRoute,
} from "./reports.mjs";
// v4.0 plan 3, Task 3: the ban family moved to api/bans.mjs ("who bans" —
// the spec's first moderation seam); the composer re-exports createUserBan
// because worker.mjs imports it from here.
import { createUserBan, handleBanListRoute, handleBanMutationRoute } from "./bans.mjs";
import {
  HttpError,
  json,
  nowSeconds,
  publicRole,
  requireAdmin,
  requiremod,
  ROLE_ADMIN_DB,
  ROLE_MEMBER_DB,
} from "./shared.mjs";

// Promotion is strictly an admin operation. Role transitions carry a
// role guard in the UPDATE itself (changes-checked), and admins are
// refused up front — including self-demotion — so 'owner' is unreachable from
// here. Sessions are not invalidated: readSession reads the role at request
// time, so demotion applies on the target's next request.
const ROLE_CHANGE_ADMIN_403 = "Owner accounts cannot be modified here.";
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
  // Two vocabularies (v3.1 rename): the WHERE guard binds the STORED value
  // the row actually carries; every comparison below runs in the public
  // vocabulary after publicRole maps it.
  const storedRole = target.role;
  const currentRole = publicRole(storedRole);
  if (currentRole === "owner") throw new HttpError(403, ROLE_CHANGE_ADMIN_403);

  if (match[2] === "promote") {
    if (currentRole !== "member") throw new HttpError(409, ROLE_UNCHANGED_409);
  } else if (currentRole !== "admin") {
    throw new HttpError(409, ROLE_UNCHANGED_409);
  }

  const nextRole = match[2] === "promote" ? ROLE_ADMIN_DB : ROLE_MEMBER_DB;
  const result = await db.prepare(
    "UPDATE users SET role = ? WHERE id = ? AND role = ?",
  ).bind(nextRole, targetId, storedRole).run();
  if (Number(result.meta?.changes) !== 1) {
    // The role changed between the read and the write; report the stale-role
    // conflict rather than pretending the promotion happened.
    throw new HttpError(409, ROLE_UNCHANGED_409);
  }
  return json({ ok: true, role: publicRole(nextRole) });
}

// Member search (v3.1, Pone's ask — "make it easy to find players and unban
// them"): staff-only username lookup with the active-ban state attached, so
// an unban is one search + one button away.
async function handleMemberSearchRoute(request, env, url, path, method) {
  if (path !== "/api/admin/users/search" || method !== "GET") return null;
  await requiremod(request, env, false);
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
  if (!query) return json({ members: [] });
  const pattern = "%" + query.replace(/[\\%_]/g, (character) => "\\" + character) + "%";
  const result = await env.FORUM_DB.prepare(
    "SELECT u.id, u.username, u.role, " +
      "(SELECT b.reason FROM bans b WHERE b.user_id = u.id AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > ?) ORDER BY b.id DESC LIMIT 1) AS ban_reason, " +
      "(SELECT b.expires_at FROM bans b WHERE b.user_id = u.id AND b.revoked_at IS NULL " +
      "AND (b.expires_at IS NULL OR b.expires_at > ?) ORDER BY b.id DESC LIMIT 1) AS ban_expires_at " +
      "FROM users u WHERE u.username_key LIKE ? ESCAPE '\\' ORDER BY u.id ASC LIMIT 20",
  ).bind(nowSeconds(), nowSeconds(), pattern).all();
  return json({
    members: (result.results || []).map((row) => ({
      id: Number(row.id),
      username: row.username,
      role: publicRole(row.role),
      banned: Boolean(row.ban_reason),
      banReason: row.ban_reason || null,
      banExpiresAt: row.ban_expires_at === null || row.ban_expires_at === undefined
        ? null
        : Number(row.ban_expires_at),
    })),
  });
}

async function handleModerationRoutes(request, env, url, path, method, ctx) {
  const handlers = [
    handleReportCreateRoute,
    handleReportQueueRoute,
    handleReportResolveRoute,
    handleBanListRoute,
    handleBanMutationRoute,
    handleMemberSearchRoute,
    handleRoleChangeRoute,
    handleAvatarQueueRoute,
    handleAvatarModerationRoute,
    handleHiddenPostsRoute,
    handleThreadPinRoute,
  ];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}

export { handleModerationRoutes, createUserBan };
