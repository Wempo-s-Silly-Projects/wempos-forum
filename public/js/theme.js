// Theme preference for the forum: a manual choice stored in localStorage
// under "forum-theme" ("dark" | "light") always beats the OS preference;
// with no valid manual choice the OS `prefers-color-scheme` decides.
// styles.css consumes the result as a `data-theme` attribute on <html> and
// index.html loads theme-preload.js before styles.css; the same-origin script complies with CSP.

export const THEME_STORAGE_KEY = "forum-theme";

export function resolveTheme(preference, prefersDark) {
  if (preference === "dark" || preference === "light") return preference;
  return prefersDark ? "dark" : "light";
}

function readPreference(storage) {
  try {
    return storage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (privacy modes); fall back to the OS look.
    return null;
  }
}

function readOsPreference(doc) {
  const view = doc.defaultView;
  return view !== null && !!view.matchMedia("(prefers-color-scheme: dark)").matches;
}

import { createIcon } from "./icons.js";
import { rethemeTurnstile } from "./turnstile.js";

// Corners (v2.5): "round" is the default; the account-settings checkbox
// flips the appearance pref. Same client-side persistence as the theme.
export function applyCornerPreference(doc, storage) {
  let corners = "round";
  try {
    corners = storage.getItem("forum-corners") === "square" ? "square" : "round";
  } catch {
    corners = "round";
  }
  doc.documentElement.dataset.corners = corners;
}

export function initTheme(doc, storage) {
  const root = doc.documentElement;

  // Browser chrome (v4.0): the phone's address/status bar follows the
  // EFFECTIVE theme, not just the OS preference — a manual dark choice on a
  // light-OS phone must not paint the chrome light. The two media-scoped
  // <meta theme-color> tags in index.html carry the colors; rewriting their
  // content keeps one source of truth.
  const BROWSER_CHROME_COLORS = { light: "#f7efdc", dark: "#131b27" };
  const applyBrowserChromeColor = (theme) => {
    const color = BROWSER_CHROME_COLORS[theme];
    if (!color) return;
    for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
      meta.content = color;
    }
  };

  const announceNextMode = (theme) => {
    const toggle = doc.querySelector("#theme-toggle");
    if (toggle) {
      // The label announces the action the NEXT click performs; the icon
      // reflects the CURRENT mode — sun in light, moon in dark (owner spec).
      toggle.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      );
      toggle.replaceChildren(createIcon(doc, theme === "dark" ? "moon" : "sun"));
      toggle.title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
      rethemeTurnstile();
    }
  };

  const theme = resolveTheme(readPreference(storage), readOsPreference(doc));
  root.dataset.theme = theme;
  announceNextMode(theme);
  applyBrowserChromeColor(theme);

  doc.querySelector("#theme-toggle")?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    announceNextMode(next);
    applyBrowserChromeColor(next);
    try {
      storage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; the choice still applies to this page.
    }
  });
}
