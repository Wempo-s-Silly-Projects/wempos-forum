# Security tooling

Free analysis tools that check this repository. Every CI job runs with
read-only repository permissions and needs no secrets. The Semgrep job has
its own workflow file and is described in `CONTRIBUTING.md`.

## ESLint (static, JavaScript)

- **Checks:** code-quality and correctness rules over all JavaScript
  (`eslint.config.js`).
- **Runs:** on every push to `main` and every pull request (`test.yml`).
- **Locally:** `pnpm lint`

## CodeQL (static, JavaScript and Actions)

- **Checks:** data-flow analysis for injection, XSS, unsafe redirects and
  similar bugs in JavaScript, plus risky patterns in workflow files.
- **Runs:** GitHub code scanning default setup (repository settings, no
  workflow file): on pushes, pull requests and weekly. Results appear under
  the repository's Security tab.
- **Locally:** not needed; read the results on GitHub.

## ShellCheck (static, shell scripts)

- **Checks:** quoting, word-splitting and portability bugs in every tracked
  `*.sh` file and every tracked executable with a shell shebang.
- **Runs:** on every push to `main` and every pull request (`shellcheck.yml`).
- **Locally:** `shellcheck apply-remote.sh scripts/*.sh`
- A real false positive gets a narrow `# shellcheck disable=SCxxxx  # reason`
  on the line above it, never a file-wide disable.

## Gitleaks (secret scanning, full history)

- **Checks:** API keys, tokens and passwords in every commit ever made, not
  just the current tree.
- **Runs:** on every push to `main` and every pull request (`gitleaks.yml`),
  using a pinned, checksum-verified release binary.
- **Locally:** `gitleaks git --redact --config .gitleaks.toml .`
- `.gitleaks.toml` allowlists only exact fake test-fixture values. If it flags
  a real credential, rotate the credential first; removing it from history
  comes second.

## pnpm audit (dependencies)

- **Checks:** known advisories against the locked dependency tree.
- **Runs:** on every push to `main`, every pull request and weekly
  (`audit.yml`). Production dependencies block at moderate or higher; dev
  tooling (ESLint, Wrangler) is reported at high or higher without failing.
- **Locally:** `pnpm audit --prod --audit-level=moderate` and
  `pnpm audit --audit-level=high`

## OWASP ZAP baseline (dynamic, passive)

- **Checks:** what a short spider of a running forum reveals in responses:
  missing or weak security headers, cookie flags, information leaks. It is
  passive only; it sends no attacks.
- **Runs:** weekly and on manual dispatch only, never on push
  (`zap-baseline.yml`). The HTML, JSON and Markdown reports are uploaded as
  the `zap-baseline-report` workflow artifact; no issues are filed and the
  job does not fail on findings.
- **Target: a local copy, not the live site.** The live site sits behind
  Cloudflare, which answers automated scanners with its bot-check page. The
  first live run (GitHub run 44958535048) scanned only that page, so the
  forum itself was never checked. The job now starts the forum inside the
  runner instead: it installs dependencies, applies the D1 migrations to a
  local database, starts `wrangler dev --local` on port 8787, waits for
  `/api/version` to answer, and then points ZAP at `http://localhost:8787`
  (the ZAP container uses the runner's host network).
- **What the local copy covers:** the same worker code, routes, response
  headers and pages as production, on an empty database with no members.
  The job writes a `.dev.vars` file at run time with a fixed test pepper
  (a public placeholder, not a secret) and no Turnstile secret. It does
  **not** cover anything Cloudflare adds in front of the live site (TLS,
  the bot check, edge caching), signed-in pages, or content that only
  exists in the live database.
- **Locally:** `pnpm run db:migrate:local`, then
  `pnpm exec wrangler dev --local --port 8787`, then
  `docker run --rm -t --network=host ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://localhost:8787`
  (point it only at a site you run).

## Fuzz tests (property-based)

- **Checks:** random and malformed input against the pure validators
  (username shape, the client router `routeForPath`, `normalizeTotpAlgorithm`,
  `verifyTotpCode`, `httpsUrlOrEmpty`/`sourceUrl`, `safeSourceUrl`,
  `maskedExcerpt`), the JSON body reader (`readJson`), and real handlers
  driven through the test harness (sign-in, sign-up, search, new post).
  Properties: no unhandled error, never a 500, bad input answers its
  documented 4xx, and the URL helpers only ever return an `https://` URL or
  their fallback.
- **Runs:** with every `pnpm test` (`tests/fuzz-*.test.mjs`), using
  [fast-check](https://fast-check.dev/) (MIT, development-only) with a fixed
  seed and a bounded number of runs, so a failure reproduces exactly and the
  suite stays fast.
- **Locally:** `node --test tests/fuzz-validators.test.mjs tests/fuzz-handlers.test.mjs`
