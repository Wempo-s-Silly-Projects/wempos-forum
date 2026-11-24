---
name: wempos-forum-wave-lead
description: "Use when LEADING a Wempo's Forum feature wave — collecting seat reports, committing shared-file lanes, or batching a deploy — before acting on any wave-4+ lane"
metadata:
  version: 1.1.0
  source: waves 4..40 + v5.0.0 (re-verified 2026-11-21)
---

# Wempo's Forum Wave Lead

Lead-side mechanics that wempos-forum-feature-wave assumes.

## Collection
- Parse the 5-line trailer (STATUS/EVIDENCE/BLOCKERS/NEXT_ACTIONS/OWNER_GATED), not the prose. RED carries the raw error verbatim; suite greens carry the exact tip SHA and count.
- A seat's NEXT_ACTIONS is YOUR queue. "Standing by" means dispatch next or close the row; never leave a queued brief and an idle seat both dangling.
- Log each hand-off in `.team/interactions.log` (`<UTC ISO> <seat> → lead: …`) and update the board row.

## Branches and shared files
- One wave = one branch `wave-<date>-<n>` in its own worktree; merge to main with a `Merge wave-…` commit after the gate.
- Two lanes on one tree: the committing lane commits ONLY its own hunks; the co-lane runs `git diff` against HEAD first and never `git add -A` the disk state.
- Migration numbers: the lead assigns them. First claimed wins, the second renumbers; never reuse a name in the remote ledger (next is 0060+, see wempos-forum-ritual).

## Verify + push
- Every pushed tip must be suite-green: `pnpm test` at the committed SHA in an isolated detached worktree, plus `pnpm exec wrangler deploy --dry-run`, BEFORE push. Fetch `origin/main` first (wempos-forum-owner-web-edits).
- Migrations that the code needs: apply remote via the ritual BEFORE the deploy.

## Deploy + probes
- Batch: deploy a merged main tip, not every commit. `pnpm run deploy` LAST, from a checkout at the pushed main tip (the push's bare Workers Builds deploy leaves `commit:""`).
- Probe set (every deploy report carries all of these):
  - `curl -s https://wempos-forum.com/api/version` → `{"version":"<X.Y.Z>","commit":"<short SHA>"}` equal to the pushed tip (empty/mismatch = rerun `pnpm run deploy`);
  - `/locales/en.json` → 200 `application/json`;
  - unknown locale (e.g. `/locales/xx.json`) → 404 `text/plain` (honest 404 since v5.2.0, 03c80c0); a made-up page (e.g. `/this-page-does-not-exist`) → 404 HTML shell, known routes → 200;
  - `curl -sI /` → `cache-control: no-store` + the Link header;
  - anonymous probe of each new route: expected status/shape, no hidden/banned/blocked content, writes refuse without CSRF;
  - relay alive: unauthenticated `POST /api/relay/password-verify` → 403.
- Post the release notes as `.team/release-<ver>.md` (renamed `.posted.md` once posted) after a green probe set.

## Machine-load law (owner Nov 21, after wave 5.3)
- NO CPU burners, load generators, or stress loops on the owner's Mac — wave 5.3 drove load to 271 on 6 cores and froze the machine. Flake hunts reason from timing helpers (tests/helpers/timing.mjs), never by saturating cores.

## GitHub tags + releases (owner Nov 21, 13:52: "add some releases notes", "make github tags")
- After each shipped release is LIVE: `git tag -a vX.Y.Z <release-commit> -m "Wempo's Forum vX.Y.Z (date)"`, `git push origin vX.Y.Z`, then `gh release create vX.Y.Z --verify-tag --title vX.Y.Z --latest --notes-file <notes>`.
- Notes come ONLY from public git history (release subject highlights + feat/fix/... subjects since the previous tag + compare link) — never from private .team notes. This is GitHub, not the forum: the "no per-release posts in Updates" verdict still stands.

## Static-analysis gate before deploy (owner Nov 21: "implement as much as possible (reasonably)")
- After pushing and BEFORE `pnpm run deploy`: wait for the CodeQL analysis of the pushed SHA and require 0 open alerts:
  `until gh api "repos/Wempo-s-Silly-Projects/wempos-forum/code-scanning/analyses?ref=refs/heads/main&per_page=1" --jq ".[0].commit_sha" | grep -q "$(git rev-parse HEAD)"; do sleep 20; done` (cap ~10 min), then `gh api ".../code-scanning/alerts?state=open" --jq length` must be 0. ESLint (`pnpm lint`) already runs in the isolated verify. Semgrep/ShellCheck/Gitleaks/audit run in CI on push; check `gh run list` for the pushed SHA before deploy where practical.
