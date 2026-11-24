---
name: block-skip-permissions
enabled: true
event: bash
pattern: --dangerously-skip-permissions|--permission-mode[\s=]+bypassPermissions
action: block
---

🚫 **Skipping permissions is banned** (owner rule: "Never use dangerously-skip-permissions flag").

For headless runs use `--permission-mode auto` (as the launchd feature loop does) and configure allow rules in settings instead.
