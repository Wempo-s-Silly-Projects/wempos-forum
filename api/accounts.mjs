// Copyright 2026 YourLocalGoober
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

// Wempo Accounts SSO (the alternate front door): the member signs in at
// accounts.itswempo.workers.dev, accounts bounces back with ?wt=<one-time
// 32-byte-hex code>, and the client POSTs it here. This route trades the code
// for the forum's OWN session through the forum's existing machinery — same
// cookie, same TTL, same ban gate as a normal login — mirroring the login
// route's ordering: network-ban check first, then same-origin + CSRF (the
// redeem rides the guest session the client already holds), then the login
// limiter tier. The code never touches credential internals, and the pepper
// and TOTP primitives stay exactly as they were.
//
// The relay call mirrors api/relay.mjs's outbound cousin on GooberCord:
// a service binding to the accounts worker over https://sso.internal/, gated
// by the shared RELAY_TOKEN secret (installed on BOTH workers — that token is
// the whole auth, so it is never echoed, logged, or embedded in an error).
// Every relay failure degrades to null and answers the shared 401, so probing
// the endpoint without the handshake learns nothing.
import { assertNetworkNotBanned, createSession, requireCsrf } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson } from "./core/http.mjs";
import { publicUser, userById } from "./core/shapers.mjs";

// Anchored both ends (the unanchored-regex advisory lesson): the code is
// exactly the 32 bytes accounts' login issues, 64 hex characters.
const SSO_CODE_PATTERN = /^[0-9a-f]{64}$/i;

// The one shared refusal copy — an expired code, a relay refusal, a degraded
// binding, and an unknown member all answer the same 401, exactly like the
// login route's uniform invalid-credentials 401.
const SSO_REFUSED = "That sign-in link has expired. Sign in again.";

const BANNED_MESSAGE = "This account is currently banned.";

// One hop: binding → accounts → { userId, username, role }. The token rides
// the header only. !ok / unreachable / unparsable all return null — the
// caller answers its shared 401 rather than leaking which leg broke.
async function redeemCode(env, code) {
  const binding = env.ACCOUNTS_WORKER;
  const token = env.RELAY_TOKEN;
  if (!binding || typeof binding.fetch !== "function" || !token || typeof token !== "string") {
    return null;
  }

  let response;
  try {
    response = await binding.fetch(new Request("https://sso.internal/api/sso/redeem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Token": token,
        // The calling worker's declared identity: accounts makes this slug
        // the enforced return_site predicate (a ticket minted for one member
        // site redeems only here). A convenience stamp, NOT an auth boundary
        // — the relay token is the whole auth.
        "X-Relay-Worker": "wempos-forum",
      },
      body: JSON.stringify({ code }),
    }));
  } catch {
    return null;
  }

  if (!response.ok) return null;

  try {
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    if (!Number.isSafeInteger(body.userId) || body.userId < 1) return null;
    if (typeof body.username !== "string" || typeof body.role !== "string") return null;
    return body;
  } catch {
    return null;
  }
}

export async function handleAccountsRoutes(request, env, url, path, method) {
  if (path === "/api/auth/sso/redeem" && method === "POST") {
    // Login-parity ordering and teeth: the network ban fires before any
    // credential-adjacent work, the redeem rides the guest session's CSRF,
    // and the login-class limiter tiers the endpoint. No Turnstile here —
    // accounts' own sign-in already carried the human check, and the code is
    // single-use.
    await assertNetworkNotBanned(request, env);
    const guest = await requireCsrf(request, env);
    await rateLimit(request, env, "login");

    const body = await readJson(request);
    const code = typeof body.wt === "string" ? body.wt.trim() : "";
    if (!SSO_CODE_PATTERN.test(code)) {
      throw new HttpError(400, "That sign-in link is incomplete. Sign in again.");
    }

    const redeemed = await redeemCode(env, code);
    if (!redeemed) throw new HttpError(401, SSO_REFUSED);

    // The forum row is the truth (SHARED D1 — the same users row accounts
    // signed in): the relay echo of username/role is never trusted.
    const user = await userById(env, redeemed.userId);
    if (!user) throw new HttpError(401, SSO_REFUSED);

    // The ban gate, verbatim from the login route — the payload (reason +
    // expiresAt) is only readable after the relay proved the visitor signed
    // in at accounts, and requireUnbanned below re-checks atomically at the
    // insert so a ban landing between the two steps still blocks.
    const activeBan = await env.FORUM_DB.prepare(
      "SELECT reason, expires_at FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
    ).bind(Number(user.id), nowSeconds()).first();
    if (activeBan) {
      throw new HttpError(403, BANNED_MESSAGE, {}, {
        error: BANNED_MESSAGE,
        banned: true,
        reason: activeBan.reason,
        expiresAt: activeBan.expires_at === null || activeBan.expires_at === undefined
          ? null
          : Number(activeBan.expires_at),
      });
    }

    // The forum's OWN session: same createSession call the login route makes —
    // the guest token rotates into the member session, and the cookie name,
    // TTL, and ban gate are the login route's, untouched.
    const session = await createSession(request, env, Number(user.id), guest.tokenHash, true);
    if (!session) throw new HttpError(403, BANNED_MESSAGE);
    return json({ user: publicUser(user), csrfToken: session.csrfToken }, 200, { "Set-Cookie": session.setCookie });
  }
  return null;
}
