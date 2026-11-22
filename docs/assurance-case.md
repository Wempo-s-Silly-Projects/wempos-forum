# Assurance case

This is the argument for why Wempo's Forum meets its
[security requirements](security-requirements.md). It covers the threat
model, the trust boundaries, how the design applies secure-design
principles, and how common implementation weaknesses are countered. The
system itself is described in [architecture.md](architecture.md).

The evidence is the code, the test suite under `tests/`, the CI workflows
under `.github/workflows/`, and the security reviews in
[security-reviews/](security-reviews/).

## 1. Threat model

**What we protect:** member accounts and sessions; private content (direct
messages, hidden or moderated posts, blocked relationships, account data);
the honesty of what's posted (no posting as someone else); the moderation
system; and keeping the site up.

**Who might attack:**

| Attacker | Can do | Wants |
|---|---|---|
| Anonymous visitor | Send any HTTP request; read public pages and the public API | Read private data, take over accounts, inject script, spam or overload the site |
| Signed-in member | All of the above, plus every member-level route | Get past bans, blocks or hidden posts; act on other members' content; gain staff powers |
| Malicious website | Make the member's browser send requests (CSRF), frame pages | Act as the member, clickjack, steal tokens |
| Rogue or compromised staff account | Moderation powers | Abuse them; staff powers are limited by role and recorded in the mod log |
| Supply-chain attacker | Publish a malicious dependency or GitHub Action | Run code in CI or in production |
| Network attacker | Watch or tamper with traffic | Steal sessions or passwords |

**Out of scope:** a compromised hosting provider (Cloudflare) or maintainer
account, the operator reading their own database, and compromised user
devices. These limits are stated in
[security-requirements.md](security-requirements.md#what-you-cant-expect).

## 2. Trust boundaries

1. **Browser ↔ worker** (the internet). Everything arriving at `worker.mjs`
   is untrusted: the path, query, headers, cookies and body. Requests are
   rate-limited, then routed to `/api/*` handlers. Each handler checks the
   session, role and input before doing anything.
2. **Worker ↔ D1 database.** The database is trusted to store data, but
   never to supply code. Queries are parameterized, and stored values are
   still treated as data when rendered.
3. **Forum worker ↔ Wempo Accounts worker.** These talk over a private
   service binding, authenticated with a shared secret (`api/relay.mjs`).
   Accounts never sees password hashes.
4. **Worker ↔ Cloudflare Turnstile.** The worker's only outbound internet
   request goes to Turnstile's fixed HTTPS siteverify endpoint
   (`api/core/http.mjs`). The worker treats the reply as untrusted input.
5. **Repository ↔ CI and deploy.** Dependencies are pinned by
   `pnpm-lock.yaml` and installed with `--frozen-lockfile`. GitHub Actions
   are pinned to commit hashes. Secrets live only in Cloudflare and GitHub
   secret stores, never in the repository.

## 3. Secure design principles (Saltzer and Schroeder)

- **Economy of mechanism.** Plain JavaScript modules with no framework and
  few runtime dependencies. Security logic sits in small shared modules
  under `api/core/` (auth, roles, visibility, passwords, crypto) rather than
  being copied into each route.
- **Fail-safe defaults.** Routes deny unless a check passes. Missing or
  malformed sessions, stored hashes or settings fail closed. For example,
  `verifyPassword` returns false on a malformed row, and hashing refuses to
  run without a valid pepper. Optional features that contact third parties
  are off by default.
- **Complete mediation.** Every state-changing request goes through
  `requireUser` (`api/core/auth.mjs`), which checks the session, the CSRF
  token and the same-origin header. Every read that returns posts, people or
  chat to a non-staff viewer goes through the shared visibility helpers
  (`api/core/visibility.mjs`, `api/core/blocks.mjs`). Cross-route tests sweep
  every endpoint for leaks.
- **Open design.** The whole system is public under AGPLv3. Nothing depends
  on the code being secret, only on keys and secrets.
- **Separation of privilege.** Signing in with two-factor enabled needs both
  the password and a TOTP code. Staff roles are separate from member roles
  (`api/core/roles.mjs`).
- **Least privilege.** Moderators get only moderation powers. The Accounts
  worker can ask for a password check but can't read hashes. CI workflows
  run with `contents: read`.
- **Least common mechanism.** Per-user data is always scoped by the session's
  user ID on the server, never by an ID the client sends.
- **Psychological acceptability.** Security features (two-factor, backup
  codes, sign out other devices, blocks) are ordinary settings in the account
  page, and error messages say plainly what to do.

## 4. Countering common weaknesses (OWASP Top 10 2021 / CWE Top 25)

| Weakness | How it's countered | Evidence |
|---|---|---|
| A01 Broken access control (CWE-862, CWE-863, CWE-639) | Server-side role checks; the shared visibility rule; ownership taken from the session | `api/core/roles.mjs`, `api/core/visibility.mjs`, the visibility and permission tests under `tests/` |
| A02 Cryptographic failures (CWE-327, CWE-916) | PBKDF2-HMAC-SHA-256 with salt and pepper; SHA-256 token hashes; CSPRNG tokens; TLS 1.2+ with HSTS | `api/core/passwords.mjs`, `api/core/crypto.mjs`, `api/vendor/http.mjs` |
| A03 Injection: SQL (CWE-89) | Every D1 query uses `prepare().bind()`; SQL fragments come only from constants | All `api/*.mjs` handlers; CodeQL and Semgrep in CI |
| A03 Injection: XSS (CWE-79) | User text rendered with `textContent`, never `innerHTML`; strict CSP with no inline script | `public/js/`, the CSP in `api/vendor/http.mjs`, CONTRIBUTING code style |
| A04 Insecure design | This assurance case; threat-driven reviews of each release batch | [security-reviews/](security-reviews/) |
| A05 Security misconfiguration | Security headers on every response (worker-first assets); a deny-by-default CSP; required secrets checked before use (for example, sign-in refuses to run without a valid pepper) | `api/vendor/http.mjs`, `wrangler.toml` (`run_worker_first = true`) |
| A06 Vulnerable components | Few dependencies; lockfile with integrity hashes; `pnpm audit` on every push and weekly; Dependabot alerts | `.github/workflows/audit.yml` |
| A07 Authentication failures (CWE-287, CWE-307) | Rate limits and optional Turnstile on sign-in; TOTP two-factor; `__Host-` Secure HttpOnly cookies; server-side session revocation | `api/core/auth.mjs`, `api/core/totp.mjs`, `worker.mjs` |
| A08 Integrity failures | Signed release tags; Actions pinned by hash; frozen lockfile | [SECURITY.md](../SECURITY.md#verifying-a-release), `.github/workflows/` |
| A09 Logging and monitoring | Moderation log of staff actions; no secrets or passwords in logs | `api/modlogs.mjs` |
| A10 SSRF (CWE-918) | The worker makes exactly one outbound internet request, to a fixed HTTPS endpoint (Turnstile). Its only other outbound call goes over the Accounts service binding. It never fetches a URL that a user supplies. | `constants.mjs` (`TURNSTILE_SITEVERIFY_URL`), `api/core/http.mjs`, `api/accounts.mjs` |
| CSRF (CWE-352) | CSRF token, same-origin check and SameSite cookie on every write | `requireUser` / `assertSameOrigin` in `api/core/auth.mjs` |
| Clickjacking (CWE-1021) | `X-Frame-Options` and CSP `frame-ancestors 'none'` | `api/vendor/http.mjs` |
| Unrestricted upload (CWE-434) | Image type found by sniffing the bytes; size limits; served with `nosniff` and a fixed Content-Type | `api/core/images.mjs`, `api/attachments.mjs` |
| Input validation (CWE-20) | Allow-list checks on lengths, formats and enums at each route; JSON bodies capped at 16 KB | Route handlers, `api/core/http.mjs`, the fast-check fuzz tests |
| Hard-coded credentials (CWE-798) | Secrets only in Cloudflare and GitHub secret stores; Gitleaks scans the full history | `.github/workflows/gitleaks.yml` |
| Memory safety (CWE-787, CWE-416) | Not applicable: JavaScript is memory-safe | — |

## 5. Continuing assurance

- Every push and pull request runs the test suite (including property-based
  fuzz tests), ESLint, CodeQL, Semgrep, Gitleaks, ShellCheck and
  `pnpm audit`.
- OWASP ZAP runs a weekly baseline scan against the live site
  (see [security-tooling.md](security-tooling.md)).
- Each batch of releases gets a security review, written up in
  [security-reviews/](security-reviews/). So far these reviews are done by
  AI agents working for the maintainer, and they cover only the changes in
  each batch. No independent human has reviewed the whole system yet.
- This document is updated whenever a trust boundary or a security
  mechanism changes.
