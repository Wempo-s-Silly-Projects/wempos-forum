// TOTP two-factor sign-in (v4.0.1): setup/confirm/disable on the member's
// own hand, plus the login-step verification. 2FA ONLY per the feature spec
// — no recovery codes, no email fallback. Secrets live in users (staged in
// totp_pending_secret until a real code proves possession); the login step's
// short-lived challenge tokens are stored as SHA-256 hashes in
// totp_challenges, single-use — claimed with a conditional DELETE before the
// code check, so a challenge can never verify twice under any retry.
import { requireCsrf, requireUser, assertNetworkNotBanned, createSession } from "./core/auth.mjs";
import { nowSeconds, randomToken, sha256Hex } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { publicUser, userByUsernameKey } from "./core/shapers.mjs";
import { generateTotpSecret, otpauthUri, verifyTotpCode } from "./core/totp.mjs";

const CHALLENGE_TTL_SECONDS = 5 * 60;

// Codes are the one thing here that can be brute-forced, so every
// verification path rides the dedicated TOTP limiter: keyed per account for
// setup/confirm/disable, and per account for the login step too (via the
// challenge's owner after the claim; a per-IP pass bounds spray).
async function totpLimiter(request, env, actor) {
  await rateLimit(request, env, "totp", actor);
}

function isSixDigitCode(value) {
  return typeof value === "string" && /^\d{6}$/.test(value.trim());
}

async function handleTotpRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;

  // Stage a fresh secret. Re-running setup replaces the staged secret — a
  // stale draft can never be confirmed into 2FA without a fresh code.
  if (path === "/api/me/totp/setup" && method === "POST") {
    const session = await requireUser(request, env);
    await totpLimiter(request, env, "user:" + session.user.id);
    const row = await db.prepare(
      "SELECT totp_enabled, totp_secret FROM users WHERE id = ? LIMIT 1",
    ).bind(session.user.id).first();
    if (!row) throw new HttpError(404, "Your account could not be found.");
    if (Number(row.totp_enabled) === 1 && row.totp_secret) {
      throw new HttpError(409, "Two-factor authentication is already on. Turn it off first.");
    }
    const secret = generateTotpSecret();
    await db.prepare("UPDATE users SET totp_pending_secret = ? WHERE id = ?")
      .bind(secret, session.user.id).run();
    return json({
      secret,
      otpauth: otpauthUri(secret, "Wempo's Forum", session.user.username),
    });
  }

  // Prove possession: the staged secret becomes the live one only after a
  // current ±1-step code verifies against it.
  if (path === "/api/me/totp/confirm" && method === "POST") {
    const session = await requireUser(request, env);
    await totpLimiter(request, env, "user:" + session.user.id);
    const body = await readJson(request);
    const code = isSixDigitCode(body.code) ? body.code.trim() : null;
    if (!code) throw new HttpError(400, "Enter the 6-digit code from your authenticator app.");
    const row = await db.prepare(
      "SELECT totp_pending_secret FROM users WHERE id = ? AND totp_pending_secret IS NOT NULL LIMIT 1",
    ).bind(session.user.id).first();
    if (!row) throw new HttpError(400, "Start the two-factor setup first — there is no pending secret.");
    if (!(await verifyTotpCode(row.totp_pending_secret, code, nowSeconds()))) {
      throw new HttpError(401, "That code is not correct. Nothing has been changed.");
    }
    const result = await db.prepare(
      "UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = 1 " +
        "WHERE id = ? AND totp_enabled = 0 AND totp_pending_secret IS NOT NULL",
    ).bind(session.user.id).run();
    if (Number(result.meta?.changes) !== 1) {
      throw new HttpError(409, "Two-factor setup has already completed in another tab.");
    }
    return json({ totpEnabled: true });
  }

  // Turning 2FA OFF demands a current code from the live secret — whoever
  // holds the secret is the only one who can switch it off.
  if (path === "/api/me/totp/disable" && method === "POST") {
    const session = await requireUser(request, env);
    await totpLimiter(request, env, "user:" + session.user.id);
    const body = await readJson(request);
    const code = isSixDigitCode(body.code) ? body.code.trim() : null;
    if (!code) throw new HttpError(400, "Enter the 6-digit code from your authenticator app.");
    const row = await db.prepare(
      "SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = 1 AND totp_secret IS NOT NULL LIMIT 1",
    ).bind(session.user.id).first();
    if (!row) throw new HttpError(409, "Two-factor authentication is not on.");
    if (!(await verifyTotpCode(row.totp_secret, code, nowSeconds()))) {
      throw new HttpError(401, "That code is not correct. Nothing has been changed.");
    }
    await db.prepare(
      "UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = 0 WHERE id = ?",
    ).bind(session.user.id).run();
    return json({ totpEnabled: false });
  }

  // The login step. The challenge was minted by the login route only after a
  // VERIFIED password (never sent before credentials pass, so this endpoint
  // carries no credential oracle). A consumed or expired challenge 401s.
  if (path === "/api/auth/totp" && method === "POST") {
    const guest = await requireCsrf(request, env);
    await assertNetworkNotBanned(request, env);
    // Per-IP: a constant actor here would collapse every visitor into ONE
    // 10/min bucket (any guest session + CSRF is enough to reach this
    // endpoint), letting 11 requests/min lock every 2FA member out of
    // sign-in. Brute force per account is bounded by the user-keyed pass
    // after the challenge lookup.
    await totpLimiter(request, env, "");
    const body = await readJson(request);
    const token = typeof body.challenge === "string" ? body.challenge : "";
    const code = isSixDigitCode(body.code) ? body.code.trim() : null;
    if (!token || token.length > 128 || !code) {
      throw new HttpError(400, "Enter the 6-digit code from your authenticator app.");
    }
    await db.prepare("DELETE FROM totp_challenges WHERE expires_at <= ?").bind(nowSeconds()).run();
    const challenge = await db.prepare(
      "SELECT user_id FROM totp_challenges WHERE token_hash = ? AND expires_at > ? LIMIT 1",
    ).bind(await sha256Hex(token), nowSeconds()).first();
    if (!challenge) {
      throw new HttpError(401, "This verification request has expired. Sign in again.");
    }
    const userId = Number(challenge.user_id);
    await totpLimiter(request, env, "user:" + userId);
    // Direct select: the check needs exactly the 2FA columns (the shared
    // shapers projection does not carry them), then the full login-shaped
    // row by username_key only to render the same publicUser payload the
    // password-first login returns.
    const keyRow = await db.prepare(
      "SELECT username_key, totp_enabled, totp_secret FROM users WHERE id = ? LIMIT 1",
    ).bind(userId).first();
    if (!keyRow || Number(keyRow.totp_enabled) !== 1 || !keyRow.totp_secret) {
      throw new HttpError(401, "This verification request has expired. Sign in again.");
    }
    const user = await userByUsernameKey(env, keyRow.username_key);
    if (!user) {
      throw new HttpError(401, "This verification request has expired. Sign in again.");
    }
    if (!(await verifyTotpCode(keyRow.totp_secret, code, nowSeconds()))) {
      throw new HttpError(401, "That code is not correct.");
    }
    // Consume at the LAST step, gated on the delete's own changes count: a
    // concurrent retry on the same challenge can pass the earlier reads but
    // its delete matches zero rows, so exactly one request ever mints the
    // session (verified live: a replay attempt after a successful one 401s).
    const consumed = await db.prepare(
      "DELETE FROM totp_challenges WHERE token_hash = ? AND expires_at > ?",
    ).bind(await sha256Hex(token), nowSeconds()).run();
    if (Number(consumed.meta?.changes) !== 1) {
      throw new HttpError(401, "This verification request has expired. Sign in again.");
    }
    // createSession's requireUnbanned insert re-checks an active ban, so a
    // ban landing between password and code still can't mint a session.
    // The guest session's hash rotates the same pre-login bucket the
    // password-first login deletes (never leaving it orphaned for 30 days).
    const session = await createSession(request, env, userId, guest.tokenHash, true);
    if (!session) throw new HttpError(403, "This account is currently banned.");
    return json(
      { user: publicUser(user), csrfToken: session.csrfToken },
      200,
      { "Set-Cookie": session.setCookie },
    );
  }

  return null;
}

// Minted by the login route (session.mjs) after its password and ban checks:
// the plaintext token rides the login response, only its SHA-256 is stored.
export async function issueTotpChallenge(db, userId) {
  const token = randomToken(24);
  const now = nowSeconds();
  await db.prepare(
    "INSERT INTO totp_challenges (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(await sha256Hex(token), userId, now, now + CHALLENGE_TTL_SECONDS).run();
  return token;
}

export { handleTotpRoutes };
