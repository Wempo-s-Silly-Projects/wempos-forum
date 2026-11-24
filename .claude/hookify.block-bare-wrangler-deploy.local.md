---
name: block-bare-wrangler-deploy
enabled: true
event: bash
conditions:
  - field: command
    operator: regex_match
    pattern: wrangler\s+deploy
  - field: command
    operator: not_contains
    pattern: --dry-run
action: block
---

🚫 **Bare `wrangler deploy` is banned** (AGENTS.md: "Deploy only with `pnpm run deploy`").

A bare deploy ships an empty build stamp (`commit:""` on /api/version), so stale tabs never get the reload offer — this bit the fleet on 2026-11-17.

Use `pnpm run deploy`, run LAST from a checkout at the pushed main tip. `wrangler deploy --dry-run` is allowed.
