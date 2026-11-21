# Welcome to Wempo's Forum Fleet

## How We Use Claude

Based on ItsWempo's usage over the last 30 days:

Work Type Breakdown (72 sessions):
  Continuation Summaries  ████████████████████████████████████████  84%*
  *(auto-compaction / headless summarize jobs — see the caveat in Team Tips)
  Build Feature           ░░░░░░░░░░░░░░░░░  TODO
  Improve Quality         ░░░░░░░░░░░░░░░░░  TODO

Top Skills & Commands:
  /resume                 ██████████  3x/month

Top MCP Servers:
  (none installed — the fleet runs on native tooling: built-in memory, session
  crons + an external fleet-watchdog scheduler, and a shared taskboard instead
  of an MCP server layer)

*The sample is automation-skewed: 60 of 72 sessions carried the same
machine-generated continuation prompt. The numbers above describe jobs fired
by the running fleet, not human work; treat the TODO rows as placeholders
until we sample a human-driven window.

## Your Setup Checklist

### Codebases
- [ ] wempos-forum — github.com/Wempo-s-Silly-Projects/wempos-forum (~/wempos-forum) (this repo: Workers + D1 + R2)
- [ ] wempo-accounts — github.com/Wempo-s-Silly-Projects/wempo-accounts (~/wempo-accounts)  (unified login on the same DB)

### MCP Servers to Activate
- (none required — no MCP servers are part of this team's workflow)

### Skills to Know About
- /wempos-forum-feature-wave — the standing feature chain: slate → board row → RED-first lane → collect → implement → suite → commit → gate → deploy
- /wempos-forum-wave-lead — lead-side mechanics: trailer parsing, freeze-pin retargets, isolated-worktree verification, deploy batching
- /wempos-forum-fleet-ops — the shared taskboard (.team/taskboard.json), seat roster, and the Section Q anti-waste protocol
- /wempos-forum-ritual — the deploy verify ritual (probe stamp x3, funnel, board close)
- /superpowers:systematic-debugging — mandatory on defect arcs
- /superpowers:brainstorming — mandatory at wave slates before any code

## Team Tips

All sourced from [CLAUDE.md](CLAUDE.md) standing laws — read it end to end before your first task.

1. **pnpm/pnpx only, never npm/npx.** Owner directive; every install and script in this fleet rides pnpm (see also [pnpm-workspace.yaml](pnpm-workspace.yaml)).
2. **Never run a bare `pnpx wrangler deploy`.** Canonical deploy is `pnpm run deploy` — the script binds `--keep-vars --var COMMIT_SHA:$(git rev-parse --short HEAD)`. A bare deploy answers with an empty `build:""` on /api/version, inerts the stale-build strip, and breaks the client's `?v=` bundle cache-buster (the 2026-11-17 T25 churn defect; 7 deploys rode bare wording before root cause was pinned).
3. **Every push must be followed by the ritual deploy.** Pushes fire a Workers Builds git-integration deploy that wipes the build stamp — run `pnpm run deploy` after every push.
4. **Never commit or print secrets.** `.dev.vars`, `.env`, `.env.*` are git-ignored (real credentials); TENOR_API_KEY and PASSWORD_PEPPER are owner-held, passed via stdin only. Prod-D1 writes by agents are DENIED.
5. **The repo is PUBLIC.** Pushes to main publish immediately — never commit secrets or owner-held files (see tip 4).
6. **Verify every suite→push at the pushed SHA in an isolated worktree.** Never gate a git chain behind `| grep`.
7. **Never touch the vendored worker files** — `api/vendor/db.mjs` and `api/vendor/http.mjs` are NEVER-touch; vendored-verbatim files under `public/js/vendor/**` keep their own banner, exempt from the AGPLv3 template.
8. **AGPLv3 everywhere** — every repo, every file carries the per-file license notice; third-party code must be AGPLv3-compatible.
9. **D1-only fleet, careful migrations.** One shared DB per app pair; R2 holds blobs, no KV; remote migrations apply only under the full NAME-PRESENCE ritual (`d1_migrations` check, never count alone); the D1 runner enforces FKs (rename-rebuild migration pattern is dead).
10. **No Playwright, no Chrome.** Browser/visual lanes are Firefox-only; Playwright is banned machine-wide.

## Get Started

1. **Clone the repo:** `git clone https://github.com/Wempo-s-Silly-Projects/wempos-forum && cd wempos-forum`.
2. **Install dependencies:** `pnpm install` (pnpm/pnpx only — never npm/npx).
3. **Run the test suite:** `node --test tests/` — confirm green before touching anything.
4. **Read [CLAUDE.md](CLAUDE.md) end-to-end** — the standing laws are binding, not advisory.
5. **Read the current wave slates in [docs/drafts/](docs/drafts/)** to see how the standing feature chain runs (slate → board row → RED-first lane → collect → implement → suite → commit → gate → deploy).

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
