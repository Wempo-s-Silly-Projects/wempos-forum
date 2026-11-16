// v4.0 plan 4 Task 2 + the §4b door-swap: the auth concern is now only the
// first-owner setup screens and the home route's guest access gate. The
// password login/register forms are GONE — Wempo Accounts
// (accounts.itswempo.workers.dev) is the one sign-in surface: the header's
// Sign in link, the mobile bar's guest rung, and the home route's door panel
// all point there, and a `?wt` ticket redeems at boot (sso.js, called from
// app.js) before any route renders. No form here posts /api/login or
// /api/register anymore; /api/auth/* and /api/setup stay the workers'
// plumbing (untouched) and setup remains an out-of-band owner surface.
import { addText, createForm, createInput } from "../forms.js";
import { api, setCsrfToken } from "../api.js";
import { createPanel, element, main, setMessage } from "../dom.js";
import { state } from "../state.js";
import { wempoAccountsSignInUrl } from "../sso.js";

// The home route's guest rung (§4b): the door panel — no local forms, just
// the Accounts handoff. Cross-origin jump: the SPA's internal navigation only
// rewrites same-origin paths, and it must NOT intercept this one.
function doorPanel() {
  const panel = createPanel("Join the conversation!",
    "Membership rides a Wempo Account: sign-in and registration happen on Wempo Accounts, and the forum receives you signed in. There is no email collection or email-based recovery.");
  const button = element("a", "button button-primary sso-entry-button", "Sign in with Wempo Accounts");
  button.href = wempoAccountsSignInUrl(location.origin);
  panel.append(button);
  main.append(panel);
}

function setupForm() {
  const panel = createPanel("Set up Wempo's Forum:3", "The first owner Wempo Account requires a setup secret configured out of band.");
  panel.append(createForm(document, "setup", [
    createInput(document, {
      id: "setup-username", name: "username", label: "Owner username",
      autoComplete: "username", required: true, minLength: 3, maxLength: 24,
    }),
    createInput(document, {
      id: "setup-password", name: "password", label: "Password",
      type: "password", autoComplete: "new-password", required: true, minLength: 12, maxLength: 128,
    }),
    createInput(document, {
      id: "setup-key", name: "setupKey", label: "Setup secret", type: "password",
      autoComplete: "off", required: true, minLength: 32, maxLength: 4096,
      description: "Provided by the site owner through Wrangler. Never EVER share it!",
    }),
  ], "Create owner"));
  return panel;
}

function renderSetupLocked() {
  const panel = createPanel(
    "First-time setup is locked",
    "The site owner must configure valid SETUP_SECRET and PASSWORD_PEPPER values in Wrangler before the first owner Wempo Account can be created.",
  );
  main.append(panel);
}

function renderHomeAccess(session, setupRequired, setupConfigured) {
  if (setupRequired) {
    if (setupConfigured) main.append(setupForm());
    else renderSetupLocked();
    return;
  }
  if (!session.user) doorPanel();
}

function renderSetupRoute(context) {
  if (context.setupRequired) {
    if (context.setupConfigured) main.append(setupForm());
    else renderSetupLocked();
    return;
  }
  addText(document, main, "p", "First-time setup has already been completed.", "empty-state");
}

async function submitSetupForm(form, text) {
  const result = await api("/api/setup", {
    method: "POST",
    body: {
      username: text("username"),
      password: text("password"),
      setupKey: text("setupKey"),
    },
  });
  setCsrfToken(result.csrfToken);
  state.router.navigate("/");
  setMessage("Owner Wempo Account created!");
}

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch map;
// renderSetupRoute takes the setup entry of renderRoute's renderer table and
// renderHomeAccess stays the home route's access gate (called from feed.js's
// renderHome until the feed task moves it).
export const FORM_HANDLERS = {
  setup: (form, text) => submitSetupForm(form, text),
};

export { renderHomeAccess, renderSetupRoute };
