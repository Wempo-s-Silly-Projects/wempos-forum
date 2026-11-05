// Banned-account screen (spec §13): shown after a login attempt that verified
// against a banned account. renderBannedScreen appends into `main`; the caller
// (app.js login flow) is responsible for clearing main first, matching how the
// other route renderers own their own containers.
// Ban appeals (v3.1): the screen carries an appeal form. Banned members have
// no session by definition, so the appeal posts to the session-less
// POST /api/appeals with the username they tried to sign in with.
import { addText, createForm, createInput, createTextarea } from "./forms.js";

// Pure, DOM-free. expiresAt is an epoch-seconds number from the login 403
// payload (null for permanent bans). Returns "3d 2h 14m"-style text with the
// leading zero units dropped, a trailing minutes unit always present, "0m"
// once the ban has already expired, and null when there is no time to show.
export const formatBanCountdown = (expiresAt, now = null) => {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  const current = typeof now === "number" && Number.isFinite(now)
    ? now
    : Math.floor(Date.now() / 1000);
  const remainingMinutes = Math.max(0, Math.floor((expiresAt - current) / 60));
  if (remainingMinutes <= 0) return "0m";
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
};

export function renderBannedScreen(main, { reason, expiresAt, username = "" }) {
  const document = main.ownerDocument;
  const panel = document.createElement("section");
  panel.className = "panel banned-screen";
  const heading = document.createElement("h1");
  heading.className = "page-heading";
  heading.textContent = "Oh noes:( You are banned!";
  panel.append(heading);
  addText(document, panel, "p",
    typeof reason === "string" && reason ? reason : "No reason was provided.",
    "banned-reason");
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    const countdown = addText(document, panel, "p", "", "banned-countdown");
    const tick = () => {
      // Stop ticking once the screen is gone (route change cleared main).
      if (!countdown.isConnected) {
        clearInterval(timer);
        return;
      }
      countdown.textContent = `Reactivates in ${formatBanCountdown(expiresAt)}`;
    };
    const timer = setInterval(tick, 1000);
    tick();
  } else {
    addText(document, panel, "p", "No reactivation time set....", "banned-countdown");
  }
  // Ban appeals (v3.1): no session exists here, so the form posts the
  // username it carries plus the appeal text; the server matches the
  // username to its ACTIVE ban and rejects duplicates. The username input
  // stays editable (the member may have mistyped it while signing in).
  const appealForm = createForm(document, "ban-appeal", [
    createInput(document, {
      id: "ban-appeal-username",
      name: "username",
      label: "Username",
      required: true,
      minLength: 3,
      maxLength: 24,
      value: username,
    }),
    createTextarea(document, {
      id: "ban-appeal-body",
      name: "body",
      label: "Why should this ban be lifted?",
      required: true,
      maxLength: 1000,
      rows: 4,
    }),
  ], "Appeal this ban");
  panel.append(appealForm);
  main.append(panel);
  return panel;
}