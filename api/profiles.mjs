// "Me" routes (bio, avatar upload, password change), the user profile page,
// and avatar serving (GET /api/avatars/:id, reader moved into api/shared.mjs).
import {
  assertNotBanned,
  createAvatarVersion,
  handleAvatarReadRoute,
  hashPassword,
  HttpError,
  isValidPassword,
  json,
  nowSeconds,
  rateLimit,
  readJson,
  readLimitedBody,
  readSession,
  requireMutationApplied,
  requireUser,
  SOCIAL_PLATFORMS,
  socialsFromRow,
  sniffImageMime,
  userByUsernameKey,
  verifyPassword,
} from "./shared.mjs";
import { listRootPosts } from "./posts.mjs";

const MAX_AVATAR_BYTES = 1024 * 1024;
const MAX_AVATAR_REQUEST_BYTES = MAX_AVATAR_BYTES + 64 * 1024;
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
    const session = await readSession(request, env);
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
      role: user.role,
      bio: user.bio || "",
      socials: socialsFromRow(user),
      polytoriaUsername: user.polytoria_username || null,
      avatarUrl: user.avatar_mime ? "/api/avatars/" + user.id + "?v=" + user.avatar_version : null,
      posts: posts.posts,
      postsNextBefore: posts.nextBefore,
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
    if (!hasBio && !hasSocials) {
      throw new HttpError(400, "Provide a bio or socials value to update.");
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
        socials[key] = value;
      }
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
    if (assignments.length === 0) {
      throw new HttpError(400, "Provide a bio or socials value to update.");
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
    return json(response);
  }
  return null;
}

async function handleAvatarUploadRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/me/avatar" && method === "POST") {
    const session = await requireUser(request, env);
    await assertNotBanned(env, session.user.id);
    await rateLimit(request, env, "avatar-upload", String(session.user.id));
    const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.startsWith("multipart/form-data;")) {
      throw new HttpError(415, "Upload a JPEG, PNG, or WebP image.");
    }
    const bufferedBody = await readLimitedBody(request, MAX_AVATAR_REQUEST_BYTES);
    let form;
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: bufferedBody,
      }).formData();
    } catch {
      throw new HttpError(400, "The image upload could not be read.");
    }
    const file = form.get("avatar");
    if (!(file instanceof File) || file.size < 1) throw new HttpError(400, "Choose an image to upload.");
    if (file.size > MAX_AVATAR_BYTES) throw new HttpError(413, "Profile pictures must be 1 MiB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);
    if (!mime) throw new HttpError(415, "Only JPEG, PNG, and WebP images are supported.");
    const updatedAt = nowSeconds();
    const avatarVersion = createAvatarVersion();
    // Uploads always land in the pending mirror set: any previously approved
    // avatar keeps serving publicly until a moderator approves this upload.
    // Re-uploading while pending replaces the pending bytes in place. The
    // schema CHECKs keep avatar_status='pending' and the pending set all-or-
    // nothing within this single statement's write.
    const result = await db.prepare(
      "UPDATE users SET pending_avatar_mime = ?, pending_avatar_data = ?, " +
        "pending_avatar_updated_at = ?, pending_avatar_version = ?, avatar_status = 'pending' " +
        "WHERE id = ? AND NOT EXISTS (" +
        "SELECT 1 FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?))",
    ).bind(mime, bytes, updatedAt, avatarVersion, session.user.id, session.user.id, nowSeconds()).run();
    requireMutationApplied(result);
    return json({
      avatarUrl: "/api/avatars/" + session.user.id + "?v=" + avatarVersion,
      avatarStatus: "pending",
    });
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

async function handleProfileRoutes(request, env, url, path, method) {
  const handlers = [
    handleAvatarReadRoute,
    handleUserProfileRoute,
    handleProfileUpdateRoute,
    handleAvatarUploadRoute,
    handlePasswordChangeRoute,
  ];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }
  return null;
}

export { handleProfileRoutes };
