// Apply a manually chosen theme before the stylesheet paints. This file is
// external so it runs under the site's strict Content-Security-Policy without
// allowing inline scripts.
let storedTheme = null;
try {
  storedTheme = localStorage.getItem("forum-theme");
} catch {
  // Storage unavailable: CSS prefers-color-scheme remains the fallback.
}
if (storedTheme === "dark" || storedTheme === "light") {
  document.documentElement.dataset.theme = storedTheme;
}
