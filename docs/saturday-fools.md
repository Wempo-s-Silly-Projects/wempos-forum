# Saturday Fools

Every Saturday the forum ships one silly, harmless gag that lives for that
day only. On Sunday it is deleted from the codebase. The Saturday release is
labelled an **April Fools version**.

The gag runs on each visitor's *local* Saturday (`Date#getDay() === 6`) and
switches off at their local midnight. Members can't opt out. Only the owner
can turn it off:

- **Per deployment:** `SATURDAY_FOOLS = "on" | "off"` in `wrangler.toml`
  `[vars]`. The code default is `"off"`; Wempo's Forum sets `"on"`.
- **Site-wide off switch:** Staff desk → Branding → "Saturday Fools". Only
  the owner sees it (the API answers 403 to admins and members). It is stored
  in the `site_settings` row `saturday_fools_off` (`"1"` = off), so it needs
  no migration.

With either switch off, the page shell has no
`<meta name="saturday-fools" content="on">`. Without that meta, the client
never downloads any gag code. With it, `public/js/fun-gate.js` imports
`public/js/fun/saturday-fools.js` only on a local Saturday. The framework then
looks in `public/js/fun/saturday-fools/index.js` for the gag dated today. If
no gag has today's date, nothing happens. There is no fallback pool.

A small banner names the gag: "🃏 Saturday Fools: <name>". Closing it hides
the banner for the rest of the day. The gag keeps running.

## What stays (the framework)

Keep these files when you strip a gag:

| File | Role |
|---|---|
| `api/saturday-fools.mjs` | Env mode, owner switch, shell meta, `/api/admin/saturday-fools` |
| `constants.mjs` (`SATURDAY_FOOLS_*`) | Modes, default, settings key |
| `worker.mjs` (`saturday-fools` meta) | Stamps the meta into the shell |
| `public/js/fun-gate.js` | Lazy seam: meta on + local Saturday → import |
| `public/js/fun/saturday-fools.js` | Dated pick, midnight auto-off, reduced motion, banner |
| `public/js/fun/saturday-fools/helpers.js` | Accessibility + CSP helpers for gags |
| `public/js/fun/saturday-fools/index.js` | The gag list (can be empty) |
| `public/js/desk/saturday-fools.js` | Owner-only desk switch |
| `public/styles.css` (`.fools-banner`) | Banner styles |
| `fools.banner`, `desk.fools.*`, `admin.msg.foolsSaved` | Framework strings |
| `tests/saturday-fools.test.mjs` | Framework tests (they run with zero gags) |

## (a) How to ADD a gag

Take the Saturday's date, e.g. `2026-12-05`. Write it as `yyyymmdd`
(`20261205`) where a dash isn't allowed. Then add these five pieces:

1. **The module** `public/js/fun/saturday-fools/<date>-<slug>.js`
   (e.g. `2026-12-05-comic-sans.js`). Start it with the 19-line license
   header. The default export is a frozen object:

   ```js
   export default Object.freeze({
     id: "2026-12-05-comic-sans",   // "<date>-<slug>", same as the file name
     date: "2026-12-05",            // must be a Saturday
     name: "fools.20261205.name",   // t() key for the banner
     motion: false,                 // true if anything moves
     apply(doc, ctx) { /* … */ return () => { /* undo everything */ }; },
     reducedMotionApply(doc, ctx) { /* still variant: required when motion is true */ },
     enhance(root, ctx) { /* optional: runs after each route render */ },
   });
   ```

   `apply` must return an undo function that removes everything it added.
   If `motion` is true and there is no `reducedMotionApply`, the gag is
   skipped for visitors who ask for reduced motion.

2. **Two index lines** in `public/js/fun/saturday-fools/index.js`, both
   tagged with the date:

   ```js
   import gag20261205 from "./2026-12-05-comic-sans.js"; // saturday-fools:2026-12-05
   …
     gag20261205, // saturday-fools:2026-12-05
   ```

3. **One CSS block** at the end of `public/styles.css`, between delimiters.
   Scope every rule under a class that `apply` puts on `<html>`:

   ```css
   /* saturday-fools:2026-12-05 start */
   .fools-2026-12-05 body { font-family: "Comic Sans MS", "Comic Neue", cursive; }
   /* saturday-fools:2026-12-05 end */
   ```

4. **Strings** under `fools.<yyyymmdd>.*` (at least `.name`). Add them to
   **every** file in `public/locales/`, really translated.
   `tests/i18n.test.mjs` and the no-copy sweep must stay green.

5. **One test** `tests/saturday-fools-<date>.test.mjs`. It should show that
   the gag is picked only on its date, that undo restores the page, that
   accessible names are unchanged, that no listener is added to a form, and
   what happens under reduced motion. Keep the strings and CSS checks too.

### Rules every gag follows

- **Cosmetic only.** No network calls, no stored data. Never block or change
  posting, replies, moderation, sign-in, settings or any form submit. Never
  add a listener to a form or a submit button.
- **CSP-safe.** No inline `<style>` text, no `innerHTML`, no new third-party
  script and no CDN. Put CSS in the delimited block. If CSS needs a
  translated string, pass it through a custom property set with the CSSOM
  (`setCssVar` + `cssString` from `helpers.js`).
- **Accessible.** Accessible names stay the real labels (use
  `preserveAccessibleName` before repainting a label, and hide generated text
  with `content: … / ""`). No flashing (WCAG 2.3.1). No layout shift that
  hides a control. Every moving gag has a reduced-motion still variant, or it
  is skipped.
- **Sound** only after a direct click by the visitor, never on its own.
- **Free software only.** Use code that is already vendored, or your own
  AGPLv3 code.

## (b) How to STRIP a gag (Sunday)

For gag `<date>` = `2026-11-28` (`yyyymmdd` = `20261128`), delete:

1. The module `public/js/fun/saturday-fools/2026-11-28-yell.js`.
2. Both lines tagged `// saturday-fools:2026-11-28` in
   `public/js/fun/saturday-fools/index.js`.
3. The block from `/* saturday-fools:2026-11-28 start */` to
   `/* saturday-fools:2026-11-28 end */` (inclusive) in `public/styles.css`.
4. Every `fools.20261128.*` key in **all** `public/locales/*.json`.
5. The test `tests/saturday-fools-2026-11-28.test.mjs`.

Then run `node --test --test-reporter=tap` (`# fail 0`) and `pnpm lint`. The
framework tests run with zero gags and must stay green. Don't touch any of
the framework pieces listed above.

## (c) Release labelling

- **Saturday release** (the gag ships): a **MINOR** bump.
  - CHANGELOG heading: `## [X.Y.0] - <date> (April Fools version)`
  - GitHub release title: `vX.Y.0 — April Fools version 🃏 (Saturday Fools: <name>)`
- **Sunday release** (the gag is stripped): a **PATCH** bump.
  - CHANGELOG heading: `## [X.Y.1] - <date>`, entry "Saturday Fools <date> removed".
  - GitHub release title: `vX.Y.1 — Saturday Fools <date> removed`

Tag every shipped version as usual (`vX.Y.Z` + GitHub Release).

## (d) IDEAS for future weeks

Each one is cosmetic, reversible and CSP-safe, and has a reduced-motion
plan:

- **Comic Sans Saturday:** the whole UI in Comic Sans (static).
- **Upside-down avatars:** every avatar rotated 180° (static).
- **Slow-spinning logo:** the header logo turns once a minute (still: tilted 8°).
- **Quack reactions:** a tiny ZzFX quack, only when *you* click a reaction.
- **🍝 cursor trail:** spaghetti follows the pointer (vendored cursor-effects; skipped under reduced motion).
- **"A while ago":** every relative timestamp reads "a while ago" (the `title` keeps the real time).
- **Wonky headings:** page headings tilted 1° (static).
- **Wobbly buttons:** buttons wobble on hover (still: no wobble).
- **Did you know?:** one obviously fake fact toast per session (dismissible, `role="status"`).
- **Pirate nav:** a few nav labels in pirate English (en only; other locales get a localized playful variant or skip).
- **Shy scrollbar:** the scrollbar thumb is shaped like a tiny duck (static, Firefox `scrollbar-color` fallback).
- **Serif Saturday:** everything in an overly fancy serif (static).

Never: random dark/light flips or anything else that flashes.
