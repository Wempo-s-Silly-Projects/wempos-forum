# Feature slate — wave 2026-11-21-3 (release v4.8.0, i18n gap closure)

Through-line: **every member reads the forum in their own language, layout
and clock** — close the three i18n gaps the 4.6.0 report left open, plus two
small writer-side touches that make posts more fun to compose.

Laws every feature rides: vanilla ES modules + 17-line AGPLv3 header on new
files; createElement/textContent only; fetch only through the one `api()`
wrapper; `api/vendor/**` untouched; no migration (none of these features
stores anything new); every painted string keyed in `public/locales/*.json`
(21 tables, real translations, placeholder parity).

## F1 — i18n gap closure (from the 4.6.0 report)

**(a) Stable error codes.** 318 `HttpError` throw sites carry English text.
Rewriting every site is out of proportion, so ONE table
(`api/core/error-codes.mjs`) maps the exact English text of ~50 member-facing
messages to a stable snake_case code. worker.mjs's `/api/*` catch swaps the
vendor `errorReply` for `codedErrorReply`, which adds `code` beside the
unchanged `error` text (additive: existing clients and MCP keep working;
payload replies such as the ban screen are passed through untouched; `/mcp`
keeps English). The client `api()` wrapper paints `t("errors.<camelCode>")` when
the key exists and falls back to the server's English text otherwise.
Ops-only messages (503 "not configured", relay) stay uncoded on purpose.
Acceptance: every table message exists verbatim in `api/` source (drift
guard), every code has an `errors.<camelCode>` key (locale keys are camelCase), a real 404/401/429 response
carries `{error, code}`, uncoded errors carry no `code`.

**(b) Logical CSS properties.** The physical `left/right` rules in
`public/styles.css` and `public/responsive.css` (margins, paddings, borders,
text-align, positioned offsets) become `margin-inline-start`,
`padding-inline-end`, `border-inline-start`, `text-align: start/end`,
`inset-inline-start/end`, so `ar` and `he` (dir=rtl) mirror correctly.
Deliberate exception: centering math (`left: 50%` + translate) and symmetric
`left: 0; right: 0` pairs stay physical — they are direction-neutral.
Acceptance: a static pin finds no asymmetric physical left/right rule.

**(c) Locale-aware times.** New `public/js/reltime.js`:
`formatRelative` (Intl.RelativeTimeFormat, narrow style, numeric:auto) and
`formatDuration` (Intl.DurationFormat narrow when the runtime has it,
otherwise Intl.NumberFormat unit-narrow parts joined by Intl.ListFormat).
The ban countdown (banned screen + profile ban line) and the chat widget's
"5m / 2h / now" stamps use it in the active locale. No new strings.
Acceptance: both duration paths produce the same units; ar/ja output differs
from English; the countdown keeps its "drop leading zero units, always show
minutes, 0 once expired" contract.

## F2 — UNIQUE: Spoiler tags (`||like this||`)

Writers wrap text in `||…||`; it renders blacked-out as a focusable button
("Spoiler — press to reveal"), and a click, Enter or Space reveals it for
that reader only. Preview snippets on feed cards mask spoilers as `▒▒▒`, so
the ending of a show is not given away in the latest-replies strip.
Why: a small warm community talks about games, shows and books; spoiler
tags are the single most requested formatting nicety on chat-style forums,
cost nothing server-side (bodies are stored raw), and are entirely opt-in —
nothing changes for a post that does not use them. Accessible: the hidden
text is not read out until revealed (aria-label on a role=button).
Acceptance (RED first): `||x||` → one `.spoiler` node with the text, role
button, tabindex 0; unterminated/empty `||` stays literal; reveal removes
the role/label; `maskSpoilers` hides the text in snippets.

## F3 — UNIQUE: Composer Preview toggle

A "Preview" toggle (aria-pressed) on every post/reply composer opens a live
pane under the textarea, rendered by the SAME renderer posts use (markdown,
mentions, links, spoilers) and refreshed as the member types; pressing it
again closes the pane. Empty drafts say "Nothing to preview yet." The
textarea always stays visible (hiding a `required` field would break native
form validation). Client-only, opt-in per click, nothing is sent anywhere.
Why: members already write markdown and now spoilers; seeing the post before
it goes live removes the edit-after-posting churn (edit history makes every
fix visible to everyone) and is gentle for first-timers.
Acceptance (RED first): the composer wires `attachComposePreview`; the
toggle carries aria-pressed; preview renders via `renderBodyBlocks`; the
textarea value is never altered.

## Release
v4.8.0 (wrangler.toml production VERSION + package.json). No migration.
Notes: `.team/release-4.8.0.md` (≤4500 chars, member-facing).
