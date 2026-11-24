---
name: wempos-forum-agent-fanout
description: "Use when any request arrives in the Wempo's Forum fleet — every request is prefaced by the fanout question 'should there be more agents?' before work starts"
metadata:
  version: 1.1.0
  source: owner-order-2026-11-18 (re-verified 2026-11-21)
---

# Wempo's Forum Agent Fanout

The owner's standing reflex order: run EVERY request through the question
**"should there be more agents?"** and answer it explicitly, in one line,
before any work starts. Never silently skip the answer.

Then route by this table:

| Answer | Route |
|---|---|
| YES — multi-file or cross-app work | Field seats: one `.team/taskboard.json` row per seat, Section Q echoed verbatim + the 5-line report contract (STATUS/EVIDENCE/BLOCKERS/NEXT_ACTIONS/OWNER_GATED) in every prompt. |
| YES — independent reads/verdicts | Parallel same-message dispatch (e.g. reviewers); single collection pass after. |
| NO — single-file fix, one lookup, or a check with a known target | Do it inline; spawning is waste (Section Q law 1). |
| NO — the work is already claimed | Name the running seat and wait; never double-dispatch. |

Hard caps (override any YES):
- No seat without a board row — the row is the waste receipt.
- `.claude/agents/` is EMPTY: seats are generic/`ecc:*` agents with the seat
  charter (AGENTS.md index line) pasted into the brief.
- Never spawn past the seats the lane needs; re-verify (suite, probes) is the
  lead's job, not a new spawn. Budget ceiling $1000 — no idle bulk spawns.
- If you delegate, you collect: never end a turn "waiting" on children.
- If the answer is YES purely from enthusiasm, answer NO — the question is a
  routing check, not a growth engine.
