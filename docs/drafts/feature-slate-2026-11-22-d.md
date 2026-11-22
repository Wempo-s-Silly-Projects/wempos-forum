# Feature slate 2026-11-22-d (B2, v5.74.0, MINOR): vendored Prism highlighting

Supersedes B2 in `feature-slate-2026-11-22-b.md`, which planned an in-house CSS Highlight API version. Owner approval: Nov 22 ("Full Prism (span markup)"), then the plugin set confirmed through three builds, and finally "non minified:". Final build: Prism 1.30.0, all languages, non-minified (`prism.yay.js`, sha256 `918b44fb3f752ac35614f73a0f219569f4b162034614eb265191cec747baa945`). The readable file ships per the FSF "JavaScript Trap" posture; it is about 228 KB with brotli and loads only on pages that contain code.

Plugins (16): line-numbers, show-invisibles, custom-class, file-highlight, show-language, jsonp-highlight, highlight-keywords, inline-color, previewers, autoloader, unescaped-markup, normalize-whitespace, toolbar, match-braces, diff-highlight, treeview. Not in the build (refused): autolinker, wpd, data-uri-highlight.

## Identity
- `public/js/vendor/prism.js` is the downloaded file, byte-for-byte, with no added banner. The vendored-verbatim note goes in REUSE.toml, like `api/vendor/**`: a `[[annotations]]` block with `public/js/vendor/**`, `SPDX-License-Identifier = "MIT"` and `SPDX-FileCopyrightText = "Lea Verou and PrismJS contributors"`, plus `LICENSES/MIT.txt`. A test pins the sha256.
- `prism.css` is not shipped. Its colours fail 4.5:1, it has no dark theme, and the treeview data: font is blocked by CSP (`font-src` falls back to `default-src 'self'`). We write our own scoped theme in `public/styles.css`.

## Behaviour
- Manual mode, lazy-loaded. Only when a rendered body contains `pre > code`:
  1. Load our AGPL `/js/prism-config.js`, which sets `window.Prism = { manual: true }`.
  2. Load the same-origin `/js/vendor/prism.js` once, with `data-autoloader-path="/js/vendor/components/"`.
  3. Call `Prism.highlightElement(code)` on each new block.

  CSP is unchanged.
- Scope: fenced blocks in post bodies, chat and DM bodies. Inline `code` stays plain.
- Language class: the renderer sanitises the fence info string to `[\w-]{1,32}`; anything else becomes `language-none`. Autoloader can therefore only request `/js/vendor/components/prism-[\w-]+.min.js` (same-origin; 404 for unknown names, since every language is bundled).
- Line numbers: class `line-numbers` only on blocks with at least `CODE_LINE_NUMBERS_MIN_LINES` (new constant, 5, root `constants.mjs`) lines.
- Size cap: blocks over `CODE_HIGHLIGHT_MAX_CHARS` (new constant, 20000) stay plain.
- `copy-code.js` still copies plain `code.textContent`. Show Language rides the Prism toolbar; no Prism copy button.
- Inline Color: its swatch is CSP-blocked, so hide `.inline-color-wrapper`; Previewers covers colour on hover.
- Previewers and Match Braces are hover-only and visual. Under `prefers-reduced-motion: reduce`, the previewer transition and timing animation are off.

## Theme (styles.css)
- Token colours (comment, punctuation, keyword, string, number, function, class-name, operator, regex/important, deleted/inserted), scoped to the code-block containers. Each must reach at least 4.5:1 on the code background in light and dark themes (extend the contrast tests).
- `prefers-contrast: more` uses stronger tokens. `forced-colors: active` is plain `CanvasText`.
- Plugin layout:
  - line-numbers gutter (logical properties, RTL-safe);
  - toolbar label, visible on `:focus-within`;
  - diff backgrounds;
  - previewer tooltip;
  - treeview lines drawn with Unicode glyphs in place of the blocked font.

## Strings
None expected; language labels are code names. Any new string goes in en.json plus all 65 locales, really translated.

## Tests (RED first)
- The vendor sha256 is pinned; the REUSE annotation and `LICENSES/MIT.txt` exist; no `prism.css` under public/.
- The loader is idempotent (one script), only fires when `pre > code` exists, sets manual mode before the vendor script, and uses a same-origin src.
- Sanitiser: `js` → `language-js`; `../x`, `a b`, `"><img` and 33+ characters → `language-none`.
- Size cap and line-number threshold; copy-code yields plain text after real Prism highlighting (via `vm`).
- Token contrast is at least 4.5:1 in both themes; forced-colors and reduced-motion rules are present.
- CSP is unchanged.

## Ship-review
New client asset only: no routes, no D1, no storage keys. Checks 1–4 and 7 are N/A; 5, 6, 8 and 9 apply. VERSION 5.74.0, CHANGELOG, `.team/release-5.74.0.md`.
