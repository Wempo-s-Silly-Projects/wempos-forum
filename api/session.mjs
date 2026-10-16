// Session, credentials, and first-admin setup routes. The avatar GET reader
// moved to api/shared.mjs (registered on the profiles group in task 7).
import { unreadCount } from "./notifications.mjs";
import { applyWordFilter } from "./filter.mjs";
import {
  createSession,
  equalConstantTime,
  hashPassword,
  HttpError,
  isValidPassword,
  isValidPasswordPepper,
  isValidSetupSecret,
  isValidUsername,
  json,
  nowSeconds,
  publicUser,
  rateLimit,
  readJson,
  readSession,
  requireCsrf,
  requireTurnstile,
  requireUser,
  securityHeaders,
  sha256Hex,
  userByUsernameKey,
  verifyPassword,
} from "./shared.mjs";

const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

async function setupRequired(env) {
  const row = await env.FORUM_DB.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first();
  return !row;
}

async function storeUser(env, credentials, role = "member") {
  const password = await hashPassword(credentials.password, env.PASSWORD_PEPPER);
  const now = nowSeconds();
  try {
    const result = await env.FORUM_DB.prepare(
      "INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) " +
        "VALUES (?, ?, ?, ?, ?, '', ?)",
    ).bind(credentials.username, credentials.usernameKey, password.salt, password.hash, role, now).run();
    return await env.FORUM_DB.prepare(
      "SELECT id, username, username_key, password_salt, password_hash, role, bio, " +
        "social_youtube, social_x, social_reddit, social_github, social_discord, " +
        "social_gitlab, social_instagram, social_tiktok, social_twitch, polytoria_username, " +
        "avatar_status, avatar_mime, avatar_updated_at, avatar_version " +
        "FROM users WHERE id = ? LIMIT 1",
    ).bind(Number(result.meta.last_row_id)).first();
  } catch (error) {
    const existing = await userByUsernameKey(env, credentials.usernameKey);
    if (existing) throw new HttpError(409, "That username is already taken.");
    throw error;
  }
}

function validateNewCredentials(body) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!isValidUsername(username)) {
    throw new HttpError(400, "Username must be 3–24 characters and use only letters, numbers, and underscores.");
  }
  if (!isValidPassword(body.password)) {
    throw new HttpError(400, "Password must be 12–128 characters long.");
  }
  return { username, usernameKey: username.toLowerCase(), password: body.password };
}

function expiredCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return "wempo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secure;
}

async function handleSessionRoute(request, env, url, path, method) {
  if (path === "/api/session" && method === "GET") {
    const existing = await readSession(request, env);
    if (existing) {
      // Guest-shaped sessions carry no user and must not report a count.
      if (!existing.user) return json({ user: existing.user, csrfToken: existing.csrfToken });
      return json({
        user: existing.user,
        csrfToken: existing.csrfToken,
        unreadNotifications: await unreadCount(env, existing.user.id),
      });
    }
    await rateLimit(request, env, "guest-session");
    const created = await createSession(request, env);
    return json({ user: null, csrfToken: created.csrfToken }, 200, { "Set-Cookie": created.setCookie });
  }
  return null;
}

async function handleSetupStatusRoute(request, env, url, path, method) {
  if (path === "/api/setup/status" && method === "GET") {
    return json({
      required: await setupRequired(env),
      secretConfigured: isValidSetupSecret(env.SETUP_SECRET),
      passwordSecurityConfigured: isValidPasswordPepper(env.PASSWORD_PEPPER),
    });
  }
  return null;
}

async function handleFirstAdminSetupRoute(request, env, url, path, method) {
  if (path === "/api/setup" && method === "POST") {
    const guest = await requireCsrf(request, env);
    await rateLimit(request, env, "setup");
    if (!(await setupRequired(env))) throw new HttpError(409, "First-time setup has already been completed.");
    if (!isValidSetupSecret(env.SETUP_SECRET)) {
      throw new HttpError(503, "First-time setup is locked. Configure SETUP_SECRET using Wrangler before creating the administrator.");
    }
    const body = await readJson(request);
    const credentials = validateNewCredentials(body);
    const suppliedKey = typeof body.setupKey === "string" ? body.setupKey : "";
    const expectedKeyHash = await sha256Hex(env.SETUP_SECRET);
    const suppliedKeyHash = await sha256Hex(suppliedKey);
    if (!equalConstantTime(suppliedKeyHash, expectedKeyHash)) {
      throw new HttpError(403, "The setup secret is not correct.");
    }
    let user;
    try {
      user = await storeUser(env, credentials, "admin");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (!(await setupRequired(env))) {
        throw new HttpError(409, "First-time setup has already been completed.");
      }
      throw error;
    }
    const session = await createSession(request, env, Number(user.id), guest.tokenHash);
    return json({ user: publicUser(user), csrfToken: session.csrfToken }, 201, { "Set-Cookie": session.setCookie });
  }
  return null;
}

async function handleRegistrationRoute(request, env, url, path, method) {
  if (path === "/api/auth/register" && method === "POST") {
    const guest = await requireCsrf(request, env);
    await rateLimit(request, env, "register");
    const body = await readJson(request);
    await requireTurnstile(request, env, body, "signup");
    const credentials = validateNewCredentials(body);
    // Usernames must survive the word filter untouched: unlike bios (and post
    // bodies), a username is never worth masking, so ANY alteration (masking,
    // removal, case-insensitive match) rejects registration with a generic
    // message that never hints at the private word list. An unset or empty
    // FILTERED_WORDS secret is a strict no-op here, exactly like the posts flow.
    if (applyWordFilter(credentials.username, env.FILTERED_WORDS) !== credentials.username) {
      throw new HttpError(400, "That username isn't allowed.");
    }
    const user = await storeUser(env, credentials, "member");
    const session = await createSession(request, env, Number(user.id), guest.tokenHash, true);
    if (!session) throw new HttpError(403, "This account is currently banned.");
    return json({ user: publicUser(user), csrfToken: session.csrfToken }, 201, { "Set-Cookie": session.setCookie });
  }
  return null;
}

async function handleLoginRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/auth/login" && method === "POST") {
    const guest = await requireCsrf(request, env);
    await rateLimit(request, env, "login");
    const body = await readJson(request);
    await requireTurnstile(request, env, body, "login");
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!isValidUsername(username) || password.length < 1 || password.length > 128) {
      throw new HttpError(400, "Enter your username and password.");
    }
    await rateLimit(request, env, "login", "account:" + username.toLowerCase());
    const user = await userByUsernameKey(env, username.toLowerCase());
    const valid = await verifyPassword(
      password,
      user ? user.password_salt : DUMMY_SALT,
      user ? user.password_hash : DUMMY_HASH,
      env.PASSWORD_PEPPER,
    );
    if (!user || !valid) throw new HttpError(401, "The username or password is incorrect.");
    // The ban screen payload is only readable with verified credentials; the
    // generic 401 above already answered invalid ones without touching this row.
    const bannedMessage = "This account is currently banned.";
    const activeBan = await db.prepare(
      "SELECT reason, expires_at FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
    ).bind(Number(user.id), nowSeconds()).first();
    if (activeBan) {
      throw new HttpError(403, bannedMessage, {}, {
        error: bannedMessage,
        banned: true,
        reason: activeBan.reason,
        expiresAt: activeBan.expires_at === null || activeBan.expires_at === undefined
          ? null
          : Number(activeBan.expires_at),
      });
    }
    const session = await createSession(request, env, Number(user.id), guest.tokenHash, true);
    if (!session) throw new HttpError(403, "This account is currently banned.");
    return json({ user: publicUser(user), csrfToken: session.csrfToken }, 200, { "Set-Cookie": session.setCookie });
  }
  return null;
}

async function handleLogoutRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/auth/logout" && method === "POST") {
    const session = await requireUser(request, env);
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.tokenHash).run();
    return new Response(null, {
      status: 204,
      headers: securityHeaders(new Headers({ "Cache-Control": "no-store", "Set-Cookie": expiredCookie(request) })),
    });
  }
  return null;
}

// The footer version stamp. Both values come from the deployment itself
// (wrangler [vars] and the deploy script's --var), never from user input, so
// they are echoed back verbatim; unset vars fall back to empty strings and
// the frontend renders the corresponding part as nothing.
async function handleVersionRoute(request, env, url, path, method) {
  if (path === "/api/version" && method === "GET") {
    return json({
      version: typeof env.VERSION === "string" ? env.VERSION : "",
      commit: typeof env.COMMIT_SHA === "string" ? env.COMMIT_SHA : "",
    });
  }
  return null;
}

async function handleAuthRoutes(request, env, url, path, method) {
  const handlers = [handleSessionRoute, handleSetupStatusRoute, handleVersionRoute, handleFirstAdminSetupRoute, handleRegistrationRoute, handleLoginRoute, handleLogoutRoute];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method);
    if (response) return response;
  }
  return null;
}

export { handleAuthRoutes };