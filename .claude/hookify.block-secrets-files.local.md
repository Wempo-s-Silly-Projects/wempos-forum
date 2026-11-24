---
name: block-secrets-files
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: (^|/)(\.dev\.vars|\.env(\.[\w.-]+)?)$
action: block
---

🚫 **Secrets files are owner-held** (AGENTS.md: ".dev.vars, .env and .env.* hold real credentials, and are never printed or committed"; secrets go in via stdin only).

Do not create, edit or overwrite them. Ask the owner, or use `wrangler secret put` with the value piped from stdin.
