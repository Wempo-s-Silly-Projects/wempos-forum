---
name: wempos-forum-owner-web-edits
description: "Use when about to push or deploy wempos-forum or wempo-accounts, or whenever origin/main has moved — the owner edits main directly in the GitHub web UI and those edits have broken prod (syntax errors, deleted files)"
metadata:
  version: "1.1.0"
  source: local-git-analysis + session (re-verified 2026-11-21 at v5.0.0)
---

# Handling owner web edits

The owner often commits straight to `main` on GitHub ("Update X.mjs", "Delete tests directory", "yo"). Since Nov 23 a push to `main` deploys nothing; Workers Builds watches `release` only (AGENTS.md branch model), so a web edit reaches prod only when `release` is fast-forwarded to it; until then it silently breaks `main` for everyone who pulls.

## Before you push or deploy
1. `git fetch origin && git log --oneline HEAD..origin/main`: read every new commit and `git diff --stat` it.
2. Rebase onto it (never force-push over the owner).
3. `node --check` EVERY touched JS/MJS (server and `public/js`), not just worker.mjs. Past breakage: a top-level `return` in worker.mjs; a missing quote in the Accounts client JS that killed the sign-in page.
4. `pnpm exec wrangler deploy --dry-run`: the bundler catches missing exports/imports.
5. `pnpm test` (in an isolated detached worktree at the SHA you will push).
6. Watch for deletions of load-bearing files (deleting `api/relay.mjs` broke every sign-in). If an owner edit looks deliberate (removed tests, removed rate limits, changed deploy script), keep it and tell the owner instead of silently reverting.
7. After push: wait ~95s for the bare git build, then `pnpm run deploy` from the pushed main tip, and probe `https://wempos-forum.com/api/version` until `commit` == `git rev-parse --short HEAD`.
8. If the tree is dirty from tracked runtime files (e.g. logs), fix the tracking; don't stash and forget.
