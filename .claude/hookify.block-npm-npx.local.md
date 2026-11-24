---
name: block-npm-npx
enabled: true
event: bash
pattern: (^|[\s;&|(`$])(npm|npx)(\s|$)
action: block
---

🚫 **npm / npx is banned in this repo** (AGENTS.md: "pnpm/pnpx only — never npm/npx").

Use the pnpm equivalent instead:
- `npm install` → `pnpm install`
- `npx <tool>` → `pnpm dlx <tool>` (or `pnpm exec <tool>` for a local dependency)

pnpm lives at `~/Library/pnpm/bin` since the 10:31 self-update — prefix `export PATH="$HOME/Library/pnpm/bin:$PATH";` if `pnpm` is not found.
