---
name: block-secrets-read
enabled: true
event: bash
pattern: \b(cat|less|more|head|tail|bat|grep|rg|git\s+add)\b[^\n|;]*(^|[\s/'"=])(\.dev\.vars|\.env(\.[\w-]+)?)\b
action: block
---

🚫 **Never print or stage secrets files** (`.dev.vars`, `.env`, `.env.*` — owner-held, never printed, never committed).

If you need to know whether a variable exists, check for the key name only (e.g. `grep -c '^KEY=' file`) — never output values.
