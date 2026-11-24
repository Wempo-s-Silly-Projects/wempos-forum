# Wempo’s Forum — agent roster

Moved out of [AGENTS.md](AGENTS.md) on 2026-11-22 (owner order) so the rules file stays short. AGENTS.md remains the source of law; this file is the seat index.

Seats are spawned per task and dissolved afterwards; nothing idles. There are
no committed seat agents (no `.claude/agents/` folder), so when you field a
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
