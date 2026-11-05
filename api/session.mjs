// Session, credentials, and first-owner setup routes. (The avatar GET reader
// moved out with the avatar lifecycle in plan 3 — it registers on the
// profiles group from api/avatars.mjs.)
import { unreadCount } from "./notifications.mjs";
import { applyWordFilter, containsFilteredWord, normalizeUsernameForFilter } from "./filter.mjs";
import { createSession, assertNetworkNotBanned, readSession, requireCsrf, requireUser } from "./core/auth.mjs";
import { equalConstantTime, nowSeconds, sha256Hex } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requireTurnstile, securityHeaders } from "./core/http.mjs";
import { hashPassword, isValidPassword, isValidPasswordPepper, isValidSetupSecret, verifyPassword } from "./core/passwords.mjs";
import { ROLE_ADMIN_DB, ROLE_OWNER_DB } from "./core/roles.mjs";
import { isValidUsername, publicUser, userByUsernameKey } from "./core/shapers.mjs";
import { issueTotpChallenge } from "./twofa.mjs";

const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

async function setupRequired(env) {
  // Stored vocabulary (v3.1): ROLE_OWNER_DB is the pre-rename 'admin'.
  const row = await env.FORUM_DB.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first();
  return !row;
}

async function storeUser(env, credentials, role = "member") {
  // role arrives in the PUBLIC vocabulary; users.role stores the frozen
  // pre-rename values, so translate on the way in (v3.1 rename).
  const storedRole = role === "owner" ? ROLE_OWNER_DB : role === "admin" ? ROLE_ADMIN_DB : role;
  const password = await hashPassword(credentials.password, env.PASSWORD_PEPPER);
  const now = nowSeconds();
  try {
    // First-owner setup is a one-time privilege boundary. Keep the "no owner
    // exists" check inside the INSERT itself so two concurrent setup requests
    // cannot both pass setupRequired() and create separate owners. The SQL
    // literal is the STORED owner value ('admin'), not the public 'owner'.
    const insert = role === "owner"
      ? env.FORUM_DB.prepare(
        "INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) " +
          "SELECT ?, ?, ?, ?, ?, '', ? WHERE NOT EXISTS " +
          "(SELECT 1 FROM users WHERE role = 'admin')",
      ).bind(credentials.username, credentials.usernameKey, password.salt, password.hash, storedRole, now)
      : env.FORUM_DB.prepare(
        "INSERT INTO users (username, username_key, password_salt, password_hash, role, bio, created_at) " +
          "VALUES (?, ?, ?, ?, ?, '', ?)",
      ).bind(credentials.username, credentials.usernameKey, password.salt, password.hash, storedRole, now);
    const result = await insert.run();
    if (role === "owner" && Number(result.meta?.changes) !== 1) {
      throw new HttpError(409, "First-time setup has already been completed.");
    }
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
      throw new HttpError(503, "First-time setup is locked. Configure SETUP_SECRET using Wrangler before creating the owner account.");
    }
    const body = await readJson(request);
    const credentials = validateNewCredentials(body);
    // The filter covers EVERYTHING — the first owner's username runs the same
    // identity check as registration (masked form intact + normalized form
    // clean), so the setup path can't mint a filtered-word owner name.
    if (applyWordFilter(credentials.username, env.FILTERED_WORDS) !== credentials.username ||
        containsFilteredWord(normalizeUsernameForFilter(credentials.username), env.FILTERED_WORDS)) {
      throw new HttpError(400, "That username isn't allowed.");
    }
    const suppliedKey = typeof body.setupKey === "string" ? body.setupKey : "";
    const expectedKeyHash = await sha256Hex(env.SETUP_SECRET);
    const suppliedKeyHash = await sha256Hex(suppliedKey);
    if (!equalConstantTime(suppliedKeyHash, expectedKeyHash)) {
      throw new HttpError(403, "The setup secret is not correct.");
    }
    let user;
    try {
      user = await storeUser(env, credentials, "owner");
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
    // IP bans (v3.1): no new accounts from a banned network — before any
    // credential work, so the response carries no oracle.
    await assertNetworkNotBanned(request, env);
    const body = await readJson(request);
    await requireTurnstile(request, env, body, "signup");
    const credentials = validateNewCredentials(body);
    // Usernames must survive the word filter untouched: unlike bios (and post
    // bodies), a username is never worth masking, so ANY alteration (masking,
    // removal, case-insensitive match) rejects registration with a generic
    // message that never hints at the private word list. An unset or empty
    // FILTERED_WORDS secret is a strict no-op here, exactly like the posts flow.
    // The whole-word check plus the collapsed/leet-normalized substring
    // check: "p_e_n_i_s" and "pen1s" don't survive either (v2.5 fix).
    if (applyWordFilter(credentials.username, env.FILTERED_WORDS) !== credentials.username ||
        containsFilteredWord(normalizeUsernameForFilter(credentials.username), env.FILTERED_WORDS)) {
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
  // IP bans (v3.1): sign-in from a banned network is refused up front, before
  // any password work (no oracle, no PBKDF2 burn).
  if (path === "/api/auth/login" && method === "POST") {
    await assertNetworkNotBanned(request, env);
  }
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
    // Two-factor (v4.0.1) sits between the password check and the session
    // mint: members with 2FA on get a short-lived single-use challenge
    // instead (the plaintext rides this response, only its SHA-256 is
    // stored) and no cookie is set — POST /api/auth/totp finishes sign-in.
    const hasTotp = await db.prepare(
      "SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = 1 AND totp_secret IS NOT NULL LIMIT 1",
    ).bind(Number(user.id)).first();
    if (hasTotp) {
      // The challenge is minted before the ban branch of the totp route's
      // session step; an account that lands a ban after this point simply
      // can't convert the challenge into a session (requireUnbanned).
      const challenge = await issueTotpChallenge(db, Number(user.id));
      return json({ totpRequired: true, challenge }, 200);
    }
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
