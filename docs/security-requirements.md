# Security requirements: what you can and can't expect

This page says, in plain words, what security Wempo's Forum is built to
give its members, admins and self-hosters, and what it does **not** promise.
How the design meets these requirements is argued in the
[assurance case](assurance-case.md). To report a problem, see
[SECURITY.md](../SECURITY.md).

## What you can expect

**Your account**

- Your password is never stored or logged in readable form. Passwords must
  be 12 to 128 characters. Each one is hashed with PBKDF2-HMAC-SHA-256
  (100,000 iterations), a per-user random salt, and a server-side pepper
  that is kept outside the database (`api/core/passwords.mjs`).
- Sessions use random 256-bit tokens. The database only stores their SHA-256
  hashes. The session cookie is `__Host-` prefixed, `Secure`, `HttpOnly` and
  `SameSite=Lax` (`api/core/auth.mjs`).
- You can turn on two-factor sign-in with any TOTP authenticator app, keep
  backup codes, and sign out your other devices.
- Sign-in, sign-up and other abuse-prone routes are rate-limited. A human
  check chosen by `HUMAN_CHECK` (`anubis`, the code default; `altcha`; or
  `off`) guards sign-up, sign-in, posts and replies. Production runs
  `altcha`: a self-hosted proof-of-work check with no third-party script or
  frame. Anubis (free software, MIT) is being rolled out as a whole-site
  gate, falling back to ALTCHA when it cannot be reached. Cloudflare
  Turnstile was retired in v5.80.0.

**Your requests**

- Every connection uses HTTPS (TLS 1.2 or newer, normally TLS 1.3). Plain
  HTTP is redirected, and HSTS is sent.
- Every request that changes something needs a signed-in session, a matching
  CSRF token, and a same-origin request (`requireUser` in
  `api/core/auth.mjs`). Other sites can't post as you.
- Pages ship with a strict Content-Security-Policy (no inline scripts, no
  framing) and the other standard hardening headers.

**What other people see**

- Hidden posts, posts by banned members, and anything across a block (in
  either direction) are left out of every non-staff view: feeds, threads,
  search, profiles, notifications, chat and the public API. That rule is
  applied in one shared place (`api/core/visibility.mjs`,
  `api/core/blocks.mjs`), and cross-route tests check it.
- Text that members write is always shown as text, never run as HTML or
  script.
- Uploaded images are checked by their actual bytes, not their file name,
  and are served with `nosniff`.
- Staff actions are recorded in the moderation log.

**Your data**

- You can export your data and delete your account.
- The forum collects only what it needs. Nothing that sends your data to a
  third party is turned on by default.

**The project**

- Security reports are handled privately and fixed quickly (see
  [SECURITY.md](../SECURITY.md)).
- Releases are signed Git tags (see
  [Verifying a release](../SECURITY.md#verifying-a-release)).
- Every change is checked by the test suite, ESLint, CodeQL, Semgrep,
  Gitleaks and a dependency audit before it ships.

## What you can't expect

- **Private from the operator.** Whoever runs a forum, including the hosted
  site's owner and their staff, can read posts, direct messages and account
  data in the database. Messages are **not** end-to-end encrypted. Don't
  share anything you couldn't trust the operator with.
- **Permanent deletion on demand.** A ban or hide keeps the content stored so
  it can be restored. Backups may keep deleted data for a while.
- **Anonymity.** The forum is not built to hide who you are from the hosting
  provider (Cloudflare) or from someone who watches your network.
- **Protection from a compromised device or browser extension.** If your
  device, browser or authenticator is compromised, your account can be too.
- **Security for self-hosted copies you change.** A self-hosted forum is
  only as safe as its operator's configuration, secrets and changes.
- **Support for old versions.** Only the latest release gets fixes.
- **A bug bounty or a guaranteed fix time.** This is a one-person hobby
  project. Fixes are prioritized by severity, but there's no service-level
  promise.
