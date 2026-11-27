# Feature slate 2026-11-22-b (wave B, v5.73.0, MINOR)

Owner approval: Nov 22 12:32 ("Yes to 1, 2, 3, 4, 5, 6, and 7": items 2 and 6), Nov 22 13:31 ("do wave b"), and Nov 22 13:32 ("use polyfill just in case … for people who CANT UPDATE"; the polyfill itself shipped as v5.71.2, and the no-module notice stays here).

Client-only: no new routes, no D1 changes, no migrations, no storage keys. Branch `wave-5-73-0` is cut from `main` @ 9b1cb23. The launchd loop holds v5.72.0 (language wave, `wave-5-72-0`), so this wave rebases onto `main` after 5.72.0 merges and takes 5.73.0.

## B1: shrink-wrapped DM bubbles
- **What:** in the DM thread view, a short message's bubble is only as wide as its text. Long messages still wrap at the 78% cap.
- **Where:** `public/styles.css`, `.dm-thread-view .chat-message-body` (~2344) and `.chat-message.chat-mine .chat-message-body` (~2360). Use `width: fit-content; max-inline-size: 78%`. Align `.chat-mine` to the end with logical properties so RTL locales are correct.
- **Progressive enhancement:** any anchor-positioning polish goes inside `@supports (anchor-name: --x)`. The plain fit-content plus cap is the baseline and needs no JS.
- **Roselli rule:** no control changes size when its state changes. Bubble width depends only on content (never hover, focus or selection), and the message action buttons keep fixed inline and block sizes.
- **Must keep working:** easy-reading mode and relaxed line spacing (~3360/3372), GIF, image and jumbo-emoji bodies, and the lobby chat (~2849, unchanged).
- **Tests:** a CSS pin for fit-content plus the `max-inline-size` cap on the DM body, logical end-alignment for `.chat-mine`, and no width change inside `:hover`/`:focus` rules for those selectors.

## B2: in-house code highlighting (CSS Custom Highlight API)
- **What:** fenced code blocks get keyword, string, comment and number colours, using theme tokens that meet WCAG AA in both light and dark themes.
- **How:** a new `public/js/code-highlight.js` tokenizes each `pre > code` text node and registers `Range`s with `CSS.highlights.set("code-keyword", new Highlight(...))` etc. **It never mutates the DOM**: no spans and no innerHTML, so there is zero new XSS surface. Colours come from `::highlight(code-keyword) { color: var(--code-keyword) }` etc. in `styles.css`.
- **Feature detection:** `if (!globalThis.CSS?.highlights) return;`. Older browsers show plain code (today's behaviour). No polyfill, no third-party library.
- **Tokenizer:** a small generic lexer that picks keyword sets from the fence info string (`js`/`ts`, `py`, `sh`, `json`, `css`, `html`, otherwise the generic C-like set). It handles strings (with escapes), numbers, and `//`, `#` and `/* */` comments. Blocks over `CODE_HIGHLIGHT_MAX_CHARS` (new, in root `constants.mjs`) are skipped.
- **Hooks:** run after a body renders: post bodies (`markdown.js` / `render.js` fence output, `wall.js`) and chat and DM message bodies. Re-highlight on re-render, and remove stale ranges when a node leaves the DOM (rebuild the highlight sets from the connected blocks each pass). `copy-code.js` must still copy plain text.
- **Defaults law:** a pure presentation change, not activity-revealing, so it's on by default. `@media (prefers-contrast: more)` uses stronger tokens. Forced-colors mode leaves code plain.
- **Strings:** none expected. If any are added, the key goes into `en.json` and every locale, really translated.
- **Tests:** tokenizer units (keywords, strings with escapes, unterminated string, comments, numbers, info-string selection, size-cap skip); a no-DOM-mutation pin (the `<code>` child count and text are unchanged); a no-op when `CSS.highlights` is missing; `::highlight` tokens defined for both themes with contrast ≥ 4.5:1 against the code background (extend the existing contrast tests).

## B3: no-module notice (for people who can't update)
- **What:** browsers that can't run ES modules currently see a blank page. Instead they get a short, readable notice.
- **How:** in `public/index.html`, a `<noscript>`-style static block hidden by default. A `nomodule` script must be a same-origin `/js/*.js` file (pinned by `wave528`), for example `/js/legacy-notice.js`, written as plain ES5 with no modules, that un-hides it. Text: English plus a link to how to update the browser. No external origins.
- **Tests:** the notice exists in `index.html`, is hidden by default, the `nomodule` script is the same-origin ES5 file (no arrow functions, `let`/`const` or `import`), and the `wave528` script-tag pin still passes.

## Ship-review applicability
No new reads, writes, routes, storage or migrations. Checks 1–4 and 7 are N/A; 5, 6, 8 and 9 apply. AGPL headers go on every new `.js` and `.css` file. VERSION 5.73.0 in `package.json` and `wrangler.toml`, a CHANGELOG entry, and `.team/release-5.73.0.md`.
