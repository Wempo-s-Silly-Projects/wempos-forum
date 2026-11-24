---
name: wempos-forum-cross-app-signin
description: "Use when anything touches sign-in, Wempo Accounts (accounts.wempos-forum.com), api/relay.mjs, SSO redeem, sessions, cookies, or when users report they can't sign in"
metadata:
  version: "1.1.0"
  source: local-git-analysis + session (re-verified 2026-11-21 at v5.0.0)
---

# Cross-app sign-in

Flow: forum → `https://accounts.wempos-forum.com/?return=https://wempos-forum.com` → Accounts verifies the password by calling the FORUM over its `FORUM_WORKER` service binding → mints a one-time ticket → back to the forum with `?wt=` → forum `POST /api/auth/sso/redeem` (`api/accounts.mjs`, calls Accounts' `/api/sso/redeem` over the `ACCOUNTS_WORKER` binding) → `__Host-wempo_session` cookie.

## The relay is load-bearing
- Accounts never holds `PASSWORD_PEPPER` or sees hashes; it calls the forum's `api/relay.mjs`: `POST /api/relay/password-verify`, `/password-set`, `/session-revoke-all`, gated by the shared `RELAY_TOKEN` secret (constant-time compare). Tests: `tests/relay.test.mjs`.
- Deleting or unrouting relay.mjs (or dropping `handleRelayRoutes` from `API_HANDLERS` in worker.mjs) breaks ALL sign-ins (happened 2026-11-20). Probe: unauthenticated `curl -X POST https://wempos-forum.com/api/relay/password-verify` must be 403 JSON (verified 2026-11-21) — a 404 means the relay is gone.

## Sessions
- Session rows store `sha256(token)` + `csrf_token` (`api/core/auth.mjs`). Writes go through `requireUser` → `requireCsrf` → `assertSameOrigin` (Origin checked before the session) + `X-CSRF-Token`.

## Allowlists that must match the domains
- Accounts `~/wempo-accounts/constants.mjs`: return allowlist and ticket site map (`"wempos-forum": "https://wempos-forum.com"`).
- Forum `public/js/sso.js`: `WEMPO_ACCOUNTS_ORIGIN = "https://accounts.wempos-forum.com"`.
- Turnstile: each app's `TURNSTILE_HOSTNAMES` var (forum: `wempos-forum.com`) + the dashboard widget hostnames must cover both domains.

## Debugging "can't sign in"
1. Probe the relay (above). 2. `node --check` the live Accounts client JS (a missing quote once broke the sign-in page). 3. Check the captcha hostnames. 4. Check the allowlists. 5. Check owner web edits on either repo (wempos-forum-owner-web-edits).
