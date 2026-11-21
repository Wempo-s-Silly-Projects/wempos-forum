# Wempo’s Forum — rules for AI agents

This file is for AI agents working in this repo. Humans: read
[CONTRIBUTING.md](CONTRIBUTING.md) instead.

Also read AGENTS-ONBOARDING.md — it covers the repo layout, conventions and
how to test. This file covers the rules.

Every teammate and subagent inherits the anti-waste protocol below. Echo it
verbatim into any brief you hand to another agent.

## STRICT ANTI-WASTE PROTOCOL (Section Q)

1. **Time-Boxed Foreman** — finish the task you were given; no open-ended exploration: read only the files the task targets. Blocked or unfinished → stop and report state immediately, don't ramble.
2. **Code-Only Enforcer** — zero chatter, no status essays, no architectural monologues. Reports are terse: counts, file:line references, exact diff shapes. No polite filler between agents.
3. **Diff-Scope Sheriff** — touch only the paths the task assigned. No renames "for style," no refactoring neighbors, no framework-improving on the side. A diff outside scope is rejected, not reviewed.
4. **Fast-Fail Auditor** — verify cheap early (turn 1–2). The SAME error twice in a row = STOP immediately, output the raw error, escalate to the lead. Never burn turns retrying identical-failing commands.

## Standing rules

### Tooling and deploys

- **pnpm/pnpx only — never npm/npx.**
- **Deploy only with `pnpm run deploy`.** The script runs
  `wrangler deploy --keep-vars --var COMMIT_SHA:$(git rev-parse --short HEAD)`
  (see `package.json`), which stamps the build with the commit. NEVER run a bare
  `wrangler deploy` / `pnpx wrangler deploy`: it ships an empty stamp
  (`build:""` on `/api/version`), disables the stale-build banner, and breaks
  the client's `?v=` script cache-buster. (This bit the fleet on 2026-11-17:
  seven bare deploys went out before the cause was found.)
- A push to `main` can trigger an automatic hosted build that ships without the
  stamp. After any push, run `pnpm run deploy` last, from a checkout at the
  pushed `main` tip.

### The repo is PUBLIC

- Pushes to `main` publish immediately.
- Never commit `.dev.vars`, `.env` or `.env.*`. They are git-ignored, hold real
  credentials, and are never printed or committed.

### License: AGPLv3 everywhere

- Everything is AGPLv3-or-later. All third-party code must be
  AGPLv3-compatible.
- Every `.js` / `.mjs` file starts with the 17-line `//` license notice, the
  two SPDX lines (license identifier + copyright), then a blank line (copy all
  19 lines from any existing file, e.g. `public/js/api.js`). Every `.css` file
  carries the same notice and SPDX lines in `/* */` comments.
  `tests/license-headers.test.mjs` enforces this. Uncommentable files are
  covered by `REUSE.toml`; `reuse lint` (CI) must exit 0.
- Vendored-verbatim files (`public/js/vendor/**`, when present) are exempt from
  the template: they keep their own VENDORED VERBATIM banner, and swapping in
  the template would break that banner contract.

### Never-touch files

- `api/vendor/db.mjs` and `api/vendor/http.mjs` are NEVER touched (stack law:
  vanilla imperative).
- The old framework byte-parity law was cancelled on 2026-11-18 by owner order
  and its pins retired; migration 0045 recreated the chunk table that revert
  needed.

### Data: D1 and R2 only

- Cloudflare D1 and R2 only — no KV. One shared database per app pair (the
  forum and Wempo Accounts share one). R2 is for images (not wired up for the
  forum yet — see `docs/r2-migration.md`).
- Local migrations floor: 0017.
- Remote migrations apply **only** under the full verify ritual: check each
  migration by NAME in `d1_migrations` before and after (NAME-PRESENCE — never
  the row count alone). The `wempos-forum-ritual` skill has the steps.

### Browsers

- **No Playwright** — banned machine-wide.
- Browser lanes are **Firefox-only**. Chrome is excluded.

### Secrets and production data

- `TENOR_API_KEY` and `PASSWORD_PEPPER` are owner-held. Secrets go in via stdin
  only, and are never printed or committed.
- Production D1 writes by agents are DENIED, except under the full
  NAME-PRESENCE ritual above.

### Claims and commits

- Every parity claim carries a source URL + date.
- End every commit message with:
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`

## Autonomous operation (Section A — owner order, 21:04 EST Nov 17)

Owner directives verbatim: "U TRIGGER EVERYTHING", "U MANAGE EVERYTHING", "NO LAWS", "THIS IS A FULLY AUTONOMOUS OPERATION", "NO HUMAN INTERVENTION IS REQUIRED", "AND TO ASSUME THAT".

- The lead (team-lead session) triggers and manages all fleet work end to end:
  it fields the agent team when a lane triggers and drives each cycle to
  completion (test → review → commit → push → deploy → verify) with no human
  step in between.
- Autonomy persists until a human intervenes. An owner interruption is the only
  thing that stops a running lane; silence is not a stop signal.
- The agent team is a Team Lead plus teammate sessions, peer-to-peer messaging,
  and the shared `.team/taskboard.json` (git-ignored) that agents claim and
  update. The four Section Q laws ride every brief.
- **Hard pins that outlive Section A** (owner safety law — keep):
  - secrets never printed or committed (owner-held keys, stdin only);
  - prod-D1 writes only under the full NAME-PRESENCE ritual, or never;
  - Chrome and Playwright bans;
  - vendored worker files never touched;
  - AGPLv3;
  - the owner's budget ceiling ($1000 fleet/API spend).
- "NO LAWS" means zero ceremony between steps. It is NOT a license past the
  hard pins. Work autonomously, report faithfully, never fake green.

## Agent roster (index)

Seats are spawned per task and dissolved afterwards; nothing idles. Seat
charters aren't committed (`.claude/` is git-ignored), so when you field a
seat, put its charter and the Section Q laws in the brief.

Routing: generic lanes go to `ecc:*` agents; fleet governance (taskboard,
ritual, compliance, roster) goes to these seats.

| Group | Seats |
|---|---|
| Core engineering | researcher |
| Advanced engineering & debugging | hypothesis, refactor-eng, db-optimizer, issue-review, a11y-navigator, viewport-saboteur |
| Research, content & data | fact-checker, data-analyst, synthesizer, market-scout |
| Operations & meta | prompt-optimizer |
| Product & design | pm, contract-architect, persona-tester |
| Security & governance | red-teamer, compliance, cost-monitor |
| Simulation & decision-making | debate-moderator, chaos-eng, tool-builder |
| Memory & self-improvement | learn, archivist, learn-eval |
| Execution & flow-control | hitl-gate, deadlock-breaker, sandbox-prov |
| Domain-specific & creative | localizer, growth-seo, triage-router, lore-keeper, asset-shader, brand-voice |
| Business & scientific | ceo, legal-drafter, procurement, sales (dormant), finance, formal-verifier, divergent, patent-miner, fitness |
| Cybersecurity & purple team | threat-hunter, incident-cmd, honeypot, reverser, red-teamer |
| Multi-agent society & economics | trust-scorer, norm-enforcer, mediator |
| The final bosses | garbage-collector, entropy-monkey |
| Evolutionary & self-replicating | mutator, data-blacksmith, socratic |
| Psychological & human-simulation | theory-of-mind, load-balancer, mediator, persona-tester |
| Epistemic & truth-seeking | falsificationist, uncertainty-quantifier, fact-checker |
| Hardware, compute & infrastructure | inference-router, prefetcher, cryo-archivist, schema-guardian |
| Cross-system cohesion & rewrite survival | dependency-sync, sso-tester, dx-critic, fanout-sim, reconnect-saboteur, parity-shadow, dead-abstraction |
| Data, state & real-time protocol | cache-auditor, search-sync, media-pipeline, backpressure, notif-aggregator, budget-enforcer, split-brain, service-binding, do-specialist |
| Ecosystem & edge governance | feature-flag, gdpr-reaper, api-advocate, cold-start, viewport-saboteur |
| Compiler, runtime & distributed systems | leak-profiler, ast-codemod, runtime-compat, nodejs-compat, idempotency-verifier, snowflake-auditor, clock-skew, deadlock-hunter |
| Human-edge & accessibility | a11y-navigator, low-end-device, offline-sync |

Composites: `mutator` + `fitness` (competing implementations, keep the
benchmark winner); `falsificationist` (adversarial tests against a winning
hypothesis); `uncertainty-quantifier` + security review gates (every auth route
tied to a verified spec); `inference-router` + `cryo-archivist` (cheap models
for routine work, frontier models for core and auth).

Standing not-applicable rulings (owner-endorsed, no seats): physical/IoT roles
(no hardware); WebRTC/voice signaling; bundle-size enforcer (no bundler, by
law); internal market maker; diplomat; standalone provenance tracker (the
parity-citation rule covers it); bot and third-party API developer surfaces
(owner-declined — `api-advocate` audits from public docs only).
