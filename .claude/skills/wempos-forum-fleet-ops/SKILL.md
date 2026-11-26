---
name: wempos-forum-fleet-ops
description: "Use when operating the Wempo's Forum fleet — fielding seats, writing briefs, claiming board rows, running deploys, or touching D1 — before any fleet-management action"
metadata:
  version: 1.1.0
  source: standing-laws 2026-11-17..21 (re-verified 2026-11-21 at v5.0.0)
---

# Wempo's Forum Fleet Ops

Reflex card (AGENTS.md is the source of law):

- **Autonomy (Section A)**: the lead triggers and drives test → review → commit → push → deploy → verify with no human step; only an owner interruption stops a lane. Hard pins below survive it.
- **Board first**: every task = a row in `.team/taskboard.json` (gitignored). Claim before dispatch; update on completion. Log hand-offs to `.team/interactions.log` as `<UTC ISO> <seat> → lead: …`.
- **Briefs**: Section Q echoed verbatim + the 5-line report contract (STATUS/EVIDENCE/BLOCKERS/NEXT_ACTIONS/OWNER_GATED). `.claude/agents/` is empty — seats are generic/`ecc:*` agents with the charter in the brief.
- **Deploys**: `pnpm run deploy` ONLY (`wrangler deploy --keep-vars --var COMMIT_SHA:$(git rev-parse --short HEAD)`). A bare `wrangler deploy` leaves `commit:""` on `/api/version` and an unstamped `<meta name="app-build">`, so stale tabs never get the reload offer. Ship chain: push `main` → `.team/tools/release-gate.sh` GATE GREEN (needs the lead's `.team/review/<sha>.ok`) → fast-forward `release` → `pnpm run deploy` LAST from a checkout at that SHA; a push to `main` deploys nothing; Workers Builds watches `release` only (AGENTS.md branch model).
- **Cache model**: HTML is stamped `VERSION@COMMIT_SHA` and served `Cache-Control: no-store` (worker.mjs `stampedAssetResponse`); there is no `?v=` bundle cache-buster.
- **Verify green at the pushed SHA**: `git worktree add --detach <scratch>/verify <sha>`, `pnpm test` there, then push. Never `| grep` a git chain.
- **D1**: one shared DB (`wempo-forum-data`, binding `FORUM_DB`) for forum + Accounts (`wa_` tables). Seats never write prod D1; the lead applies remote migrations only under wempos-forum-ritual.
- **Secrets**: owner-held (TENOR_API_KEY, PASSWORD_PEPPER, `.dev.vars`, `.env*`) — never printed, never committed, stdin only.
- **Browser lanes**: free-software browsers only: Firefox preferred, Playwright with Chromium or open-source WebKit allowed; Chrome and every proprietary browser banned (AGENTS.md).
- **Package manager**: pnpm/pnpx only, never npm/npx.
- **Repo is PUBLIC**: AGPLv3 everywhere, 17-line headers (.js `//`, .css `/* */`, pinned by `tests/license-headers.test.mjs`); `api/vendor/{db,http}.mjs` never touched; `public/js/vendor/**` keeps its VERBATIM banner. (Kitskey byte-parity is dead.)
- **Watchdog**: `scripts/fleet-watchdog.sh` (launchd, read-only): probes `/api/version` + Accounts, appends `.team/tick.log`, writes `.team/ALERT-<ts>.md` + a notification on failure; never deploys/writes/pushes. Briefing: `/fleet-sync` (`.claude/commands/fleet-sync.md`).
- **Churn signature**: `/api/version` `commit` ≠ pushed short SHA (or empty) → rerun `pnpm run deploy` from the main tip.
- **Load**: no idle bulk spawns; max 2 heavy agents and one test suite at a time on this Mac.
