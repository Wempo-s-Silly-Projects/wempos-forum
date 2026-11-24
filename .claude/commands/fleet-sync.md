# /fleet-sync

Morning/return briefing for the Wempo's Forum fleet. Read-only; changes nothing.

1. Read `.team/taskboard.json` — list OPEN/claimed rows (id, status, claimed_by) and the board_version.
2. Count seats: `ListAgents` — running vs idle; name the running ones with their lane.
3. Probe prod: `curl -s https://wempos-forum.com/api/version` — report `{version, commit}` and flag an empty or mismatched `commit` immediately (a bare `wrangler deploy` drops the stamp — redeploy with `pnpm run deploy`).
4. Probe the locale funnel: `/locales/en.json` must be 200 json; a missing locale (e.g. `/locales/zz.json`) must be 404 once v5.2 ships (200 text/html before it).
5. Check recent commits (`git log --oneline -5`) and whether pushed tips equal prod's build half.
6. Collect any unreported teammate verdicts still owed (T30+ lanes) and list them as pending.
7. End with: blockers, owner-gated decisions awaiting the owner and the top 3 next actions.

Append the briefing timestamp + one-line status to `.remember/now.md`.
