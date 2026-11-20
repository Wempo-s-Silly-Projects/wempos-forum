# GooberCord fleet — standing laws

The fleet's anti-waste protocol (Section Q), inherited by every teammate and subagent — echo it verbatim into any spawned brief.

## STRICT ANTI-WASTE PROTOCOL (Section Q)

1. **Time-Boxed Foreman** — finish the task you were given; no open-ended exploration: read only the files the task targets. Blocked or unfinished → stop and report state immediately, don't ramble.
2. **Code-Only Enforcer** — zero chatter, no status essays, no architectural monologues. Reports are terse: counts, file:line references, exact diff shapes. No polite filler between agents.
3. **Diff-Scope Sheriff** — touch only the paths the task assigned. No renames "for style," no refactoring neighbors, no framework-improving on the side. A diff outside scope is rejected, not reviewed.
4. **Fast-Fail Auditor** — verify cheap early (turn 1–2). The SAME error twice in a row = STOP immediately, output the raw error, escalate to the lead. Never burn turns retrying identical-failing commands.

## Fleet standing constraints

- **pnpm/pnpx only** — never npm/npx.
- **Canonical deploy = `pnpm run deploy`** — the script binds `--keep-vars --var COMMIT_SHA:$(git rev-parse --short HEAD)` (package.json). NEVER run a bare `pnpx wrangler deploy`: it answers with an empty `build:""` on /api/version, inerts the stale-build strip, and breaks the client's `?v=` bundle cache-buster (the 2026-11-17 T25 churn defect — 7 deploys rode bare wording before the root cause was pinned).
- **Repo is PUBLIC** — pushes to main publish immediately; never commit `.dev.vars`, `.env`, `.env.*` (git-ignored, hold real credentials, never printed or committed).
- **AGPLv3 everywhere** — per-file notice: 17-lines-plus-blank `//` template for .js, `/* */` for .css; all third-party code must be AGPLv3-compatible.
- **Vendored worker files are never-touch** — `api/vendor/db.mjs` and `api/vendor/http.mjs` are NEVER touched (STACK LAW: vanilla imperative); the framework byte-parity law is CANCELLED 2026-11-18 (owner order), its pins retired, and migration 0045 recreated the chunk table the revert needed. Vendored-verbatim files (e.g. `public/js/vendor/**`) remain EXEMPT from the 17-line header template — their VENDORED VERBATIM banner rides the banner-shape row (tests/vendor-parity.test.mjs); a template swap would break the banner contract.
- **D1 and R2 only fleet** — one shared DB per app pair; R2 is for images, no KV; migrations local floor 0017; remote applies only under the full verify ritual (NAME-PRESENCE in d1_migrations, never count alone).
- **No Playwright** — banned machine-wide; browser lanes are Firefox-only, Chrome excluded.
- **Secrets** — TENOR_API_KEY and PASSWORD_PEPPER are owner-held; prod-D1 writes via agents DENIED.
- **Parity numbers** — every parity claim carries source URL + date.
- **Commit attribution** — end commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## FULLY AUTONOMOUS OPERATION (Section A — owner order, 21:04 EST Nov 17)

Owner directives verbatim: "U TRIGGER EVERYTHING", "U MANAGE EVERYTHING", "NO LAWS", "THIS IS A FULLY AUTONOMOUS OPERATION", "NO HUMAN INTERVENTION IS REQUIRED", "AND TO ASSUME THAT".

- The lead (team-lead session) triggers and manages ALL fleet work end-to-end: field the agent-team roster on trigger, drive cycles to completion (test → review → commit → push → deploy → verify) with NO human intervention between steps.
- Assume the operation is autonomous at all times, and that autonomy PERSISTS UNTIL A HUMAN INTERVENES — an owner interruption is the only thing that stops a running lane; silence is not a stop signal. Agent team = PROPER BY DEFINITION: Team Lead + teammate sessions, peer-to-peer messaging, shared `.team/taskboard.json` claimed/updated by agents; the 80+ role roster fielded on trigger; the 4 anti-waste laws above ride every brief.
- Hard pins that OUTLIVE Section A (owner safety law, keep): secrets never printed/committed (owner-held keys, stdin only); prod-D1 writes only under the full NAME-PRESENCE ritual or never; Chrome/Playwright bans; vendored worker files never-touch; AGPLv3; budget ceiling.
- "NO LAWS" reads as zero ceremony between steps — NOT as license past the hard pins above. Work autonomously and report faithfully; never fake green.
