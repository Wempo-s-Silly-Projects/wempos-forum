// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// TOTP two-factor sign-in (v4.0.1, backup codes v4.8.1): setup/confirm/
// disable on the member's own hand, plus the login-step verification.
// 2FA only — no email fallback; the recovery path is the single-use backup
// codes (migrations 0042's totp_backup_codes), verified by the ONE shared
// code-or-backup helper every confirm-with-MFA gate rides. Secrets live in
// users (staged in totp_pending_secret until a real code proves possession);
// the login step's short-lived challenge tokens are stored as SHA-256 hashes
// in totp_challenges, single-use — claimed with a conditional DELETE before
// the code check, so a challenge can never verify twice under any retry.
// v5.20.0: the HMAC algorithm is per member (totp_algorithms, migration
// 0061) — SHA1 by default and for every member without a row, SHA256 only
// when chosen at setup; every verify below reads it with the secret.
import { requireCsrf, requireUser, assertNetworkNotBanned, createSession } from "./core/auth.mjs";
import { nowSeconds, randomToken, sha256Hex } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { verifyPassword } from "./core/passwords.mjs";
import { publicUser, userByUsernameKey } from "./core/shapers.mjs";
import { generateTotpSecret, normalizeTotpAlgorithm, otpauthUri, totpMatchStep, verifyTotpCode } from "./core/totp.mjs";
import { siteName } from "./branding.mjs";

// Backup codes (v4.8.1): the Discord-style single-use sign-in codes used
// INSTEAD of the authenticator code when the app is lost or renamed. Since
// Batch F a new code is human-readable base32 ("K7QXM-2RTZA", mintBackupCode
// below); sets minted before it (8 base64url chars) keep verifying until
// regenerated. Only the SHA-256 hash of a code is stored in
// totp_backup_codes (same rule as totp_challenges); the raw list rides the
// generation response exactly once and is never shown again.
const CHALLENGE_TTL_SECONDS = 5 * 60;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_PATTERN = /^[A-Za-z0-9_-]{8}$/;

// One answer shape for every code prompt: a 6-digit input rides the TOTP path,
// an 8-char base64url input rides the backup burn, anything else is simply
// wrong. Trimmed here so a stray space can't fail an honest paste.
function codeAnswer(value) {
  return typeof value === "string" && value.length <= 128 ? value.trim() : "";
}

// The single verify helper every confirm-with-MFA path rides (the login step,
// turning 2FA off, generating a new backup set): a TOTP code verifies against
// the live secret; a backup code burns in ONE guarded statement — DELETE ...
// AND used_at IS NULL — and 1 changed row is the only accept. Each shape's
// failure is the same boolean false, so a wrong code can never reveal which
// family a real code would have belonged to.
async function verifyCodeAnswer(db, userId, secret, code, algorithm) {
  if (isSixDigitCode(code)) {
    const step = await totpMatchStep(secret, code, nowSeconds(), normalizeTotpAlgorithm(algorithm));
    return step !== null && claimTotpStep(db, userId, step);
  }
  // Legacy 8-char base64url codes are matched raw (they are case-sensitive
  // and may contain "-"); the Batch F recovery codes are matched in their
  // normalized form, so "abcde fghij" and "ABCDE-FGHIJ" are the same code.
  const backup = BACKUP_CODE_PATTERN.test(code) ? code : normalizeBackupCode(code);
  if (backup) {
    const burned = await db.prepare(
      "DELETE FROM totp_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
    ).bind(userId, await sha256Hex(backup)).run();
    return Number(burned.meta?.changes) === 1;
  }
  return false;
}

// Batch F replay refusal: a TOTP step is spendable once per member. ONE
// conditional upsert claims it — the row moves only to a STRICTLY newer step,
// so a replayed code (same step) or an older in-window code matches zero rows.
// Confirm (the pending secret) never claims: the first live-secret use does.
async function claimTotpStep(db, userId, step) {
  const claimed = await db.prepare(
    "INSERT INTO totp_used_steps (user_id, last_step) VALUES (?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET last_step = excluded.last_step " +
      "WHERE excluded.last_step > totp_used_steps.last_step",
  ).bind(userId, step).run();
  return Number(claimed.meta?.changes) === 1;
}

// Batch F recovery codes: 10 base32 characters shown as two groups of five
// ("K7QXM-2RTZA"), 50 bits each. Input is forgiving — case, spaces and the
// hyphen are ignored — and the normalized form is what gets hashed.
export function normalizeBackupCode(value) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z2-7]{10}$/.test(compact) ? compact : null;
}

function mintBackupCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  // 32 symbols divide 256 evenly, so byte & 31 is unbiased.
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => alphabet[byte & 31]);
  return chars.slice(0, 5).join("") + "-" + chars.slice(5).join("");
}

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
  // stale draft can never be confirmed into 2FA without a fresh code. The
  // session's CURRENT password re-proofs the member first (review finding —
  // a hijacked tab should not be able to arm a 2FA takeover): same
  // verifyPassword path as the login flow, rejected before any secret work.
  if (path === "/api/me/totp/setup" && method === "POST") {
    const session = await requireUser(request, env);
    await totpLimiter(request, env, "user:" + session.user.id);
    const body = await readJson(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (currentPassword.length < 1 || currentPassword.length > 128) {
      throw new HttpError(400, "Enter your current password to start two-factor setup.");
    }
    const row = await db.prepare(
      "SELECT totp_enabled, totp_secret, password_salt, password_hash FROM users WHERE id = ? LIMIT 1",
    ).bind(session.user.id).first();
    if (!row) throw new HttpError(404, "Your account could not be found.");
    if (!(await verifyPassword(currentPassword, row.password_salt, row.password_hash, env.PASSWORD_PEPPER))) {
      throw new HttpError(401, "Your current password is incorrect.");
    }
    if (Number(row.totp_enabled) === 1 && row.totp_secret) {
      throw new HttpError(409, "Two-factor authentication is already on. Turn it off first.");
    }
    // The algorithm rides the staged secret in ONE batch, and its upsert is
    // gated on totp_enabled = 0 — a live enrollment's algorithm can never be
    // rewritten by a setup racing a confirm in another tab.
    const algorithm = normalizeTotpAlgorithm(body.algorithm);
    const secret = generateTotpSecret();
    await db.batch([
      db.prepare("UPDATE users SET totp_pending_secret = ? WHERE id = ?").bind(secret, session.user.id),
      db.prepare(
        "INSERT INTO totp_algorithms (user_id, algorithm, created_at) " +
          "SELECT id, ?, ? FROM users WHERE id = ? AND totp_enabled = 0 " +
          "ON CONFLICT(user_id) DO UPDATE SET algorithm = excluded.algorithm, created_at = excluded.created_at",
      ).bind(algorithm, nowSeconds(), session.user.id),
    ]);
    return json({
      secret,
      otpauth: otpauthUri(secret, await siteName(env), session.user.username, algorithm),
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
      "SELECT u.totp_pending_secret, a.algorithm FROM users u " +
        "LEFT JOIN totp_algorithms a ON a.user_id = u.id " +
        "WHERE u.id = ? AND u.totp_pending_secret IS NOT NULL LIMIT 1",
    ).bind(session.user.id).first();
    if (!row) throw new HttpError(400, "Start the two-factor setup first — there is no pending secret.");
    const algorithm = normalizeTotpAlgorithm(row.algorithm);
    if (!(await verifyTotpCode(row.totp_pending_secret, code, nowSeconds(), algorithm))) {
      throw new HttpError(401, "That code is not correct. Nothing has been changed.");
    }
    // Promote only the secret the code was verified against: a setup re-run
    // in another tab (new secret + algorithm, one batch) makes this match 0.
    const result = await db.prepare(
      "UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = 1 " +
        "WHERE id = ? AND totp_enabled = 0 AND totp_pending_secret = ?",
    ).bind(session.user.id, row.totp_pending_secret).run();
    if (Number(result.meta?.changes) !== 1) {
      throw new HttpError(409, "Two-factor setup has already completed in another tab.");
    }
    return json({ totpEnabled: true });
  }

  // Turning 2FA OFF demands a current code from the live secret — whoever
  // holds the secret is the only one who can switch it off. The code prompt
  // accepts the authenticator's 6-digit code OR an unburned backup code (the
  // lost-authenticator flow: sign in with one backup code, remove the
  // authenticator with another). The disable and the backup-code wipe ride
  // ONE batch — switching the second factor off never leaves stale codes
  // behind to outlive the secret they belong to.
  if (path === "/api/me/totp/disable" && method === "POST") {
    const session = await requireUser(request, env);
    await totpLimiter(request, env, "user:" + session.user.id);
    const body = await readJson(request);
    const code = codeAnswer(body.code);
    if (!code) {
      throw new HttpError(400, "Enter the 6-digit code from your authenticator app, or a backup code.");
    }
    const row = await db.prepare(
      "SELECT u.totp_secret, a.algorithm FROM users u LEFT JOIN totp_algorithms a ON a.user_id = u.id " +
        "WHERE u.id = ? AND u.totp_enabled = 1 AND u.totp_secret IS NOT NULL LIMIT 1",
    ).bind(session.user.id).first();
    if (!row) throw new HttpError(409, "Two-factor authentication is not on.");
    if (!(await verifyCodeAnswer(db, session.user.id, row.totp_secret, code, row.algorithm))) {
      throw new HttpError(401, "That code is not correct. Nothing has been changed.");
    }
    await db.batch([
      db.prepare(
        "UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = 0 WHERE id = ?",
      ).bind(session.user.id),
      db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").bind(session.user.id),
      db.prepare("DELETE FROM totp_algorithms WHERE user_id = ?").bind(session.user.id),
    ]);
    return json({ totpEnabled: false });
  }

  // Backup codes: minting a new set invalidates the old one — the delete and
  // the fresh inserts ride ONE batch, so an interrupted generation can never
  // leave half a set behind. The response carries the RAW codes exactly once;
  // only their SHA-256 hashes are ever stored. The current password re-proofs
  // the member (same verify as setup), and a member with 2FA on also proves
  // possession with the authenticator's 6-digit code OR an unburned backup
  // code via the one shared helper.
  if (path === "/api/me/totp/backups/generate" && method === "POST") {
    const session = await requireUser(request, env);
    await totpLimiter(request, env, "user:" + session.user.id);
    const body = await readJson(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (currentPassword.length < 1 || currentPassword.length > 128) {
      throw new HttpError(400, "Enter your current password to generate new backup codes.");
    }
    const row = await db.prepare(
      "SELECT u.totp_enabled, u.totp_secret, u.password_salt, u.password_hash, a.algorithm FROM users u " +
        "LEFT JOIN totp_algorithms a ON a.user_id = u.id WHERE u.id = ? LIMIT 1",
    ).bind(session.user.id).first();
    if (!row) throw new HttpError(404, "Your account could not be found.");
    if (!(await verifyPassword(currentPassword, row.password_salt, row.password_hash, env.PASSWORD_PEPPER))) {
      throw new HttpError(401, "Your current password is incorrect.");
    }
    if (Number(row.totp_enabled) === 1 && row.totp_secret) {
      const code = codeAnswer(body.code);
      if (!code) {
        throw new HttpError(400, "Enter the 6-digit code from your authenticator app, or a backup code.");
      }
      if (!(await verifyCodeAnswer(db, session.user.id, row.totp_secret, code, row.algorithm))) {
        throw new HttpError(401, "That code is not correct. Nothing has been changed.");
      }
    }
    const codes = [];
    const statements = [
      db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").bind(session.user.id),
    ];
    for (let index = 0; index < BACKUP_CODE_COUNT; index++) {
      const raw = mintBackupCode();
      codes.push(raw);
      statements.push(
        db.prepare(
          "INSERT INTO totp_backup_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)",
        ).bind(session.user.id, await sha256Hex(normalizeBackupCode(raw)), nowSeconds()),
      );
    }
    await db.batch(statements);
    return json({ codes });
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
    // One code field, two families: the authenticator's 6-digit code or an
    // 8-char base64url backup code. The verify dispatch happens below, after
    // the challenge claim and both limiter passes — a backup attempt rides
    // exactly the limiter tier the 6-digit path does.
    const code = codeAnswer(body.code);
    if (!token || token.length > 128 || !code) {
      throw new HttpError(400, "Enter the 6-digit code from your authenticator app, or a backup code.");
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
      "SELECT u.username_key, u.totp_enabled, u.totp_secret, a.algorithm FROM users u " +
        "LEFT JOIN totp_algorithms a ON a.user_id = u.id WHERE u.id = ? LIMIT 1",
    ).bind(userId).first();
    if (!keyRow || Number(keyRow.totp_enabled) !== 1 || !keyRow.totp_secret) {
      throw new HttpError(401, "This verification request has expired. Sign in again.");
    }
    const user = await userByUsernameKey(env, keyRow.username_key);
    if (!user) {
      throw new HttpError(401, "This verification request has expired. Sign in again.");
    }
    if (!(await verifyCodeAnswer(db, userId, keyRow.totp_secret, code, keyRow.algorithm))) {
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
