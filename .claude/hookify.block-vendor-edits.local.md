---
name: block-vendor-edits
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: (api/vendor/(db|http)\.mjs|public/js/vendor/)
action: block
---

🚫 **Vendored files are never touched** (AGENTS.md hard pin: `api/vendor/db.mjs`, `api/vendor/http.mjs` and `public/js/vendor/**`).

Make the change in the calling code instead. Only an explicit owner-ordered recode lifts this.
