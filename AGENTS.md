# Wempo’s Forum fleet — standing laws

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
# Wempo's Forum fleet — agent roster

The canonical team. THE ROLL = 119 seat definitions in `.claude/agents/`
(gitignored by repo law), each carrying its charter + the Section Q anti-waste
laws. This file is the durable, committed INDEX the owner dictated: every role
as sent, mapped to its seat file. Spawn-per-task economics — seats field on a
lane's trigger, dissolved after; nothing idles.

Routing law (ECC 2.2.3 present): generic lanes -> `ecc:*` agents; fleet
governance (board, ritual, compliance, roster) -> these seats.

## Core engineering (the owner's canonical core-7)

- **researcher** — Fleet researcher seat — codebase/external-doc/web context runs that return a SUMMARIZED brief (contracts, APIs

## Advanced engineering & debugging

- **hypothesis** — Fleet parallel-debugging seat — spawned in MULTIPLES during a hard bug; each instance proves/disproves ONE roo
- **refactor-eng** — Fleet refactor seat — mechanical cross-file upgrades (symbol renames, framework/version moves, vendored-kit po
- **db-optimizer** — Fleet DB/perf seat — post-landing query/index/memory passes on the D1 surface; read-only on prod, proposals-on
- **issue-review** — Fleet issue-audit seat — audits .team/taskboard.json for dispatch-vs-shipped drift, stale/duplicate/claimed-de
- **a11y-navigator** — Fleet accessibility seat — navigates GC, forum, and accounts keyboard-only with no visual CSS, using Tab/Enter
- **viewport-saboteur** — Fleet visual-adversary seat — renders GC/forum in Firefox (the mandated lane), mobile/split viewports, and thr

## Research, content & data

- **fact-checker** — Fleet devil's-advocate seat — challenges other seats' assumptions, re-verifies citations against live sources,
- **data-analyst** — Fleet data seat — writes and reads SQL over local D1 to answer board questions with counts and rows; never run
- **synthesizer** — Fleet synthesis seat — merges many-seat findings into one coherent, deduplicated technical narrative or spec; 
- **market-scout** — Fleet scouting seat — surveys competitor and ecosystem surfaces (feature slates, caps, pricing models) and fil

## Operations & meta

- **prompt-optimizer** — Fleet workflow seat — spots where seat briefs burn tokens or confuse agents and PROPOSES tightened brief/seat-

## Product & design

- **pm** — Fleet requirements seat — turns the owner's terse, half-typed directives into crisp user stories with acceptan
- **contract-architect** — Fleet contract seat — designs and audits cross-app contracts (cookie twins, shared-DB schemas, API response sh
- **persona-tester** — Fleet persona seat — walks product flows as scripted synthetic users (harried regular, power-user, first-timer

## Security & governance

- **red-teamer** — Fleet adversarial seat — attacks builder output with prompt injections, malformed payloads, SQLi strings, and 
- **compliance** — Fleet compliance seat — scans outputs, schemas, and third-party libraries for licensing conflicts, PII leaks, 
- **cost-monitor** — Fleet budget seat — tracks fleet spend against the owner's $1000 ceiling, flags run-away retry loops and bloat

## Simulation & decision-making

- **debate-moderator** — Fleet consensus seat — runs structured two-sided adjudications (opposing architecture/strategy briefs as /tmp 
- **chaos-eng** — Fleet chaos seat — injects simulated failures (expiring tokens, dropped sockets, 429s, clock skew, rate limits
- **tool-builder** — Fleet toolmaker seat — writes small reusable helper scripts/CLI wrappers when seats repeatedly do the same man

## Memory & self-improvement

- **learn** — Fleet post-mortem seat — after a landed lane/churn/defect arc, extracts the lesson and proposes a rules-file a
- **archivist** — Fleet memory seat — distills verified facts, idioms, and patterns from finished arcs into the durable memory/m
- **learn-eval** — Fleet output-grader seat — scores a seat report or landed lane on the 5-axis rubric (accuracy/completeness/cla

## Execution & flow-control

- **hitl-gate** — Fleet approval-batch seat — gathers sensitive-action requests (deploys, prod-D1 ritual steps, external sends) 
- **deadlock-breaker** — Fleet flow-control seat — detects circular seat handoffs (fix/review ping-pong) on the board's report trails a
- **sandbox-prov** — Fleet isolation seat — provisions detached git worktrees and local wrangler-dev/D1 sandboxes so parallel lanes

## Domain-specific & creative

- **localizer** — Fleet translation & cultural adapter seat — owns locale bundles and cross-language consistency for GC/forum/ac
- **growth-seo** — Fleet pre-publish seat — audits rendered pages for metadata/title/OG, semantic HTML landmarks, internal linkin
- **triage-router** — Fleet support seat — reproduces reported issues in a local sandbox and converts VERIFIED bugs into board ticke
- **lore-keeper** — Fleet canon seat — maintains the strict canon record (persona traits, timelines, world rules) for Wempo/Blaxel
- **asset-shader** — Fleet procedural-asset seat — SVG icons, CSS art, and canvas/canvas-compatible generative assets against the s
- **brand-voice** — Fleet copy-voice seat — rewrites drafts to the Wempo/Goober tone standard (casual, direct, no corporate filler

## Business & scientific

- **ceo** — Fleet executive seat — coordinates the agent-company across the 13-team map; coherence duty: spots cross-team 
- **legal-drafter** — Fleet legal seat — drafts ToS/Privacy/NDAs and open-source license headers matched to the fleet's ACTUAL data 
- **procurement** — Fleet API-broker seat — compares third-party API pricing/limits and drafts provider-swap plans; NEVER provisio
- **sales** — Fleet outreach seat — DORMANT-STANDBY by design (no prospects exist in a $0 community project); when the owner
- **finance** — Fleet controller seat — tracks the owner's $1000 ceiling line and the $0-revenue posture; books platform burn 
- **formal-verifier** — Fleet proof seat — converts critical fleet invariants (claim idiom, FK gaps, day-key arithmetic) into checkabl
- **divergent** — Fleet idea seat — deliberately generates unconventional high-risk feature/strategy ideas; a separate feasibili
- **patent-miner** — Fleet prior-art seat — cross-references papers/patents/datasets to check whether an idea already exists or lea
- **fitness** — Fleet selection seat — scores competing variants on speed/accuracy/cost, keeps the top survivors, and rules th

## Cybersecurity & purple team

- **threat-hunter** — Fleet log-forensics seat — tails tick logs, worker stderr, CF receipts, and auth-lane patterns for anomalies (
- **incident-cmd** — Fleet breach seat — on a CONFIRMED incident it drafts the containment/isolation/patch-sequencing brief and the
- **honeypot** — Fleet decoy seat — designs fake-endpoint/decoy-credential/dummy-data proposals that would trap attackers; LOCA
- **reverser** — Fleet reverse-engineering seat — maps what suspicious scripts/dependencies/bundles actually do under the hood 
- **red-teamer** — Fleet adversarial seat — attacks builder output with prompt injections, malformed payloads, SQLi strings, and 

## Multi-agent society & economics

- **trust-scorer** — Fleet reputation seat — tracks each seat's historical claim accuracy (learn-eval + deception-auditor findings 
- **norm-enforcer** — Fleet culture seat — audits teammate report language against the fleet's communication norms (no filler, recei
- **mediator** — Fleet de-escalation seat — steps into heated support threads or teammate conflicts, neutralizes hostility, the

## The final bosses

- **garbage-collector** — Fleet entropy seat — periodic sweeps that delete dead code, orphaned artifacts, stale docs, and rotted agent s
- **entropy-monkey** — Fleet veto seat — the Chaos Monkey of Entropy: deletes unused features, rips out dead flags, and issues stand-

## Evolutionary & self-replicating

- **mutator** — Fleet variant seat — takes a working artifact (prompt, brief, script, spec) and emits N randomized variations 
- **data-blacksmith** — Fleet synthetic-data seat — generates hard edge-case fixtures (malformed payloads, boundary histories, adversa
- **socratic** — Learning-lane seat — when the owner is BUILDING TO LEARN (a stated learning request), answers with guiding que

## Psychological & human-simulation

- **theory-of-mind** — Fleet owner-modeling seat — reads the owner's messages for unstated intent (frustration, skill level, hidden g
- **load-balancer** — Fleet summarization seat — collapses long teammate threads/tick rows into two-bullet digests so the owner's st
- **mediator** — Fleet de-escalation seat — steps into heated support threads or teammate conflicts, neutralizes hostility, the
- **persona-tester** — Fleet persona seat — walks product flows as scripted synthetic users (harried regular, power-user, first-timer

## Epistemic & truth-seeking

- **falsificationist** — Fleet anti-confirmation seat — when a hypothesis is winning, its ONLY job is to design (and locally run) exper
- **uncertainty-quantifier** — Fleet calibration seat — strips overconfident language from reports and replaces it with strict probability in
- **fact-checker** — Fleet devil's-advocate seat — challenges other seats' assumptions, re-verifies citations against live sources,

## Hardware, compute & infrastructure

- **inference-router** — Fleet model-switchboard seat — grades each incoming task (routine CRUD → haiku-class, normal build → sonnet-cl
- **prefetcher** — Fleet cache seat — predicts the next files/pages a teammate seat will need and pre-loads them into /tmp hand-o
- **cryo-archivist** — Fleet freeze seat — when a lane is paused (owner mass-stop, budget hold, blocked-on-owner), snapshots its stat
- **schema-guardian** — Fleet migration-law seat — owns the ordered migrations floor as single source of truth; blocks any lane whose 

## Cross-system cohesion & rewrite survival

- **dependency-sync** — Fleet cross-app sync seat — watches shared package/version surfaces across GooberCord, wempos-forum, and wempo
- **sso-tester** — Fleet federation seat — browser-tests the cross-app door swap (accounts login → forum ↔ GooberCord) for token 
- **dx-critic** — Fleet first-user seat — approaches Kitskey (or any fleet surface) as a brand-new developer with ONLY its gener
- **fanout-sim** — Fleet load seat — simulated concurrent-user pressure (logins, messages, thread posts, joins) against LOCAL wra
- **reconnect-saboteur** — Fleet session-adversary seat — drops connections, expires sessions mid-write, and simulates backgrounded tabs 
- **parity-shadow** — Fleet shadow-diff seat — runs identical inputs through an old implementation and its rewrite side-by-side and 
- **dead-abstraction** — Fleet YAGNI seat — audits new framework/API code for enterprise factories, wrappers, and interfaces with zero 

## Data, state & real-time protocol

- **cache-auditor** — Fleet consistency seat — audits in-memory/DO state and derived counters for staleness races (banned user still
- **search-sync** — Fleet indexing seat — verifies new forum posts, GC messages, and profile updates reach the fleet's search/stat
- **media-pipeline** — Fleet upload-seat — owns the shared upload lane across Chat and Forum: cap enforcement, type/malware checks, t
- **backpressure** — Fleet saturation seat — tests what happens when one channel/thread goes viral against LOCAL dev: limiter bindi
- **notif-aggregator** — Fleet cross-app notification seat — coordinates mentions, unread badges, and future notification lanes across 
- **budget-enforcer** — Fleet Workers-limit seat — audits request paths for subrequest counts, CPU ms, and response sizes against Clou
- **split-brain** — Fleet partition seat — simulates degraded backends (D1 unavailable, bindings missing, upstream dead) against L
- **service-binding** — Fleet cross-worker RPC seat — owns the FORUM_WORKER + ACCOUNTS_WORKER service-binding wiring for zero-latency 
- **do-specialist** — Fleet realtime seat — owns the Durable Objects design for GC's voice relay and any realtime rooms, with WebSoc

## Ecosystem & edge governance

- **feature-flag** — Fleet rollout seat — designs and audits progressive rollout flags (feature constants, staged locale gates) so 
- **gdpr-reaper** — Fleet deletion-integrity seat — drives 'Delete My Account' on LOCAL data through every table, derived row, and
- **api-advocate** — Fleet external-developer seat — approaches the platform ONLY through what is publicly documented (public endpo
- **cold-start** — Fleet boot seat — wipes local state to zero and verifies the four-part platform spins up from a migrations/see
- **viewport-saboteur** — Fleet visual-adversary seat — renders GC/forum in Firefox (the mandated lane), mobile/split viewports, and thr

## Compiler, runtime & distributed systems

- **leak-profiler** — Fleet soak seat — runs long-lived local sessions (wrangler dev + Firefox browser lane) under sustained simulat
- **ast-codemod** — Fleet migration-automation seat — writes AST/codegen transform scripts that mechanically port legacy app code 
- **runtime-compat** — Fleet runtime seat — verifies fleet code runs clean across its REAL runtimes (Cloudflare Workers + browser + n
- **nodejs-compat** — Fleet polyfill seat — scans framework/account/GC worker-bound code for Node-only APIs (fs, child_process, nati
- **idempotency-verifier** — Fleet replay seat — captures request shapes (create post, send message, claim username, coin claim) and replay
- **snowflake-auditor** — Fleet ID-ordering seat — audits the fleet's ID generation (D1 rowid/autoincrement, timestamps, composite keys)
- **clock-skew** — Fleet temporal-integrity seat — audits every time-dependent path (session expiry, message ordering, edit times
- **deadlock-hunter** — Fleet write-contention seat — fires simultaneous writes at the same rows (profile edits, thread counters, role

## Human-edge & accessibility

- **a11y-navigator** — Fleet accessibility seat — navigates GC, forum, and accounts keyboard-only with no visual CSS, using Tab/Enter
- **low-end-device** — Fleet constrained-device seat — emulates low-RAM, throttled-CPU conditions in the Firefox lane to prove the GC
- **offline-sync** — Fleet draft-durability seat — cuts connectivity mid-draft (forum compose, DM, settings edits) and proves local

## Standing not-applicable rulings (owner-endorsed, no seat files)

- **Physical/IoT trio** (spatial planner, sensor fusion, hardware watchdog): no physical systems in this fleet.
- **WebRTC/voice signaling**: voice is the DO relay BY OWNER RULING (no WebRTC/TURN lane exists).
- **Bundle-size & tree-shaking enforcer**: vanilla ES modules, no bundler by law.
- **Market maker/auctioneer**: no internal compute billing.
- **Diplomat**: no cross-org counterpart exists.
- **Provenance tracker (standalone)**: the parity-citation law (every claim carries source URL + date) embodies it; auth-route evidence rides ecc-security.
- **Bot & third-party API dev surfaces**: owner-DECLINED category (api-advocate audits from public docs only).

## Special-purpose composites (owner pasted; all map onto seated roles)

- **Mutator + Fitness** for framework rewrites: 3 competing implementations, benchmark winner kept -> `mutator` + `fitness`.
- **Falsificationist** for the Discord clone: adversarial load tests desyncing message ordering / crashing WebSocket state -> `falsificationist` (lane in charter).
- **Uncertainty & Provenance tracker for auth**: every auth route linked to a verified security spec, low-confidence logic flagged before merge -> `uncertainty-quantifier` + `ecc-security` gates.
- **Inference Router + Cold-Storage archivist** for token burn: routine CRUD to cheap models, frontier kept for core + auth -> `inference-router` + `cryo-archivist`.

*remember ALL THE AGENTS OF THE TEAM* — owner, 08:34 EST Nov 17. This file is that order, landed.
