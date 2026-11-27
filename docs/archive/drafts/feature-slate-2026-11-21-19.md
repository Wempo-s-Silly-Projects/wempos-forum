# Feature slate — wave 2026-11-21-19 (v4.24.0)

A hardening pass over v4.21–v4.23 plus one small member feature. No
migration. No new route. Nothing new is stored.

## F1 — Hardening review of v4.21–v4.23 (1791118..125ec91)

| Surface | Verdict |
|---|---|
| `POST /api/me/notifications/read-thread/:id` | PASS — `requireUser` (Origin + CSRF), own rows only, label-less rows only, write bounded by an inner LIMIT |
| Notification grouping (client) | PASS — groups on the same `target_post_id` the server marks; labelled rows stay single |
| Poll "Your vote" + percent | PASS — results were already public for everyone (api/polls.mjs); `viewerOption` is the caller's own vote only |
| Search highlight | PASS — `indexOf` on lowercased text, no RegExp from user input; text nodes + `<mark>` only |
| `maskSpoilers` edge cases | PASS — unterminated `||` stays literal; code spans are not masked (they render literal); inner text of bold/strike/link/italic stays literal, as rendered |
| `maskSpoilers` cost | **MEDIUM, fixed** — public/js/markdown.js `parseInline` rescanned to the end per marker: a 4,750-char `||a|| ****…` body cost ~64 ms CPU on every masked server path (feed snippets, MCP, markdown, archive). Now a per-marker forward cache; ~0.6 ms. Output proven identical by a 400k-input differential fuzz against the old parser (mask strings, rendered nodes and spoiler ranges) |
| `maskedExcerpt` cut | **LOW, fixed** — a cut landing between an emoji's UTF-16 halves left a lone surrogate (shown as �); it now backs off one unit |
| 11 masked paths | PASS — MCP `get_post` masks for the author too (by design: agents read what the page shows before a click) |
| `GET /api/me/export` | PASS — every query keyed on the caller, explicit columns; DM partner resolved for both `user_a` and `user_b`; group messages from groups the caller left are their own words (kept); filename carries the numeric id only; per-member `write` limiter |
| data-export client, settings filter | PASS — fetch only on click via `api()`, Blob URL revoked in `finally`; no HTML sinks |

## F2 — Ctrl+Enter / Cmd+Enter posts

`public/js/submit-shortcut.js`: `isSubmitShortcut(event)` (Enter + Ctrl or
Cmd; never during IME composition, never with Shift/Alt) and
`attachSubmitShortcut(document, textarea)`, which sets
`aria-keyshortcuts="Control+Enter Meta+Enter"`, submits via
`form.requestSubmit()` (built-in validation + the one submit handler and its
in-flight guard), and returns a muted hint line. `createTextarea` gains an
opt-in `submitShortcut` flag; the new-post/reply composer, the edit composer
and the wall composer pass it. The hint is hidden on touch-only screens
(`hover: none` + `pointer: coarse`).

## Strings

`composer.sendShortcut` — en + all 20 locales.

## Tests

tests/wave19.test.mjs (8): linear-time mask budget, mask characterization,
surrogate-safe excerpt, shortcut key matrix, requestSubmit wiring, in-flight
guard, hint + opt-in, call-site/locale/CSS pins.
