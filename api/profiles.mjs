// v4.0 plan 3 composer: profile-group dispatcher. Avatar upload/serve and the
// moderation queue moved to api/avatars.mjs (Task 2); the CSS routes moved to
// profile-css.mjs (Task 1 consumes its sandbox here); report routes moved to
// reports.mjs in Task 4. Everything else — profile read/update, password,
// account deletion — stays here this plan.
import { archivePostRowsStatement } from "./core/archive.mjs";
import { assertNotBanned, readSession, requireStaff, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, readLimitedBody, requireMutationApplied } from "./core/http.mjs";
import { hashPassword, isValidPassword, verifyPassword } from "./core/passwords.mjs";
import { publicRole } from "./core/roles.mjs";
import { normalizeBannerColor, normalizeProfileAccent, normalizeProfileColorInput, PROFILE_ACCENTS, PROFILE_BANNER_COLORS, SOCIAL_PLATFORMS, socialsFromRow, userByUsernameKey } from "./core/shapers.mjs";
import { listRootPosts } from "./posts-feed.mjs";
import { applyWordFilter, containsFilteredWord, normalizeUsernameForFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
// v4.0 plan 3, Task 2: the avatar lifecycle (upload, serve, moderation queue)
// moved to its topic module — the dispatcher keeps registering these two.
import { handleAvatarReadRoute, handleAvatarUploadRoute } from "./avatars.mjs";
// v4.0 plan 3, Task 4: both profile-report routes moved to api/reports.mjs
// (both report families in the "who reviews" module).
import { handleProfileReportAdminRoute, handleProfileReportRoute } from "./reports.mjs";
// v4.0 plan 3, Task 1: the custom-CSS sandbox moved to its topic module.
import { CUSTOM_CSS_MAX_BYTES, scopeProfileCss } from "./profile-css.mjs";

// PATCH /api/me carries up to a 10,000-character bio, so this route lifts the
// 16 KB global JSON cap to 64 KB (Task 2 pre-approved per-route interface).
const ME_JSON_BYTES = 64 * 1024;
const BIO_MAX_LENGTH = 10000;

async function handleUserProfileRoute(request, env, url, path, method) {
  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === "GET") {
    let username;
    try {
      username = decodeURIComponent(userMatch[1]);
    } catch {
      throw new HttpError(404, "Member not found.");
    }
    const user = await userByUsernameKey(env, username.toLowerCase());
    if (!user) throw new HttpError(404, "Member not found.");
    // Per-user post counter (v2.6): two COUNT subselects — threads started
    // and replies written (any post row with a parent). Display-only; it
    // does not filter by visibility (the author's own-view semantics), and
    // the posts LIST right below still applies all visibility rules.
    const counts = await env.FORUM_DB.prepare(
      "SELECT " +
      "(SELECT COUNT(*) FROM posts WHERE author_id = ? AND parent_id IS NULL) AS posts_count, " +
      "(SELECT COUNT(*) FROM posts WHERE author_id = ? AND parent_id IS NOT NULL) AS replies_count",
    ).bind(Number(user.id), Number(user.id)).first();
    const session = await readSession(request, env);
    // Banned-profile banner (v3.1): the PUBLIC payload carries only the
    // active-ban flag and expiry (the same predicate every read path uses) —
    // the reason rides along only for staff, matching member search. Guests
    // and members see the banner, not the moderation detail.
    const ban = await env.FORUM_DB.prepare(
      "SELECT reason, expires_at FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC LIMIT 1",
    ).bind(Number(user.id), nowSeconds()).first();
    const viewerIsStaff = Boolean(session && session.user &&
      (session.user.role === "owner" || session.user.role === "admin"));
    const beforeRaw = url.searchParams.get("before");
    let before = null;
    if (beforeRaw !== null) {
      if (!/^[1-9][0-9]{0,14}$/.test(beforeRaw)) throw new HttpError(400, "That page cursor is invalid.");
      before = Number(beforeRaw);
    }
    const posts = await listRootPosts(env, session && session.user ? session.user : null, {
      authorId: Number(user.id),
      before,
    });
    return json({
      id: Number(user.id),
      username: user.username,
      role: publicRole(user.role),
      postsCount: Number(counts && counts.posts_count || 0),
      repliesCount: Number(counts && counts.replies_count || 0),
      // Profile themes (v2.5): the whitelisted accent KEY for the client's
      // per-key CSS class ("" normalizes rows missing the projection).
      profileAccent: normalizeProfileAccent(user.profile_accent || ""),
      bannerColor: normalizeBannerColor(user.banner_color || ""),
      bannerText: applyWordFilter(user.banner_text || "", filterWords(env)) || "",
      flair: applyWordFilter(user.flair || "", filterWords(env)) || "",
      // Custom CSS (v2.5): only the APPROVED css serves, pre-scoped by the
      // sandbox (profile-css.mjs); pending rewrites stay invisible to the public.
      customCss: scopeProfileCss(user.approved_css || ""),
      customCssRaw: session?.user?.id === Number(user.id)
        ? String(user.pending_css ?? user.approved_css ?? "")
        : undefined,
      bio: user.bio || "",
      socials: socialsFromRow(user),
      polytoriaUsername: user.polytoria_username || null,
      avatarUrl: user.avatar_mime ? "/api/avatars/" + user.id + "?v=" + user.avatar_version : null,
      posts: posts.posts,
      postsNextBefore: posts.nextBefore,
      banned: Boolean(ban),
      banExpiresAt: ban && ban.expires_at !== null && ban.expires_at !== undefined
        ? Number(ban.expires_at)
        : null,
      ...(viewerIsStaff && ban ? { banReason: ban.reason || null } : {}),
    });
  }
  return null;
}

async function handleProfileUpdateRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me" && method === "PATCH") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    const body = await readJson(request, ME_JSON_BYTES);
    // Absent keys never touch their columns; both present together write in
    // one ban-gated UPDATE.
    const hasBio = body.bio !== undefined;
    const hasSocials = body.socials !== undefined;
    const hasAccent = body.profileAccent !== undefined;
    const hasBannerColor = body.bannerColor !== undefined;
    const hasBannerText = body.bannerText !== undefined;
    const hasFlair = body.flair !== undefined;
    if (!hasBio && !hasSocials && !hasAccent && !hasBannerColor && !hasBannerText && !hasFlair) {
      throw new HttpError(400, "Provide a bio, socials, accent, banner, or flair value to update.");
    }
    let bio = null;
    if (hasBio) {
      if (typeof body.bio !== "string") {
        throw new HttpError(400, "Your bio must be 10000 characters or fewer.");
      }
      bio = body.bio.trim();
      if (bio.length > BIO_MAX_LENGTH) {
        throw new HttpError(400, "Your bio must be 10000 characters or fewer.");
      }
      // Bios are masked exactly like post bodies: the limit above runs on the
      // raw trimmed text (the same order the posts flow uses) and applyWordFilter's
      // mask preserves length, so masking can never push a stored bio over the
      // limit afterwards. An unset FILTERED_WORDS secret is a strict no-op.
      bio = applyWordFilter(bio, filterWords(env));
    }
    let socials = null;
    if (hasSocials) {
      if (!body.socials || typeof body.socials !== "object" || Array.isArray(body.socials)) {
        throw new HttpError(400, "The socials value must be an object.");
      }
      socials = {};
      for (const [key, value] of Object.entries(body.socials)) {
        const platform = SOCIAL_PLATFORMS.find((candidate) => candidate.key === key);
        if (!platform) throw new HttpError(400, "That social platform is not supported.");
        if (value === null || value === "") {
          socials[key] = null;
          continue;
        }
        if (typeof value !== "string" || !platform.regex.test(value)) {
          throw new HttpError(400, "Enter a valid " + key + " name.");
        }
        // The filter covers EVERYTHING member-written, and a social handle
        // is identity like a username (masked #s would break the profile
        // link anyway): reject instead of mask, using the register flow's
        // strict checks — the word filter's masked form must survive intact
        // AND the stitched/leet-normalized form must contain no entry.
        if (applyWordFilter(value, filterWords(env)) !== value ||
            containsFilteredWord(normalizeUsernameForFilter(value), filterWords(env))) {
          throw new HttpError(400, "That " + key + " name can't be used here.");
        }
        socials[key] = value;
      }
    }

    let profileAccent = null;
    let bannerColor = null;
    let bannerText = null;
    let flair = null;
    if (hasBannerColor) {
      // Any hex (v3.0.2): "" clears, a legacy palette key converts to its
      // hex, everything else must be #rrggbb.
      const normalized = normalizeProfileColorInput(body.bannerColor, PROFILE_BANNER_COLORS);
      if (normalized === null) {
        throw new HttpError(400, "Pick a banner color like #4d8fc4, or leave it blank to clear.");
      }
      bannerColor = normalized;
    }
    if (hasBannerText) {
      // The banner text rides the word filter like a tiny post.
      if (typeof body.bannerText !== "string" || body.bannerText.trim().length > 80) {
        throw new HttpError(400, "Banner text must be 80 characters or fewer.");
      }
      bannerText = applyWordFilter(body.bannerText.trim(), filterWords(env));
    }
    if (hasFlair) {
      if (typeof body.flair !== "string" || body.flair.trim().length > 32) {
        throw new HttpError(400, "Flairs must be 32 characters or fewer.");
      }
      flair = applyWordFilter(body.flair.trim(), filterWords(env));
    }
    if (hasAccent) {
      // Profile accent (any hex, v3.0.2): "" clears, a legacy palette key
      // converts to its hex, everything else must be #rrggbb — stored
      // lowercased, applied client-side as a CSS custom property.
      const normalized = normalizeProfileColorInput(body.profileAccent, PROFILE_ACCENTS);
      if (normalized === null) {
        throw new HttpError(400, "Pick a profile color like #4d8fc4, or leave it blank to clear.");
      }
      profileAccent = normalized;
    }

    const assignments = [];
    const params = [];
    if (hasBio) {
      assignments.push("bio = ?");
      params.push(bio);
    }
    if (hasSocials) {
      for (const [key, value] of Object.entries(socials)) {
        assignments.push(SOCIAL_PLATFORMS.find((candidate) => candidate.key === key).column + " = ?");
        params.push(value);
      }
    }
    if (hasAccent) {
      assignments.push("profile_accent = ?");
      params.push(profileAccent);
    }
    if (hasBannerColor) {
      assignments.push("banner_color = ?");
      params.push(bannerColor);
    }
    if (hasBannerText) {
      assignments.push("banner_text = ?");
      params.push(bannerText);
    }
    if (hasFlair) {
      assignments.push("flair = ?");
      params.push(flair);
    }
    if (assignments.length === 0) {
      throw new HttpError(400, "Provide a bio, socials, or accent value to update.");
    }
    const result = await db.prepare(
      "UPDATE users SET " + assignments.join(", ") + " WHERE id = ? AND NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(...params, session.user.id, session.user.id, nowSeconds()).run();
    requireMutationApplied(result);

    const response = { bio: hasBio ? bio : session.user.bio || "" };
    if (hasSocials) {
      response.socials = Object.fromEntries(
        Object.entries(socials).filter(([, value]) => value !== null),
      );
    }
    if (hasAccent) {
      response.profileAccent = profileAccent;
    }
    if (hasBannerColor) response.bannerColor = bannerColor;
    if (hasBannerText) response.bannerText = bannerText;
    if (hasFlair) response.flair = flair;
    return json(response);
  }
  return null;
}



// Custom profile CSS (v2.5): members submit raw CSS (≤20 KiB); it lands
// pending (the previously approved CSS keeps serving — the avatar-mirror
// rule), and only mods flip it. The profile payload carries only the
// APPROVED css, pre-scoped via scopeProfileCss (profile-css.mjs's sandbox).
async function handleCssSetRoute(request, env, url, path, method) {
  if (path !== "/api/me/css" || method !== "POST") return null;
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  await rateLimit(request, env, "avatar-upload", String(session.user.id));
  const raw = await readLimitedBody(request, CUSTOM_CSS_MAX_BYTES + 1024);
  const decoded = new TextDecoder().decode(raw);
  // The client's api() JSON-encodes non-FormData bodies (v2.4-era helper
  // shape) — a CSS sheet sent that way arrives double-encoded: a leading
  // quote swallows the whole sheet as one JSON string. Detect and decode.
  let cssText = decoded.trim();
  const looksJson = (request.headers.get("Content-Type") || "").includes("application/json") ||
    (cssText.startsWith("\"") && cssText.endsWith("\"") && cssText.length > 1);
  if (looksJson) {
    try {
      const parsed = JSON.parse(cssText);
      cssText = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    } catch {
      /* keep the raw text — a CSS string that merely looks quoted stays */
    }
  }
  cssText = cssText.trim();
  // The filter covers everything member-written — custom CSS included. The
  // mask is #-preserving, so a hit only degrades styling (and a mod reviews
  // the sheet anyway); no stylesheet can carry a filtered word.
  cssText = applyWordFilter(cssText, filterWords(env));
  if (cssText.length > CUSTOM_CSS_MAX_BYTES) {
    throw new HttpError(413, "Custom CSS must be 20 KiB or smaller.");
  }
  const hasApproved = await env.FORUM_DB.prepare(
    "SELECT approved_css FROM users WHERE id = ? LIMIT 1",
  ).bind(session.user.id).first();
  const submissionVersion = crypto.randomUUID();
  await env.FORUM_DB.batch([
    env.FORUM_DB.prepare(
      "UPDATE users SET pending_css = ?, pending_css_version = ?, css_status = 'pending' WHERE id = ?",
    ).bind(cssText, submissionVersion, session.user.id),
  ]);
  return json({
    pending: cssText,
    serving: hasApproved && hasApproved.approved_css ? "previous-approved" : "none",
  });
}

async function handleCssClearRoute(request, env, url, path, method) {
  if (path !== "/api/me/css" || method !== "DELETE") return null;
  const session = await requireUser(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  await env.FORUM_DB.batch([
    env.FORUM_DB.prepare(
      "UPDATE users SET pending_css = NULL, pending_css_version = NULL, approved_css = '', css_status = 'none' WHERE id = ?",
    ).bind(session.user.id),
  ]);
  return json({ cleared: true });
}

// The css moderation desk (mirrors avatars): pending list oldest first,
// approve promotes pending→approved in the same single batch, reject clears.

// The approved theme as a STYLESHEET (v2.5): a same-origin css URL stays
// inside style-src 'self' — no CSP change; the scope prefixing happened at
// serve time. 404 when the member has no approved theme.
async function handleCssStylesheetRoute(request, env, url, path, method) {
  const cssMatch = path.match(/^\/api\/users\/([0-9]+)\/profile\.css$/);
  if (cssMatch && method === "GET") {
    const userId = Number(cssMatch[1]);
    if (!Number.isSafeInteger(userId) || userId < 1) throw new HttpError(404, "Not found.");
    const row = await env.FORUM_DB.prepare(
      "SELECT approved_css FROM users WHERE id = ? LIMIT 1",
    ).bind(userId).first();
    const scoped = scopeProfileCss(row && row.approved_css ? row.approved_css : "");
    if (!scoped) throw new HttpError(404, "Not found.");
    return new Response(scoped, {
      status: 200,
      headers: { "Content-Type": "text/css", "Cache-Control": "public, max-age=60" },
    });
  }
  return null;
}

async function handleCssAdminRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/css" && method === "GET") {
    await requireStaff(request, env, false);
    const result = await db.prepare(
      "SELECT id, username, pending_css, pending_css_version, css_status FROM users " +
      "WHERE css_status = 'pending' AND pending_css IS NOT NULL ORDER BY id LIMIT 100",
    ).all();
    return json({
      cssSubmissions: await Promise.all((result.results || []).map(async (row) => {
        const css = String(row.pending_css ?? "");
        return {
          userId: Number(row.id),
          username: row.username,
          css,
          bytes: css.length,
          version: String(row.pending_css_version ?? ""),
        };
      })),
    });
  }
  const cssMatch = path.match(/^\/api\/admin\/css\/([0-9]+)\/(approve|reject)$/);
  if (cssMatch && method === "POST") {
    const session = await requireStaff(request, env);
    await assertNotBanned(env, session.user.id);
    const userId = Number(cssMatch[1]);
    if (!Number.isSafeInteger(userId) || userId < 1) throw new HttpError(404, "Not found.");
    const expectedVersion = url.searchParams.get("version") || "";
    if (!/^(?:[0-9a-f]{32}|[0-9a-f-]{36})$/i.test(expectedVersion)) {
      throw new HttpError(409, "This CSS submission is stale. Refresh the moderation queue.");
    }
    const current = await db.prepare(
      "SELECT pending_css, pending_css_version, css_status FROM users WHERE id = ? LIMIT 1",
    ).bind(userId).first();
    if (!current || current.css_status !== "pending" || current.pending_css === null ||
        String(current.pending_css_version ?? "") !== expectedVersion) {
      throw new HttpError(409, "This CSS submission changed after it was loaded. Refresh the moderation queue.");
    }
    if (cssMatch[2] === "approve") {
      const reviewedCss = String(current.pending_css);
      const approved = await db.batch([
        db.prepare(
          "UPDATE users SET approved_css = ?, pending_css = NULL, pending_css_version = NULL, css_status = 'approved' " +
          "WHERE id = ? AND css_status = 'pending' AND pending_css = ? AND pending_css_version = ?",
        ).bind(reviewedCss, userId, reviewedCss, expectedVersion),
      ]);
      if (Number(approved[0]?.meta?.changes) !== 1) {
        throw new HttpError(409, "This CSS submission changed while being approved. Refresh the moderation queue.");
      }
      return json({ approved: true, id: userId });
    }
    const reviewedCss = String(current.pending_css);
    const rejected = await db.batch([
      db.prepare(
        "UPDATE users SET pending_css = NULL, pending_css_version = NULL, css_status = 'none' " +
        "WHERE id = ? AND css_status = 'pending' AND pending_css = ? AND pending_css_version = ?",
      ).bind(userId, reviewedCss, expectedVersion),
    ]);
    if (Number(rejected[0]?.meta?.changes) !== 1) {
      throw new HttpError(409, "This CSS submission changed while being rejected. Refresh the moderation queue.");
    }
    return json({ rejected: true, id: userId });
  }
  return null;
}

async function handlePasswordChangeRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me/password" && method === "PATCH") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    const body = await readJson(request);
    if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string" ||
      body.currentPassword.length > 128 || !isValidPassword(body.newPassword)) {
      throw new HttpError(400, "Enter your current password and a new password of 12–128 characters.");
    }
    await rateLimit(request, env, "password-change", String(session.user.id));
    const row = await userByUsernameKey(env, session.user.username.toLowerCase());
    if (!row || !(await verifyPassword(body.currentPassword, row.password_salt, row.password_hash, env.PASSWORD_PEPPER))) {
      throw new HttpError(401, "Your current password is incorrect.");
    }
    const password = await hashPassword(body.newPassword, env.PASSWORD_PEPPER);
    const results = await db.batch([
      db.prepare(
        "UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ? AND NOT EXISTS (" +
          "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
          "AND (expires_at IS NULL OR expires_at > ?))",
      ).bind(password.salt, password.hash, session.user.id, session.user.id, nowSeconds()),
      db.prepare(
        "DELETE FROM sessions WHERE user_id = ? AND token_hash != ? AND EXISTS (" +
          "SELECT 1 FROM users WHERE id = ? AND password_salt = ? AND password_hash = ?)",
      ).bind(session.user.id, session.tokenHash, session.user.id, password.salt, password.hash),
    ]);
    requireMutationApplied(results[0]);
    return json({ ok: true });
  }
  return null;
}

// Account deletion (v2.4.1 feature): POST /api/me/delete. Same-origin + CSRF
// via requireUser (mutating routes are Origin-gated by the core auth/CSRF
// gates and the
// worker's global write limiter runs first); the handler re-runs the write
// limiter like the post routes do. assertNotBanned is deliberately absent
// (spec-required for exactly this route): ban enforcement is lazy — the
// per-request checks happen at login/next-read, so a banned user holding a
// live session CAN reach this route and may delete their own account as their
// own way out. Deleting is also self-limiting: it removes the sessions and
// bans rows, so nothing here can extend or resurrect a ban.
//
// FK analysis (migrations 0001/0002/0003/0004 — deleting the USER row):
//   sessions.user_id        → users ON DELETE CASCADE
//   posts.author_id         → users ON DELETE CASCADE — takes every post the
//     user authored, and each of their root posts cascades its whole thread
//     (posts.parent_id CASCADE) including OTHER users' replies inside it,
//     with every child row (reactions/reports/notifications/attachments/
//     attachment_chunks cascading on posts)
//   reactions.user_id       → users ON DELETE CASCADE
//   reports.reporter_id     → users ON DELETE CASCADE
//   reports.resolved_by     → users ON DELETE SET NULL (kept, reviewer NULLed)
//   bans.user_id            → users ON DELETE CASCADE
//   bans.created_by / revoked_by → users ON DELETE SET NULL (kept, actor NULLed)
//   notifications.user_id   → users ON DELETE CASCADE
//   attachment_chunks       → attachments ON DELETE CASCADE
//   attachments.created_by  → users(id) — NO ON DELETE action (the one FK gap).
//     Intake only ever attaches images to the uploader's own posts, so the
//     post cascade removes every attachment they created inside the user
//     DELETE itself — but "no action" is still checked immediately when a row
//     references the deleted user, so the handler deletes those rows
//     explicitly FIRST (their chunks cascade via attachments) instead of
//     gambling on a FOREIGN KEY constraint failed 500.
// The explicit child deletes below also fix the order the spec asks for:
// everything the account owns is removed, then the user row ends the batch so
// the remaining SET NULL actions (bans the user created, reports they
// resolved) rewrite those actor columns without the row present.
export function accountDeletionStatements(db, userId, { archiveReason, deletedAt, deletedByUserId = userId, deletedByName = null } = {}) {
  // Accountability archive (v2.4.1): everything that will vanish goes to
  // post_archive FIRST, in the same atomic batch — the account's own posts
  // plus every child and grandchild row (other members' replies inside the
  // account's threads and sub-replies off the account's replies) that the
  // CASCADE will take with it.
  const archiveStatements = archiveReason
    ? [archivePostRowsStatement(
        db,
        "p.author_id = ? " +
        "OR p.parent_id IN (SELECT id FROM posts WHERE author_id = ?) " +
        "OR p.parent_id IN (SELECT id FROM posts WHERE parent_id IN (SELECT id FROM posts WHERE author_id = ?))",
        [userId, userId, userId],
        archiveReason,
        deletedAt,
        deletedByUserId,
        deletedByName,
      )]
    : [];
  return [
    ...archiveStatements,
    db.prepare("DELETE FROM attachments WHERE created_by = ?").bind(userId),
    db.prepare("DELETE FROM notifications WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM reactions WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM reports WHERE reporter_id = ?").bind(userId),
    // IP bans (v3.1): banned_ips has no FK, so the bans delete below cannot
    // cascade it — without this the network rows would strand and keep
    // refusing sign-ins forever (unban/appeal both need a live ban row).
    // Runs before the bans delete so the subquery can still find the ids.
    db.prepare(
      "DELETE FROM banned_ips WHERE ban_id IN (SELECT id FROM bans WHERE user_id = ?)",
    ).bind(userId),
    db.prepare("DELETE FROM known_ips WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM bans WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ];
}

async function handleAccountDeleteRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me/delete" && method === "POST") {
    const session = await requireUser(request, env);
    await rateLimit(request, env, "write");
    const userId = Number(session.user.id);
    // One atomic batch: if any statement fails the whole deletion rolls back
    // (D1 batches are transactional), so a partial wipe is impossible. The
    // final user DELETE must change exactly one row — 0 means the account
    // vanished between the session read and the write.
    const results = await db.batch(accountDeletionStatements(
      db, userId, { archiveReason: "account-delete", deletedAt: nowSeconds(), deletedByUserId: userId, deletedByName: session.user.username },
    ));
    if (Number(results[results.length - 1]?.meta?.changes) !== 1) {
      throw new HttpError(404, "Account not found.");
    }
    return json({ deleted: true });
  }
  return null;
}

async function handleProfileRoutes(request, env, url, path, method, ctx) {
  const handlers = [
    handleAvatarReadRoute,
    handleUserProfileRoute,
    handleProfileUpdateRoute,
    handleCssSetRoute,
    handleCssClearRoute,
    handleProfileReportRoute,
    handleProfileReportAdminRoute,
    handleAvatarUploadRoute,
    handleCssStylesheetRoute,
    handleCssAdminRoutes,
    handlePasswordChangeRoute,
    handleAccountDeleteRoute,
  ];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}

export { handleProfileRoutes };
