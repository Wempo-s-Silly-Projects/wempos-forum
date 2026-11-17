// Project Designer — frontload/tokens
// The token/applicator half of the appearance system, extracted from
// GooberCord's public/js/theme.js (which itself was ported from the forum's).
// The framework keeps the EXACT behavior and shapes, generalized by the one
// thing that actually differs between the apps: the storage key family (each
// app owns its own "xxx-theme"/"xxx-skin" keys and keeps prior homes as
// read-only legacy reads) and the browser-chrome color map (per-app palette).
// Injected as a single plain config — see makeAppearance() below.
//
// THE HOUSE RULES this module enforces by construction:
//   - appearance NEVER paints inline styles; the whole decision rides two
//     data attributes on <html> (data-theme, data-skin) and the consuming
//     stylesheet's token blocks (:root[data-theme=dark], [data-skin=...]).
//     No component CSS is ever rewritten — themes/skins re-token, not restyle.
//   - the attribute is ALWAYS set on apply (theme resolves through the OS
//     preference when unchosen), so the CSS media-query fallback can never
//     flip underneath a made choice.
//   - an unknown stored value must fall back safely: an unrecognized theme
//     keeps the OS preference; an unrecognized skin falls back to the
//     default skin. Storage writes fail soft (privacy modes).
//   - every app keeps its own localStorage keys; sibling projects' keys ride
//     along only as LEGACY READS (an account that chose a theme on the forum
//     keeps it there), never as writes.
//
// No dependencies, no build step. DOM-only: nothing here fetches, nothing
// here parses markup (the frontload lint test suite asserts no innerHTML
// anywhere under frontload/).

// resolveTheme: an explicit choice wins; an unchosen (or unrecognized)
// preference resolves through the OS. Identical to GC's original.
export function resolveTheme(preference, prefersDark) {
  if (preference === "dark" || preference === "light") return preference;
  return prefersDark ? "dark" : "light";
}

// resolveSkin: anything that is not exactly the alt skin falls back to the
// default — an unknown/absent value must never unskin the default look.
export function resolveSkin(value, { altSkin = "discord", defaultSkin = "brand" } = {}) {
  return value === altSkin ? altSkin : defaultSkin;
}

// The config surface. One appearance system per app; the fields:
//   themeKey / skinKey        — the app's own localStorage keys (writes).
//   legacyThemeKeys           — array of older keys, read-only fallbacks.
//   altSkin / defaultSkin     — the skin vocabulary (GC: "discord"/"brand").
//   chromeColors              — { [skin]: { light, dark } } for the
//                               <meta name="theme-color"> re-paint; omit to
//                               skip chrome handling entirely.
//   onRetheme                 — optional callback (theme, skin) for app-side
//                               follow-ups (GC re-themes its Turnstile widget).
export function makeAppearance(config) {
  const {
    themeKey,
    skinKey,
    legacyThemeKeys = [],
    altSkin = "discord",
    defaultSkin = "brand",
    chromeColors = null,
    onRetheme = null,
  } = config;

  const skinVocabulary = { altSkin, defaultSkin };

  function readPreference(storage, key) {
    try {
      return storage.getItem(key);
    } catch {
      // Storage can be unavailable (privacy modes); fall back to the defaults.
      return null;
    }
  }

  // Storage is injectable for tests; an omitted value falls back to the real
  // localStorage. (The theme-preload inline script handles first-paint; this
  // module is the module-side twin.)
  function storageOf(storage) {
    if (storage && typeof storage.getItem === "function") return storage;
    return globalThis.localStorage;
  }

  // Theme preference: the app's own key wins, then the legacy homes (in
  // order), and a stored value neither wrote keeps the OS preference.
  function readThemePreference(storage) {
    storage = storageOf(storage);
    const own = readThemePreferenceOwn(storage);
    if (own) return own;
    for (const legacyKey of legacyThemeKeys) {
      const legacy = readPreference(storage, legacyKey);
      if (legacy === "dark" || legacy === "light") return legacy;
    }
    return null;
  }

  function readThemePreferenceOwn(storage) {
    const own = readPreference(storage, themeKey);
    return own === "dark" || own === "light" ? own : null;
  }

  function readSkinPreference(storage) {
    return resolveSkin(readPreference(storageOf(storage), skinKey), skinVocabulary);
  }

  // Browser chrome: the address/status bar follows the EFFECTIVE skin+theme
  // pair — a "dark" choice in the alt skin must not paint the chrome with the
  // default skin's dark color. Only fires when chromeColors is configured.
  function applyChromeColor(doc, skin, theme) {
    if (!chromeColors) return;
    const byTheme = chromeColors[resolveSkin(skin, skinVocabulary)];
    const color = byTheme && byTheme[theme];
    if (!color) return;
    for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
      meta.content = color;
    }
  }

  // The boot entry: applies BOTH stored decisions before first paint —
  // theme first (the attribute is always set), then the skin. Returns the
  // applied pair for callers that announce it.
  function applyAppearance(doc, storage) {
    storage = storageOf(storage);
    const prefersDark =
      doc.defaultView !== null &&
      !!doc.defaultView.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = resolveTheme(readThemePreference(storage), prefersDark);
    const skin = readSkinPreference(storage);
    const root = doc.documentElement;
    root.dataset.theme = theme;
    root.dataset.skin = skin;
    applyChromeColor(doc, skin, theme);
    return { theme, skin };
  }

  // Writes a theme choice everywhere it lives: attribute, browser chrome,
  // storage. The app's re-theme hook (Turnstile et al.) fires last.
  function setThemeChoice(doc, storage, theme) {
    if (theme !== "dark" && theme !== "light") return;
    const root = doc.documentElement;
    root.dataset.theme = theme;
    applyChromeColor(doc, root.dataset.skin, theme);
    try {
      storageOf(storage).setItem(themeKey, theme);
    } catch {
      // Persistence is best-effort; the choice still applies to this page.
    }
    if (onRetheme) onRetheme(theme, root.dataset.skin);
  }

  // Writes a skin choice everywhere it lives: attribute, browser chrome,
  // storage. Unknown values resolve to the default skin, never off it.
  function setSkinChoice(doc, storage, skin) {
    skin = resolveSkin(skin, skinVocabulary);
    const root = doc.documentElement;
    root.dataset.skin = skin;
    applyChromeColor(doc, skin, root.dataset.theme);
    try {
      storageOf(storage).setItem(skinKey, skin);
    } catch {
      // Persistence is best-effort; the choice still applies to this page.
    }
    if (onRetheme) onRetheme(root.dataset.theme, skin);
  }

  return {
    resolveTheme,
    readThemePreference,
    readSkinPreference,
    applyAppearance,
    setThemeChoice,
    setSkinChoice,
    applyChromeColor,
  };
}
