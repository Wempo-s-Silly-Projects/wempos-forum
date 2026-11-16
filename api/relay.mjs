// Credential relay (login-parity rescue): internal password-verify/password-set
// endpoints for GooberCord. Both apps share one D1 (users table), but
// PASSWORD_PEPPER lives per-worker as a secret — GooberCord's copy is not
// guaranteed to equal the forum's (a lost/mis-set pepper locked members out
// of BOTH sides while the forum itself stayed healthy). Instead of hoping the
// secrets match, GooberCord delegates credential work here:
//   password-verify → the forum answers "are these credentials correct?"
//   password-set    → the forum stores a new salt/hash under ITS pepper
// (a GC-side set-password therefore lands in a form the forum itself can
// verify, and both apps converge on one pepper without ever printing it).
//
// Trust model: these routes answer credential questions, which makes them a
// password oracle if exposed. The gate is a shared secret token env.RELAY_TOKEN
// (a Cloudflare secret installed on BOTH workers; never in git — the
// constant-time compare below is the whole auth). No cookies, no CSRF, no
// Turnstile: the token IS the auth, and the existing login/password-change
// rate limiters throttle per-username hammering exactly like the forum's own
// login route. Response bodies never include salt/hash material — only ids,
// usernames, and roles.
import { equalConstantTime, nowSeconds } from "./core/crypto.mjs";
import { requestIpHash } from "./core/auth.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { hashPassword, isValidPassword, verifyPassword } from "./core/passwords.mjs";
import { isValidUsername, publicUser, userByUsernameKey } from "./core/shapers.mjs";

const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

// The worker-to-worker gate: a present-but-unmatched token answers 403 with
// the same copy an absent token gets, so probing tells an attacker nothing.
async function requireRelayToken(request, env) {
  const expected = env.RELAY_TOKEN;

  if (!expected || typeof expected !== "string") {
    throw new HttpError(503, "Relay is not configured.");
  }

  const supplied = request.headers.get("X-Relay-Token") || "";

  if (!equalConstantTime(supplied, expected)) {
    throw new HttpError(403, "Relay refused.");
  }
}

function isIpLiteral(value) {
  const ipv4 = value.split(".");
  if (ipv4.length === 4 && ipv4.every((part) =>
    /^\d{1,3}$/.test(part) && Number(part) <= 255
  )) return true;

  if (!value.includes(":") || !/^[0-9a-fA-F:]+$/.test(value)) return false;
  if (value.includes(":::") || value.indexOf("::") !== value.lastIndexOf("::")) return false;
  if (value.startsWith(":") && !value.startsWith("::")) return false;
  if (value.endsWith(":") && !value.endsWith("::")) return false;
  const groups = value.split(":").filter(Boolean);
  return groups.every((group) => group.length <= 4) &&
    (value.includes("::") ? groups.length < 8 : groups.length === 8);
}

export async function handleRelayRoutes(request, env, url, path, method) {
  if (path === "/api/relay/network-ban-check" && method === "POST") {
    await requireRelayToken(request, env);
    const body = await readJson(request);
    const ip = typeof body.ip === "string" ? body.ip.trim() : "";
    // Cloudflare supplies an IPv4 or IPv6 literal. Do not accept arbitrary
    // strings or hostnames into the keyed network-ban lookup.
    if (!ip || ip.length > 45 || !isIpLiteral(ip)) {
      throw new HttpError(400, "A valid client IP is required.");
    }
    const ipRequest = new Request(request.url, {
      headers: { "CF-Connecting-IP": ip },
    });
    const ipHash = await requestIpHash(ipRequest, env);
    // The actor key is the Forum-keyed hash, never the raw address.
    await rateLimit(request, env, "login", "network:" + ipHash);
    const activeBan = await env.FORUM_DB.prepare(
      "SELECT 1 FROM banned_ips bi JOIN bans b ON b.id = bi.ban_id " +
        "WHERE bi.ip_hash = ? AND b.revoked_at IS NULL " +
        "AND (b.expires_at IS NULL OR b.expires_at > ?) LIMIT 1",
    ).bind(ipHash, nowSeconds()).first();
    return json({ banned: Boolean(activeBan) });
  }

  if (path === "/api/relay/password-verify" && method === "POST") {
    await requireRelayToken(request, env);
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!isValidUsername(username) || password.length < 1 || password.length > 128) {
      throw new HttpError(400, "Enter a username and password.");
    }

    // Same throttle tier as the forum login route, keyed by account so one
    // username cannot be hammered from rotating IPs through the relay.
    await rateLimit(request, env, "login", "account:" + username.toLowerCase());

    // Unknown usernames burn PBKDF2 against the dummy salt exactly like the
    // login route does — no existence oracle even for a token holder.
    const user = await userByUsernameKey(env, username.toLowerCase());
    const valid = await verifyPassword(
      password,
      user ? user.password_salt : DUMMY_SALT,
      user ? user.password_hash : DUMMY_HASH,
      env.PASSWORD_PEPPER,
    );

    if (!user || !valid) {
      return json({ valid: false });
    }

    return json({ valid: true, user: publicUser(user) });
  }

  if (path === "/api/relay/password-set" && method === "POST") {
    await requireRelayToken(request, env);
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!isValidUsername(username) || !isValidPassword(password)) {
      throw new HttpError(400, "Enter a username and a valid password.");
    }

    await rateLimit(request, env, "password-change", "account:" + username.toLowerCase());

    const hashed = await hashPassword(password, env.PASSWORD_PEPPER);
    const result = await env.FORUM_DB.prepare(
      "UPDATE users SET password_salt = ?, password_hash = ? WHERE username_key = ?",
    ).bind(hashed.salt, hashed.hash, username.toLowerCase()).run();

    if (Number(result?.meta?.changes) !== 1) {
      throw new HttpError(404, "No such user.");
    }

    const user = await userByUsernameKey(env, username.toLowerCase());
    return json({ changed: true, user: user ? publicUser(user) : null });
  }

  return null;
}
