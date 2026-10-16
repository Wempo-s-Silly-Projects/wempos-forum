// Theme preference for the forum: a manual choice stored in localStorage
// under "forum-theme" ("dark" | "light") always beats the OS preference;
// with no valid manual choice the OS `prefers-color-scheme` decides.
// styles.css consumes the result as a `data-theme` attribute on <html> and
// the index.html inline no-flash script applies a stored "dark" before paint.

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

export function initTheme(doc, storage) {
  const root = doc.documentElement;

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
      rethemeTurnstile();
    }
  };

  const theme = resolveTheme(readPreference(storage), readOsPreference(doc));
  root.dataset.theme = theme;
  announceNextMode(theme);

  doc.querySelector("#theme-toggle")?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    announceNextMode(next);
    try {
      storage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; the choice still applies to this page.
    }
  });
}
