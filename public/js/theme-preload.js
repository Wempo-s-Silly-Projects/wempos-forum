// Apply a saved theme before styles.css paints. This same-origin script is
// allowed by the forum's strict script-src Content Security Policy.
let storedTheme = null;
try {
  storedTheme = localStorage.getItem("forum-theme");
} catch {
  // Storage can be blocked; CSS prefers-color-scheme remains the fallback.
}
if (storedTheme === "dark" || storedTheme === "light") {
  document.documentElement.dataset.theme = storedTheme;
}
