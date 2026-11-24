---
name: wempos-forum-feature-wave
description: "Use when the owner asks for new or unique features, a slate of ideas, or a wave of build lanes in Wempo's Forum — before dispatching any seat or writing any feature code"
metadata:
  version: 1.1.0
  source: owner-ordered-waves 2026-11-18..21 (re-verified 2026-11-21 at v5.0.0)
---

# Wempo's Forum Feature Wave

The standing chain for feature work. Worked examples: `docs/drafts/feature-slate-2026-11-21-*.md`. Never skip a phase:

1. **Slate** — `docs/drafts/feature-slate-<date>-<n>.md` first: each feature's identity, routes, visibility law, strings, tests. No code yet.
2. **Board** — one `.team/taskboard.json` row per wave/feature.
3. **Brief** — Section Q echoed verbatim + the 5-line report contract (STATUS/EVIDENCE/BLOCKERS/NEXT_ACTIONS/OWNER_GATED; there is no template file — paste it).
4. **Who commits (reality, both stated honestly)** — the wave's ONE lead seat builds on its own branch `wave-<date>-<n>` in an isolated worktree, writes RED tests first, and commits there. Parallel helper seats spec/test only and do NOT commit. The fleet lead merges to main, pushes and deploys under standing authority (Section A + owner's "go as high as possible"); an owner interruption stops it.
5. **Implement** — RED first, then GREEN; mutation-check new visibility tests.
6. **Feature laws (every lane)**:
   - Defaults law: anything activity-revealing or behavior-changing is OPT-IN, never default-on (FSF privacy posture; network actions explicit).
   - Visibility law on every new read (wempos-forum-visibility-law); spoiler masking on every preview.
   - Strings: every painted string rides a `t()` key; the forum's own translations (Crowdin removed, pinned by `tests/i18n.test.mjs`) — fill the key in `en.json` AND all 20 other locales in `public/locales/`, really translated (key + placeholder parity, no copy-of-English).
   - Caps/limits from root `constants.mjs` (never re-declared); new storage keys account-scoped + wiped.
   - Migrations CREATE-only with a fresh number not in the remote ledger (see wempos-forum-ritual).
7. **Suite** — `pnpm test` green bound to the SHA in an isolated detached worktree (`git worktree add --detach <scratch>/verify <sha>`); never gate a git chain behind `| grep`.
8. **Commit** — conventional subject naming the behavior; bump `package.json` + `wrangler.toml` VERSION; ends `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
9. **Ship** — ship-review verdict, then `pnpm run deploy` ONLY (never bare `pnpx wrangler deploy`) and the deploy probes in wempos-forum-wave-lead.
